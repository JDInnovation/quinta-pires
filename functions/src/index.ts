import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { createAiOrderImportService } from "./aiOrderImportService";
import { validateAnalyzeRequest, validateAnalysisResult } from "./schema";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const analyzeWhatsappPrint = onRequest({ timeoutSeconds: 120 }, async (req, res) => {
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  let sourcePrintId = "unknown";

  try {
    const payload = validateAnalyzeRequest(req.body);
    sourcePrintId = payload.sourcePrintId;

    const [exists] = await admin.storage().bucket().file(payload.storagePath).exists();
    if (!exists) {
      throw new Error("Source image does not exist in Storage.");
    }

    const mode = (process.env.AI_IMPORT_MODE === "openai" ? "openai" : "mock") as
      | "mock"
      | "openai";

    const service = createAiOrderImportService(mode);
    const rawResult = await service.analyze(payload);
    const result = validateAnalysisResult(rawResult);

    const requiresValidation =
      result.order.requiresValidation ||
      result.order.overallConfidence < 0.95 ||
      result.customer.matchConfidence < 0.95 ||
      result.order.items.some((item) => item.confidence < 0.95) ||
      result.warnings.length > 0;

    const status = requiresValidation ? "NEEDS_REVIEW" : "ANALYZED";

    await db.collection("orderImports").doc(sourcePrintId).set(
      {
        status,
        analysisResult: result,
        warnings: result.warnings,
        overallConfidence: result.order.overallConfidence,
        requiresValidation,
        aiProvider: mode === "mock" ? "mock-provider" : "openai",
        aiMode: mode === "mock" ? "mock" : "live",
        aiModel: mode === "mock" ? "mock-image-v1" : "openai-vision-pending",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    res.status(200).json({ ok: true, result, status, requiresValidation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";

    logger.error("analyzeWhatsappPrint failed", {
      sourcePrintId,
      error: message,
    });

    if (sourcePrintId && sourcePrintId !== "unknown") {
      await db.collection("orderImports").doc(sourcePrintId).set(
        {
          status: "ERROR",
          errorMessage: message,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    res.status(400).json({ ok: false, error: message });
  }
});
