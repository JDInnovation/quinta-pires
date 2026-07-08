import { auth } from "../lib/firebase";
import type {
  ImportedOrderAnalysis,
  ImportedOrderItem,
  WeeklyCatalogProduct,
} from "../features/import/types";

export interface AnalyzePrintInput {
  sourcePrintId: string;
  weekId: string;
  catalogProducts: WeeklyCatalogProduct[];
  imageDataUrl: string;
  allowedUnits: string[];
  aliases: Array<{ canonical: string; aliases: string[] }>;
  language?: "pt-PT" | "pt-BR";
}

export interface AiOrderImportService {
  analyzePrint(input: AnalyzePrintInput): Promise<ImportedOrderAnalysis>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function randomConfidence(base = 0.86): number {
  const jitter = (Math.random() - 0.5) * 0.2;
  return clamp(Number((base + jitter).toFixed(3)), 0.5, 0.995);
}

function pickRandomProducts(catalogProducts: WeeklyCatalogProduct[]): WeeklyCatalogProduct[] {
  const active = catalogProducts.filter((p) => p.isActive);
  if (!active.length) return [];

  const count = Math.min(active.length, Math.max(1, Math.floor(Math.random() * 3) + 1));
  const chosen: WeeklyCatalogProduct[] = [];

  while (chosen.length < count) {
    const candidate = active[Math.floor(Math.random() * active.length)];
    if (!chosen.some((row) => row.productId === candidate.productId)) {
      chosen.push(candidate);
    }
  }

  return chosen;
}

function buildMockResult(input: AnalyzePrintInput): ImportedOrderAnalysis {
  const selected = pickRandomProducts(input.catalogProducts);

  const items: ImportedOrderItem[] = selected.map((product) => {
    const quantity = Number((Math.random() * 2.5 + 0.5).toFixed(2));
    const confidence = randomConfidence(0.9);
    return {
      productId: product.productId,
      productNameRaw: product.name,
      productNameNormalized: product.name,
      quantity,
      unit: product.defaultUnit,
      rawQuantityText: `${quantity} ${product.defaultUnit}`,
      confidence,
      status: confidence >= 0.95 ? "valid" : "needs_review",
      notes: confidence >= 0.95 ? null : "Mock mode: validar quantidade.",
    };
  });

  const overallConfidence =
    items.length > 0
      ? Number((items.reduce((acc, row) => acc + row.confidence, 0) / items.length).toFixed(3))
      : 0.72;

  const warnings: string[] = [];
  if (!items.length) {
    warnings.push("Nenhum produto ativo encontrado no catalogo semanal.");
  }

  const requiresValidation = overallConfidence < 0.95 || warnings.length > 0;

  return {
    sourcePrintId: input.sourcePrintId,
    customer: {
      phoneRaw: null,
      phoneNormalized: null,
      displayName: null,
      addressRaw: null,
      nifRaw: null,
      matchedCustomerId: null,
      matchConfidence: randomConfidence(0.7),
      isNewCustomer: true,
    },
    order: {
      deliveryWeekId: input.weekId,
      items,
      generalNotes: ["Resultado em modo mock. Nao representa extracao real de imagem."],
      overallConfidence,
      requiresValidation,
    },
    warnings,
    learningCandidates: [],
  };
}

function isValidResult(payload: ImportedOrderAnalysis): boolean {
  return Boolean(
    payload &&
      payload.sourcePrintId &&
      payload.customer &&
      payload.order &&
      Array.isArray(payload.order.items) &&
      Array.isArray(payload.warnings),
  );
}

export function createAiOrderImportService(config: {
  mode: "mock" | "worker";
  endpoint?: string;
}): AiOrderImportService {
  if (config.mode === "worker") {
    return {
      async analyzePrint(input: AnalyzePrintInput): Promise<ImportedOrderAnalysis> {
        if (!config.endpoint) {
          throw new Error("Worker endpoint not configured. Set VITE_AI_WORKER_URL.");
        }

        const user = auth.currentUser;
        if (!user) {
          throw new Error("Sessao expirada. Inicia sessao novamente.");
        }

        const idToken = await user.getIdToken();

        const response = await fetch(`${config.endpoint.replace(/\/$/, "")}/analyse-order-print`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            sourcePrintId: input.sourcePrintId,
            weekId: input.weekId,
            language: input.language ?? "pt-PT",
            imageDataUrl: input.imageDataUrl,
            catalogProducts: input.catalogProducts,
            allowedUnits: input.allowedUnits,
            aliases: input.aliases,
          }),
        });

        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
          result?: ImportedOrderAnalysis;
        };

        if (!response.ok || !payload.ok || !payload.result) {
          throw new Error(payload.error || "Worker analysis failed.");
        }

        if (!isValidResult(payload.result)) {
          throw new Error("Worker returned invalid AI payload.");
        }

        return payload.result;
      },
    };
  }

  return {
    async analyzePrint(input: AnalyzePrintInput): Promise<ImportedOrderAnalysis> {
      await sleep(700 + Math.random() * 900);
      const result = buildMockResult(input);
      if (!isValidResult(result)) {
        throw new Error("Mock AI returned invalid payload.");
      }
      return result;
    },
  };
}
