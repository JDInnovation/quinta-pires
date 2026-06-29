import type {
  AnalyzeWhatsappPrintRequest,
  CatalogProductInput,
  ImportedOrderAnalysis,
  ImportedOrderItem,
} from "./types";

export interface AiOrderImportService {
  analyze(payload: AnalyzeWhatsappPrintRequest): Promise<ImportedOrderAnalysis>;
}

function randomConfidence(base: number): number {
  const noise = (Math.random() - 0.5) * 0.2;
  const value = Math.min(0.995, Math.max(0.55, base + noise));
  return Number(value.toFixed(3));
}

function pickActiveProducts(catalogProducts: CatalogProductInput[]): CatalogProductInput[] {
  const active = catalogProducts.filter((p) => p.isActive);
  if (!active.length) return [];

  const count = Math.min(active.length, Math.floor(Math.random() * 3) + 1);
  const selected: CatalogProductInput[] = [];

  while (selected.length < count) {
    const row = active[Math.floor(Math.random() * active.length)];
    if (!selected.some((item) => item.productId === row.productId)) {
      selected.push(row);
    }
  }

  return selected;
}

function buildMockItems(products: CatalogProductInput[]): ImportedOrderItem[] {
  return products.map((product) => {
    const quantity = Number((Math.random() * 2.5 + 0.5).toFixed(2));
    const confidence = randomConfidence(0.89);
    return {
      productId: product.productId,
      productNameRaw: product.name,
      productNameNormalized: product.name,
      quantity,
      unit: product.defaultUnit,
      rawQuantityText: `${quantity} ${product.defaultUnit}`,
      confidence,
      status: confidence >= 0.95 ? "valid" : "needs_review",
      notes: confidence >= 0.95 ? null : "Mock mode: validar item manualmente.",
    };
  });
}

function createMockService(): AiOrderImportService {
  return {
    async analyze(payload: AnalyzeWhatsappPrintRequest): Promise<ImportedOrderAnalysis> {
      const selected = pickActiveProducts(payload.catalogProducts);
      const items = buildMockItems(selected);
      const avgConfidence =
        items.length > 0
          ? Number((items.reduce((acc, item) => acc + item.confidence, 0) / items.length).toFixed(3))
          : 0.7;

      const warnings: string[] = [];
      if (!items.length) {
        warnings.push("Catalogo semanal sem produtos ativos.");
      }

      return {
        sourcePrintId: payload.sourcePrintId,
        customer: {
          phoneRaw: null,
          phoneNormalized: null,
          displayName: null,
          matchedCustomerId: null,
          matchConfidence: randomConfidence(0.7),
          isNewCustomer: true,
        },
        order: {
          deliveryWeekId: payload.weekId,
          items,
          generalNotes: [
            "Resposta gerada em modo mock no backend. Sem chamada real ao modelo.",
          ],
          overallConfidence: avgConfidence,
          requiresValidation: avgConfidence < 0.95 || warnings.length > 0,
        },
        warnings,
        learningCandidates: [],
      };
    },
  };
}

function createOpenAiService(): AiOrderImportService {
  return {
    async analyze(): Promise<ImportedOrderAnalysis> {
      throw new Error(
        "OPENAI integration not implemented yet in this workspace. Keep AI_IMPORT_MODE=mock until configured.",
      );
    },
  };
}

export function createAiOrderImportService(mode: "mock" | "openai"): AiOrderImportService {
  if (mode === "openai") {
    return createOpenAiService();
  }

  return createMockService();
}
