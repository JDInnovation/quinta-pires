export type ImportedOrderItemStatus = "valid" | "needs_review" | "unavailable" | "ambiguous";

export interface ImportedOrderItem {
  productId: string | null;
  productNameRaw: string;
  productNameNormalized: string | null;
  quantity: number;
  unit: string;
  rawQuantityText: string;
  confidence: number;
  status: ImportedOrderItemStatus;
  notes: string | null;
}

export interface ImportedOrderAnalysis {
  sourcePrintId: string;
  customer: {
    phoneRaw: string | null;
    phoneNormalized: string | null;
    displayName: string | null;
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

export interface CatalogProductInput {
  productId: string;
  name: string;
  aliases: string[];
  defaultUnit: string;
  allowAlternativeUnit: boolean;
  price?: number;
  isActive: boolean;
}

export interface AnalyzeWhatsappPrintRequest {
  sourcePrintId: string;
  weekId: string;
  storagePath: string;
  catalogProducts: CatalogProductInput[];
}
