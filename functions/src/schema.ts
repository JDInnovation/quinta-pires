import type {
  AnalyzeWhatsappPrintRequest,
  CatalogProductInput,
  ImportedOrderAnalysis,
  ImportedOrderItem,
} from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isCatalogProduct(value: unknown): value is CatalogProductInput {
  if (!isObject(value)) return false;
  return (
    isString(value.productId) &&
    isString(value.name) &&
    isStringArray(value.aliases) &&
    isString(value.defaultUnit) &&
    isBoolean(value.allowAlternativeUnit) &&
    isBoolean(value.isActive)
  );
}

export function validateAnalyzeRequest(payload: unknown): AnalyzeWhatsappPrintRequest {
  if (!isObject(payload)) {
    throw new Error("Invalid payload: expected object.");
  }

  if (!isString(payload.sourcePrintId) || !payload.sourcePrintId.trim()) {
    throw new Error("Invalid payload: sourcePrintId is required.");
  }

  if (!isString(payload.weekId) || !payload.weekId.trim()) {
    throw new Error("Invalid payload: weekId is required.");
  }

  if (!isString(payload.storagePath) || !payload.storagePath.trim()) {
    throw new Error("Invalid payload: storagePath is required.");
  }

  if (!Array.isArray(payload.catalogProducts) || !payload.catalogProducts.every(isCatalogProduct)) {
    throw new Error("Invalid payload: catalogProducts must be a valid array.");
  }

  return {
    sourcePrintId: payload.sourcePrintId,
    weekId: payload.weekId,
    storagePath: payload.storagePath,
    catalogProducts: payload.catalogProducts,
  };
}

function isItem(value: unknown): value is ImportedOrderItem {
  if (!isObject(value)) return false;
  return (
    (value.productId === null || isString(value.productId)) &&
    isString(value.productNameRaw) &&
    (value.productNameNormalized === null || isString(value.productNameNormalized)) &&
    isNumber(value.quantity) &&
    isString(value.unit) &&
    isString(value.rawQuantityText) &&
    isNumber(value.confidence) &&
    isString(value.status) &&
    (value.notes === null || isString(value.notes))
  );
}

export function validateAnalysisResult(payload: unknown): ImportedOrderAnalysis {
  if (!isObject(payload)) {
    throw new Error("Invalid analysis result: expected object.");
  }

  if (!isString(payload.sourcePrintId)) {
    throw new Error("Invalid analysis result: sourcePrintId.");
  }

  if (!isObject(payload.customer) || !isObject(payload.order)) {
    throw new Error("Invalid analysis result: customer/order missing.");
  }

  const order = payload.order;
  if (!Array.isArray(order.items) || !order.items.every(isItem)) {
    throw new Error("Invalid analysis result: order.items invalid.");
  }

  if (!isStringArray(order.generalNotes) || !isNumber(order.overallConfidence) || !isBoolean(order.requiresValidation)) {
    throw new Error("Invalid analysis result: order metadata invalid.");
  }

  if (!Array.isArray(payload.warnings) || !payload.warnings.every(isString)) {
    throw new Error("Invalid analysis result: warnings invalid.");
  }

  if (!Array.isArray(payload.learningCandidates)) {
    throw new Error("Invalid analysis result: learningCandidates invalid.");
  }

  return payload as unknown as ImportedOrderAnalysis;
}
