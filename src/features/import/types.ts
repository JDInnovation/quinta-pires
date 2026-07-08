import type { ProductUnit } from "../../types";

export type ImportCatalogMode = "existing_products" | "weekly_catalog";

export type ImportStatus =
  | "UPLOADED"
  | "PROCESSING"
  | "DRAFT_AI"
  | "PENDING_VALIDATION"
  | "ANALYZED"
  | "NEEDS_REVIEW"
  | "CONFIRMED"
  | "IGNORED"
  | "ERROR";

export interface WeeklyCatalogProduct {
  productId: string;
  name: string;
  aliases: string[];
  defaultUnit: ProductUnit | "caixa" | "saco" | "outro";
  allowAlternativeUnit: boolean;
  price?: number;
  isActive: boolean;
}

export interface WeeklyCatalog {
  id: string;
  weekId: string;
  label: string;
  mode: ImportCatalogMode;
  products: WeeklyCatalogProduct[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ImportedOrderItem {
  productId: string | null;
  productNameRaw: string;
  productNameNormalized: string | null;
  quantity: number;
  unit: string;
  rawQuantityText: string;
  confidence: number;
  status: "valid" | "needs_review" | "unavailable" | "ambiguous";
  notes: string | null;
}

export interface ImportedOrderAnalysis {
  sourcePrintId: string;
  customer: {
    phoneRaw: string | null;
    phoneNormalized: string | null;
    displayName: string | null;
    addressRaw: string | null;
    nifRaw: string | null;
    matchedCustomerId: string | null;
    matchConfidence: number;
    isNewCustomer: boolean;
  };
  order: {
    deliveryWeekId: string;
    items: ImportedOrderItem[];
    generalNotes: string[];
    overallConfidence: number;
    requiresValidation: boolean;
  };
  warnings: string[];
  learningCandidates: Array<Record<string, unknown>>;
}

export interface CorrectedOrderDraft {
  customerId: string | null;
  phoneDetected: string | null;
  displayNameDetected: string | null;
  addressDetected: string | null;
  nifDetected: string | null;
  items: Array<{
    productId: string;
    quantity: number;
    unit: string;
    productNameRaw: string;
    confidence: number;
    notes: string | null;
    newProductName?: string | null;
    newProductPrice?: number | null;
  }>;
  notes: string;
}

export interface OrderImportRecord {
  id: string;
  weekId: string;
  catalogMode: ImportCatalogMode;
  catalogId: string | null;
  status: ImportStatus;
  fileName: string;
  fileSize: number;
  fileType: string;
  storagePath: string;
  downloadURL: string;
  imageDataUrl: string;
  fingerprint: string;
  aiProvider: string;
  aiMode: "mock" | "worker" | "live";
  aiModel: string;
  overallConfidence: number | null;
  requiresValidation: boolean;
  warnings: string[];
  errorMessage: string | null;
  analysisResult: ImportedOrderAnalysis | null;
  correctedDraft?: CorrectedOrderDraft | null;
  confirmedOrderId?: string | null;
  confirmedAt?: unknown;
  confirmedBy?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CreateOrderImportInput {
  weekId: string;
  catalogMode: ImportCatalogMode;
  catalogId: string | null;
  fileName: string;
  fileSize: number;
  fileType: string;
  storagePath?: string;
  downloadURL?: string;
  imageDataUrl?: string;
  fingerprint: string;
  aiMode: "mock" | "worker" | "live";
}

export interface AiLearningEntry {
  id: string;
  importId: string;
  confidence: number;
  itemsDetected: number;
  itemsConfirmed: number;
  itemEdits: number;
  itemsAdded: number;
  itemsRemoved: number;
  customerAutoMatched: boolean;
  customerKept: boolean;
  aiMode: string;
  aiModel: string;
  createdAt?: unknown;
}

export interface CreateAiLearningEntryInput {
  importId: string;
  confidence: number;
  itemsDetected: number;
  itemsConfirmed: number;
  itemEdits: number;
  itemsAdded: number;
  itemsRemoved: number;
  customerAutoMatched: boolean;
  customerKept: boolean;
  aiMode: string;
  aiModel: string;
}

export interface ProductAlias {
  id: string;
  aliasText: string;
  displayText: string;
  productId: string;
  productName: string;
  count: number;
  updatedAt?: unknown;
}

export interface UpsertProductAliasInput {
  aliasText: string;
  displayText: string;
  productId: string;
  productName: string;
}

export interface CustomerAlias {
  id: string;
  aliasText: string;
  displayText: string;
  customerId: string;
  customerName: string;
  count: number;
  updatedAt?: unknown;
}

export interface UpsertCustomerAliasInput {
  aliasText: string;
  displayText: string;
  customerId: string;
  customerName: string;
}

export interface CustomerPreference {
  id: string;
  customerId: string;
  customerName: string;
  text: string;
  count: number;
  updatedAt?: unknown;
}

export interface UpsertCustomerPreferenceInput {
  customerId: string;
  customerName: string;
  text: string;
}

export interface ProductUnitPref {
  id: string;
  productId: string;
  productName: string;
  unitCounts: Record<string, number>;
  updatedAt?: unknown;
}

export interface BumpProductUnitPrefInput {
  productId: string;
  productName: string;
  unit: string;
}

export interface AiCorrection {
  id: string;
  aliasText: string;
  displayText: string;
  fromProductId: string;
  fromProductName: string;
  toProductId: string;
  toProductName: string;
  count: number;
  updatedAt?: unknown;
}

export interface UpsertAiCorrectionInput {
  aliasText: string;
  displayText: string;
  fromProductId: string;
  fromProductName: string;
  toProductId: string;
  toProductName: string;
}
