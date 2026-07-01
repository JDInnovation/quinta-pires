import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

interface Env {
  OPENAI_API_KEY: string;
  ADMIN_UIDS: string;
  ALLOWED_ORIGINS?: string;
  OPENAI_MODEL?: string;
  MAX_IMAGES_PER_REQUEST?: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;
  RATE_LIMIT_MAX_REQUESTS?: string;
  RATE_LIMIT_KV?: KVNamespace;
}

interface AnalyzePayload {
  sourcePrintId: string;
  weekId: string;
  language?: string;
  imageDataUrl: string;
  catalogProducts: Array<{
    productId: string;
    name: string;
    aliases?: string[];
    defaultUnit?: string;
    allowAlternativeUnit?: boolean;
    isActive?: boolean;
  }>;
  allowedUnits: string[];
  aliases: Array<{ canonical: string; aliases: string[] }>;
}

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

const inMemoryRateLimit = new Map<string, { count: number; expiresAt: number }>();

function json(data: unknown, status = 200, corsHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(corsHeaders || {}),
    },
  });
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function getAllowedOrigins(env: Env): Set<string> {
  const defaults = ["http://localhost:5173", "http://127.0.0.1:5173"];
  return new Set([...defaults, ...splitCsv(env.ALLOWED_ORIGINS)]);
}

function getCorsHeaders(origin: string | null, env: Env): HeadersInit {
  const allowedOrigins = getAllowedOrigins(env);
  if (!origin || !allowedOrigins.has(origin)) {
    return {
      Vary: "Origin",
    };
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function isAllowedOrigin(origin: string | null, env: Env): boolean {
  if (!origin) return true;
  return getAllowedOrigins(env).has(origin);
}

function isDataUrlJpegOrImage(value: string): boolean {
  return /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(value);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2) throw new Error("Invalid token format.");

  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (payload.length % 4)) % 4;
  const padded = payload + "=".repeat(padLength);
  const text = atob(padded);
  return JSON.parse(text) as Record<string, unknown>;
}

async function verifyFirebaseIdToken(token: string): Promise<JWTPayload & { uid: string }> {
  const unverifiedPayload = decodeJwtPayload(token);
  const projectId = String(unverifiedPayload.aud || "");
  if (!projectId) {
    throw new Error("Token without Firebase project audience.");
  }

  const verified = await jwtVerify(token, GOOGLE_JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });

  const uid = String((verified.payload.user_id || verified.payload.sub || "") as string);
  if (!uid) {
    throw new Error("Token missing user id.");
  }

  return {
    ...verified.payload,
    uid,
  };
}

async function checkRateLimit(env: Env, userUid: string): Promise<boolean> {
  const windowSeconds = Number(env.RATE_LIMIT_WINDOW_SECONDS || "60");
  const maxRequests = Number(env.RATE_LIMIT_MAX_REQUESTS || "20");
  const now = Date.now();
  const windowId = Math.floor(now / (windowSeconds * 1000));
  const key = `${userUid}:${windowId}`;

  if (env.RATE_LIMIT_KV) {
    const raw = await env.RATE_LIMIT_KV.get(key);
    const count = raw ? Number(raw) : 0;
    if (count >= maxRequests) return false;
    await env.RATE_LIMIT_KV.put(key, String(count + 1), {
      expirationTtl: windowSeconds + 5,
    });
    return true;
  }

  const existing = inMemoryRateLimit.get(key);
  if (!existing || existing.expiresAt <= now) {
    inMemoryRateLimit.set(key, {
      count: 1,
      expiresAt: now + windowSeconds * 1000,
    });
    return true;
  }

  if (existing.count >= maxRequests) return false;
  existing.count += 1;
  inMemoryRateLimit.set(key, existing);
  return true;
}

function validatePayload(payload: unknown, maxImagesPerRequest: number): AnalyzePayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload.");
  }

  const body = payload as Record<string, unknown>;
  const images = Array.isArray(body.images) ? body.images : [];
  const imageDataUrl = String(body.imageDataUrl || "");
  const sourcePrintId = String(body.sourcePrintId || "");
  const weekId = String(body.weekId || "");
  const language = String(body.language || "pt-PT");
  const catalogProducts = Array.isArray(body.catalogProducts) ? body.catalogProducts : [];
  const allowedUnits = Array.isArray(body.allowedUnits)
    ? body.allowedUnits.map((u) => String(u)).filter(Boolean)
    : [];
  const aliases = Array.isArray(body.aliases)
    ? body.aliases.map((entry) => {
        const row = entry as Record<string, unknown>;
        return {
          canonical: String(row.canonical || ""),
          aliases: Array.isArray(row.aliases)
            ? row.aliases.map((v) => String(v)).filter(Boolean)
            : [],
        };
      })
    : [];

  if (!sourcePrintId) throw new Error("sourcePrintId is required.");
  if (!weekId) throw new Error("weekId is required.");
  if (images.length > maxImagesPerRequest) {
    throw new Error(`Too many images. Max per request is ${maxImagesPerRequest}.`);
  }
  if (images.length > 0 && !imageDataUrl) {
    throw new Error("Use imageDataUrl for single-image analysis in this endpoint.");
  }
  if (!imageDataUrl) throw new Error("imageDataUrl is required.");
  if (!isDataUrlJpegOrImage(imageDataUrl)) throw new Error("imageDataUrl must be an image data URL.");
  if (!catalogProducts.length) throw new Error("catalogProducts is required.");
  if (!allowedUnits.length) throw new Error("allowedUnits is required.");

  const base64Part = imageDataUrl.split(",")[1] ?? "";
  const approxBytes = Math.floor((base64Part.length * 3) / 4);
  const maxBytes = 5 * 1024 * 1024;
  if (approxBytes > maxBytes) {
    throw new Error("Image too large. Send a smaller optimized image.");
  }

  if (maxImagesPerRequest < 1) throw new Error("Invalid worker max image configuration.");

  return {
    sourcePrintId,
    weekId,
    language,
    imageDataUrl,
    catalogProducts: catalogProducts as AnalyzePayload["catalogProducts"],
    allowedUnits,
    aliases,
  };
}

function validateAiResult(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const v = payload as Record<string, unknown>;
  if (typeof v.sourcePrintId !== "string") return false;

  const customer = v.customer as Record<string, unknown>;
  const order = v.order as Record<string, unknown>;

  if (!customer || typeof customer !== "object") return false;
  if (!order || typeof order !== "object") return false;
  if (!Array.isArray(order.items)) return false;
  if (!Array.isArray(v.warnings)) return false;
  if (!Array.isArray(v.learningCandidates)) return false;
  return true;
}

function buildAnalysisSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["sourcePrintId", "customer", "order", "warnings", "learningCandidates"],
    properties: {
      sourcePrintId: { type: "string" },
      customer: {
        type: "object",
        additionalProperties: false,
        required: [
          "phoneRaw",
          "phoneNormalized",
          "displayName",
          "matchedCustomerId",
          "matchConfidence",
          "isNewCustomer",
        ],
        properties: {
          phoneRaw: { type: ["string", "null"] },
          phoneNormalized: { type: ["string", "null"] },
          displayName: { type: ["string", "null"] },
          matchedCustomerId: { type: ["string", "null"] },
          matchConfidence: { type: "number" },
          isNewCustomer: { type: "boolean" },
        },
      },
      order: {
        type: "object",
        additionalProperties: false,
        required: ["deliveryWeekId", "items", "generalNotes", "overallConfidence", "requiresValidation"],
        properties: {
          deliveryWeekId: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "productId",
                "productNameRaw",
                "productNameNormalized",
                "quantity",
                "unit",
                "rawQuantityText",
                "confidence",
                "status",
                "notes",
              ],
              properties: {
                productId: { type: ["string", "null"] },
                productNameRaw: { type: "string" },
                productNameNormalized: { type: ["string", "null"] },
                quantity: { type: "number" },
                unit: { type: "string" },
                rawQuantityText: { type: "string" },
                confidence: { type: "number" },
                status: {
                  type: "string",
                  enum: ["valid", "needs_review", "unavailable", "ambiguous"],
                },
                notes: { type: ["string", "null"] },
              },
            },
          },
          generalNotes: {
            type: "array",
            items: { type: "string" },
          },
          overallConfidence: { type: "number" },
          requiresValidation: { type: "boolean" },
        },
      },
      warnings: {
        type: "array",
        items: { type: "string" },
      },
      learningCandidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "rawText",
            "normalizedProductId",
            "normalizedProductName",
            "suggestedAliasType",
            "confidence",
          ],
          properties: {
            rawText: { type: "string" },
            normalizedProductId: { type: ["string", "null"] },
            normalizedProductName: { type: ["string", "null"] },
            suggestedAliasType: { type: ["string", "null"] },
            confidence: { type: "number" },
          },
        },
      },
    },
  };
}

async function callOpenAi(env: Env, payload: AnalyzePayload): Promise<unknown> {
  const schema = buildAnalysisSchema();

  const systemPrompt = [
    "You analyze WhatsApp order screenshots and return strict JSON.",
    "Never include markdown or prose outside JSON.",
    "Do not invent products outside active catalog unless clearly identified as unknown.",
    "Each catalog product may include an 'aliases' list and there is a 'learnedAliases' map (canonical -> aliases) built from past human validations.",
    "When the raw text matches (case/accent-insensitive) a product alias or learned alias, map it to that product's productId with high confidence.",
    "Prefer these learned aliases over guessing; they encode previous corrections.",
    "Set requiresValidation=true whenever confidence is not high or any ambiguity exists.",
  ].join(" ");

  const userPrompt = [
    `sourcePrintId: ${payload.sourcePrintId}`,
    `deliveryWeekId: ${payload.weekId}`,
    `language: ${payload.language || "pt-PT"}`,
    `allowedUnits: ${JSON.stringify(payload.allowedUnits)}`,
    `catalogProducts: ${JSON.stringify(payload.catalogProducts)}`,
    `learnedAliases: ${JSON.stringify(payload.aliases)}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4o",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: payload.imageDataUrl } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "order_analysis",
          schema,
          strict: true,
        },
      },
      max_tokens: 1400,
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`OpenAI error (${response.status}): ${raw.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const firstChoice = choices[0] as Record<string, unknown> | undefined;
  const message = firstChoice?.message as Record<string, unknown> | undefined;
  const content = typeof message?.content === "string" ? message.content : "";

  if (!content) {
    throw new Error("OpenAI returned empty output.");
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error("OpenAI response was not valid JSON.");
  }
}

async function handleAnalyze(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin");
  const corsHeaders = getCorsHeaders(origin, env);

  if (!isAllowedOrigin(origin, env)) {
    return json({ ok: false, error: "Origin not allowed." }, 403, corsHeaders);
  }

  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ ok: false, error: "Missing bearer token." }, 401, corsHeaders);
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return json({ ok: false, error: "Missing bearer token." }, 401, corsHeaders);
  }

  if (!env.OPENAI_API_KEY) {
    return json({ ok: false, error: "Worker missing OPENAI_API_KEY secret." }, 500, corsHeaders);
  }

  if (!env.ADMIN_UIDS) {
    return json({ ok: false, error: "Worker missing ADMIN_UIDS secret." }, 500, corsHeaders);
  }

  const maxImagesPerRequest = Number(env.MAX_IMAGES_PER_REQUEST || "3");

  try {
    const decoded = await verifyFirebaseIdToken(token);
    const uid = decoded.uid;

    const allowedAdmins = new Set(splitCsv(env.ADMIN_UIDS));
    if (!allowedAdmins.has(uid)) {
      return json({ ok: false, error: "User is not authorized." }, 403, corsHeaders);
    }

    const withinRateLimit = await checkRateLimit(env, uid);
    if (!withinRateLimit) {
      return json({ ok: false, error: "Rate limit exceeded for this user." }, 429, corsHeaders);
    }

    const payload = validatePayload(await request.json(), maxImagesPerRequest);
    const result = await callOpenAi(env, payload);

    if (!validateAiResult(result)) {
      return json({ ok: false, error: "Invalid structured AI output." }, 502, corsHeaders);
    }

    return json({ ok: true, result }, 200, corsHeaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ ok: false, error: message }, 400, corsHeaders);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const corsHeaders = getCorsHeaders(origin, env);

    if (!isAllowedOrigin(origin, env)) {
      return json({ ok: false, error: "Origin not allowed." }, 403, corsHeaders);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (url.pathname === "/analyse-order-print" && request.method === "POST") {
      return handleAnalyze(request, env);
    }

    return json({ ok: false, error: "Not found" }, 404, corsHeaders);
  },
};
