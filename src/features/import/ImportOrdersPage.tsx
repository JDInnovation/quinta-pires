import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import type { Order } from "../../types";
import { useCustomers } from "../../context/CustomersContext";
import { useProducts } from "../../context/ProductsContext";
import { useOrders } from "../../context/OrdersContext";
import { createCustomer as apiCreateCustomer } from "../customers/api";
import {
  createOrderImport,
  createWeeklyCatalog,
  deleteOrderImportRecord,
  listOrderImports,
  listProductAliases,
  listWeeklyCatalogs,
  patchOrderImport,
  logAiLearningEntry,
  upsertProductAlias,
} from "./api";
import { createAiOrderImportService } from "../../services/aiOrderImportService";
import { optimizeImageForAi } from "../../services/imageOptimization";
import { parseCatalogText, normalizeProductName } from "./catalogParser";
import { useConfirm } from "../../components/ConfirmProvider";
import type {
  CorrectedOrderDraft,
  ImportCatalogMode,
  ImportStatus,
  OrderImportRecord,
  ProductAlias,
  WeeklyCatalog,
  WeeklyCatalogProduct,
} from "./types";

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;
const MAX_CONCURRENCY = 2;
const MAX_IMAGES_PER_SELECTION = 50;
// Firestore tem um limite de ~1MB por documento. A imagem e guardada como data URL
// (base64, +~33%) dentro do proprio documento, por isso limitamos os bytes brutos.
const MAX_FIRESTORE_IMAGE_BYTES = 600 * 1024;
const UNIT_OPTIONS = ["kg", "un", "molho", "caixa", "saco", "outro"] as const;

const STATUS_LABELS: Record<ImportStatus, string> = {
  UPLOADED: "Pendente",
  PROCESSING: "A analisar",
  DRAFT_AI: "Rascunho IA",
  PENDING_VALIDATION: "Pendente validacao",
  ANALYZED: "Analisado",
  NEEDS_REVIEW: "Precisa validacao",
  CONFIRMED: "Confirmado",
  IGNORED: "Ignorado",
  ERROR: "Erro",
};

const aiMode = import.meta.env.VITE_AI_IMPORT_MODE === "mock" ? "mock" : "worker";
const aiEndpoint = import.meta.env.VITE_AI_WORKER_URL as string | undefined;
const aiService = createAiOrderImportService({ mode: aiMode, endpoint: aiEndpoint });

function toWeekId(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function currentWeekId(): string {
  return toWeekId(new Date());
}

function normalizePhonePT(raw?: string | null): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (/^351\d{9}$/.test(digits)) return digits;
  if (/^\d{9}$/.test(digits)) return `351${digits}`;
  if (/^00351\d{9}$/.test(digits)) return digits.slice(2);
  return null;
}

function isAcceptedImage(file: File): boolean {
  if (ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    return true;
  }

  const lower = file.name.toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp"].some((ext) => lower.endsWith(ext));
}

async function computeFingerprint(file: File): Promise<string> {
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const bytes = Array.from(new Uint8Array(digest));
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `${file.name}::${file.size}::${file.lastModified}`;
  }
}

function getPreviewSource(record: OrderImportRecord, previewById: Record<string, string>): string | null {
  return previewById[record.id] ?? (record.imageDataUrl ? record.imageDataUrl : record.downloadURL || null);
}

async function loadRecordDataUrl(record: OrderImportRecord): Promise<string | null> {
  return record.imageDataUrl || record.downloadURL || null;
}

// Otimiza a imagem de forma progressivamente mais agressiva ate caber no limite
// do documento Firestore. Devolve null se nem a configuracao minima couber.
async function optimizeForFirestore(file: File) {
  const attempts = [
    { maxWidth: 1280, quality: 0.72 },
    { maxWidth: 1024, quality: 0.65 },
    { maxWidth: 900, quality: 0.6 },
    { maxWidth: 800, quality: 0.5 },
    { maxWidth: 700, quality: 0.45 },
  ];
  let last = await optimizeImageForAi(file, attempts[0]);
  if (last.bytes <= MAX_FIRESTORE_IMAGE_BYTES) return last;
  for (let i = 1; i < attempts.length; i += 1) {
    last = await optimizeImageForAi(file, attempts[i]);
    if (last.bytes <= MAX_FIRESTORE_IMAGE_BYTES) return last;
  }
  return last.bytes <= MAX_FIRESTORE_IMAGE_BYTES ? last : null;
}

function statusClassName(status: ImportStatus): string {
  switch (status) {
    case "CONFIRMED":
      return "status-pill entregue";
    case "ERROR":
      return "status-pill cancelada";
    case "NEEDS_REVIEW":
    case "UPLOADED":
    case "PROCESSING":
      return "status-pill pendente";
    default:
      return "status-pill";
  }
}

function confidenceClass(score: number): string {
  if (score >= 0.95) return "confidence-good";
  if (score >= 0.7) return "confidence-mid";
  return "confidence-low";
}

function buildDefaultWeeklyProducts(
  products: Array<{ id: string; name: string; unit: string; price: number }>,
): WeeklyCatalogProduct[] {
  return products.map((p) => ({
    productId: p.id,
    name: p.name,
    aliases: [],
    defaultUnit: p.unit as WeeklyCatalogProduct["defaultUnit"],
    allowAlternativeUnit: true,
    price: p.price,
    isActive: true,
  }));
}

// Extrai os componentes de uma quantidade (ex: "1kg+1kg" -> [1, 1]).
// Se nao houver soma explicita, usa o valor ja calculado como componente unico.
function parseQuantityComponents(rawText: string | null | undefined, fallback: number): number[] {
  const parts = (rawText ?? "")
    .split("+")
    .map((part) => {
      const match = part.match(/\d+(?:[.,]\d+)?/);
      return match ? Number(match[0].replace(",", ".")) : NaN;
    })
    .filter((n) => Number.isFinite(n) && n > 0);
  if (parts.length >= 2) return parts;
  return [fallback];
}

function formatQtyComponent(n: number): string {
  const isInt = Math.abs(n - Math.round(n)) < 1e-9;
  return isInt ? String(Math.round(n)) : String(n).replace(".", ",");
}

function buildDraftFromRecord(record: OrderImportRecord): CorrectedOrderDraft {
  const analysis = record.analysisResult;
  const rawItems = analysis?.order.items ?? [];

  // Agrupa produtos repetidos (varias linhas do mesmo produto ou "1kg+1kg").
  type Group = {
    productId: string;
    productNameRaw: string;
    unit: string;
    confidence: number;
    notes: string | null;
    components: number[];
  };
  const groups = new Map<string, Group>();
  const order: string[] = [];

  for (const item of rawItems) {
    const key = (item.productId || item.productNameNormalized || item.productNameRaw || "")
      .trim()
      .toLowerCase();
    const components = parseQuantityComponents(item.rawQuantityText, item.quantity);
    const existing = groups.get(key);
    if (existing) {
      existing.components.push(...components);
      existing.confidence = Math.min(existing.confidence, item.confidence);
    } else {
      groups.set(key, {
        productId: item.productId || "",
        productNameRaw: item.productNameRaw,
        unit: item.unit,
        confidence: item.confidence,
        notes: item.notes,
        components: [...components],
      });
      order.push(key);
    }
  }

  const items = order.map((key) => {
    const g = groups.get(key)!;
    return {
      productId: g.productId,
      quantity: g.components.reduce((a, b) => a + b, 0),
      unit: g.unit,
      productNameRaw: g.productNameRaw,
      confidence: g.confidence,
      notes: g.notes,
    };
  });

  // Nota em capslock com o detalhe dos produtos que vieram repetidos/somados.
  const breakdownParts = order
    .map((key) => groups.get(key)!)
    .filter((g) => g.components.length > 1)
    .map((g) => `${g.productNameRaw.toUpperCase().trim()} ${g.components.map(formatQtyComponent).join("+")}`);

  const notesLines = [...(analysis?.order.generalNotes ?? [])];
  if (breakdownParts.length) notesLines.push(breakdownParts.join(" --- "));

  return {
    customerId: analysis?.customer.matchedCustomerId ?? null,
    phoneDetected: analysis?.customer.phoneRaw ?? null,
    displayNameDetected: analysis?.customer.displayName ?? null,
    items,
    notes: notesLines.join("\n"),
  };
}

const ImportOrdersPage: React.FC = () => {
  const confirm = useConfirm();
  const { products, loadingProducts, bulkUpsertProducts } = useProducts();
  const { customers } = useCustomers();
  const { createOrder } = useOrders();

  const [weekId, setWeekId] = useState(currentWeekId());
  const [catalogMode, setCatalogMode] = useState<ImportCatalogMode>("existing_products");
  const [catalogs, setCatalogs] = useState<WeeklyCatalog[]>([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState("");
  const [imports, setImports] = useState<OrderImportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [busyUpload, setBusyUpload] = useState(false);
  const [savingCatalog, setSavingCatalog] = useState(false);

  const [newCatalogLabel, setNewCatalogLabel] = useState("");
  const [newCatalogProducts, setNewCatalogProducts] = useState<Set<string>>(new Set());

  const [catalogText, setCatalogText] = useState("");
  const [importingCatalog, setImportingCatalog] = useState(false);

  const [productAliases, setProductAliases] = useState<ProductAlias[]>([]);

  const [selectedValidationId, setSelectedValidationId] = useState<string | null>(null);
  const [validationModalOpen, setValidationModalOpen] = useState(false);
  const [draftById, setDraftById] = useState<Record<string, CorrectedOrderDraft>>({});
  const [previewById, setPreviewById] = useState<Record<string, string>>({});
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerAddress, setNewCustomerAddress] = useState("");
  const [savingValidation, setSavingValidation] = useState(false);

  const queueRef = useRef<Array<{ id: string; weekId: string; imageDataUrl: string }>>([]);
  const activeCountRef = useRef(0);
  const importsRef = useRef<OrderImportRecord[]>([]);

  useEffect(() => {
    importsRef.current = imports;
  }, [imports]);

  const selectedCatalog = useMemo(
    () => catalogs.find((c) => c.id === selectedCatalogId) ?? null,
    [catalogs, selectedCatalogId],
  );

  const aliasesByProductId = useMemo(() => {
    const map = new Map<string, string[]>();
    // productAliases ja vem ordenado por count desc (mais frequentes primeiro)
    productAliases.forEach((a) => {
      if (!a.productId || !a.displayText) return;
      const list = map.get(a.productId) ?? [];
      if (list.length < 8 && !list.includes(a.displayText)) list.push(a.displayText);
      map.set(a.productId, list);
    });
    return map;
  }, [productAliases]);

  const activeWeeklyProducts = useMemo(() => {
    const base =
      catalogMode === "existing_products"
        ? buildDefaultWeeklyProducts(products).filter((p) => p.isActive)
        : (selectedCatalog?.products ?? []).filter((p) => p.isActive);
    return base.map((p) => {
      const learned = aliasesByProductId.get(p.productId) ?? [];
      const merged = Array.from(new Set([...(p.aliases ?? []), ...learned]));
      return { ...p, aliases: merged };
    });
  }, [catalogMode, products, selectedCatalog, aliasesByProductId]);

  const customersByNormalizedPhone = useMemo(() => {
    const map = new Map<string, string>();
    customers.forEach((customer) => {
      const normalized = normalizePhonePT(customer.phone ?? "");
      if (normalized) map.set(normalized, customer.id);
    });
    return map;
  }, [customers]);

  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const reviewRows = useMemo(
    () =>
      imports.filter(
        (row) =>
          row.status === "PENDING_VALIDATION" ||
          row.status === "DRAFT_AI" ||
          row.status === "NEEDS_REVIEW" ||
          row.status === "ANALYZED",
      ),
    [imports],
  );

  const pendingAnalysisRows = useMemo(
    () => imports.filter((row) => row.status === "UPLOADED" || row.status === "ERROR"),
    [imports],
  );

  const processingRows = useMemo(
    () => imports.filter((row) => row.status === "PROCESSING"),
    [imports],
  );

  const processingCount = processingRows.length;

  const selectedValidationIndex = useMemo(
    () => reviewRows.findIndex((row) => row.id === selectedValidationId),
    [reviewRows, selectedValidationId],
  );

  const summary = useMemo(() => {
    const total = imports.length;
    const analyzed = imports.filter((r) => r.status === "DRAFT_AI" || r.status === "ANALYZED").length;
    const needsReview = imports.filter((r) => r.status === "PENDING_VALIDATION" || r.status === "NEEDS_REVIEW").length;
    const confirmed = imports.filter((r) => r.status === "CONFIRMED").length;
    const errors = imports.filter((r) => r.status === "ERROR").length;
    const processing = imports.filter((r) => r.status === "PROCESSING").length;
    return { total, analyzed, needsReview, confirmed, errors, processing };
  }, [imports]);

  const refreshCatalogs = useCallback(async () => {
    const rows = await listWeeklyCatalogs();
    setCatalogs(rows);
    if (!selectedCatalogId && rows.length > 0) setSelectedCatalogId(rows[0].id);
  }, [selectedCatalogId]);

  const refreshImports = useCallback(async () => {
    const rows = await listOrderImports();
    setImports(rows);
  }, []);

  const refreshAliases = useCallback(async () => {
    const rows = await listProductAliases();
    setProductAliases(rows);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await Promise.all([refreshCatalogs(), refreshImports(), refreshAliases()]);
      } catch (err) {
        console.error(err);
        toast.error("Nao foi possivel carregar dados da importacao.");
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshCatalogs, refreshImports, refreshAliases]);

  const updateLocalRecord = useCallback((id: string, patch: Partial<OrderImportRecord>) => {
    setImports((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const openValidationQueue = useCallback(() => {
    if (!reviewRows.length) {
      toast("Nao ha prints para validar neste momento.");
      return;
    }

    setSelectedValidationId(reviewRows[0].id);
    setValidationModalOpen(true);
  }, [reviewRows]);

  const advanceValidationQueue = useCallback(
    (nextRecordId?: string | null) => {
      if (nextRecordId) {
        setSelectedValidationId(nextRecordId);
        setValidationModalOpen(true);
        return;
      }

      setSelectedValidationId(null);
      setValidationModalOpen(false);
    },
    [],
  );

  const processQueue = useCallback(async () => {
    while (activeCountRef.current < MAX_CONCURRENCY && queueRef.current.length > 0) {
      const next = queueRef.current.shift();
      if (!next) continue;

      const { id, weekId: entryWeekId, imageDataUrl } = next;
      activeCountRef.current += 1;

      const run = async () => {
        try {
          updateLocalRecord(id, { status: "PROCESSING", errorMessage: null });
          await patchOrderImport(id, { status: "PROCESSING", errorMessage: null });

          const result = await aiService.analyzePrint({
            sourcePrintId: id,
            weekId: entryWeekId,
            imageDataUrl,
            catalogProducts: activeWeeklyProducts,
            allowedUnits: [...UNIT_OPTIONS],
            aliases: activeWeeklyProducts.map((p) => ({
              canonical: p.name,
              aliases: p.aliases ?? [],
            })),
            language: "pt-PT",
          });

          const normalizedPhone = normalizePhonePT(result.customer.phoneRaw ?? "");
          const matchedCustomerId = normalizedPhone ? customersByNormalizedPhone.get(normalizedPhone) ?? null : null;

          const mergedResult = {
            ...result,
            customer: {
              ...result.customer,
              matchedCustomerId,
              phoneNormalized: normalizedPhone,
              isNewCustomer: !matchedCustomerId,
              matchConfidence: matchedCustomerId ? 1 : result.customer.matchConfidence,
            },
          };

          const needsReview =
            mergedResult.order.requiresValidation ||
            mergedResult.order.overallConfidence < 0.95 ||
            !matchedCustomerId ||
            mergedResult.order.items.some((i) => i.confidence < 0.95) ||
            mergedResult.warnings.length > 0;

          const nextStatus: ImportStatus = needsReview ? "PENDING_VALIDATION" : "DRAFT_AI";

          const patch: Partial<OrderImportRecord> = {
            status: nextStatus,
            analysisResult: mergedResult,
            warnings: mergedResult.warnings,
            overallConfidence: mergedResult.order.overallConfidence,
            requiresValidation: needsReview,
            correctedDraft: buildDraftFromRecord({ analysisResult: mergedResult } as OrderImportRecord),
            aiProvider: aiMode === "worker" ? "cloudflare-worker" : "mock-provider",
            aiModel: aiMode === "worker" ? "openai-responses" : "mock-image-v1",
            aiMode: aiMode === "worker" ? "worker" : "mock",
          };

          updateLocalRecord(id, patch);
          await patchOrderImport(id, patch);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Erro inesperado na analise.";
          updateLocalRecord(id, { status: "ERROR", errorMessage: message });
          await patchOrderImport(id, { status: "ERROR", errorMessage: message });
        } finally {
          activeCountRef.current = Math.max(0, activeCountRef.current - 1);
          void processQueue();
        }
      };

      void run();
    }
  }, [activeWeeklyProducts, customersByNormalizedPhone, updateLocalRecord]);

  const enqueueAnalysis = useCallback((id: string, weekIdForEntry: string, imageDataUrl: string) => {
    queueRef.current.push({ id, weekId: weekIdForEntry, imageDataUrl });
    void processQueue();
  }, [processQueue]);

  const analyzeAllPending = useCallback(async () => {
    if (!pendingAnalysisRows.length) {
      toast("Nao ha prints por analisar.");
      return;
    }

    for (const row of pendingAnalysisRows) {
      let preview: string | null = previewById[row.id] ?? null;

      if (!preview) {
        try {
          preview = await loadRecordDataUrl(row);
          if (preview) {
            const resolved = preview;
            setPreviewById((prev) => ({ ...prev, [row.id]: resolved }));
          }
        } catch (err) {
          console.error(err);
        }
      }

      if (!preview) {
        toast.error(`Sem imagem disponivel para ${row.fileName}.`);
        continue;
      }

      enqueueAnalysis(row.id, row.weekId, preview);
    }
  }, [pendingAnalysisRows, previewById, enqueueAnalysis]);

  const deleteAllPending = useCallback(async () => {
    if (!pendingAnalysisRows.length) {
      toast("Nao ha prints por analisar.");
      return;
    }

    const confirmed = await confirm({
      title: "Apagar prints",
      message: `Apagar ${pendingAnalysisRows.length} print(s) por analisar? Esta ação não pode ser revertida.`,
      confirmLabel: "Apagar",
      tone: "danger",
    });
    if (!confirmed) return;

    const targets = [...pendingAnalysisRows];
    const ids = new Set(targets.map((row) => row.id));

    try {
      await Promise.all(targets.map((row) => deleteOrderImportRecord(row)));
      queueRef.current = queueRef.current.filter((entry) => !ids.has(entry.id));
      setImports((prev) => prev.filter((row) => !ids.has(row.id)));
      setPreviewById((prev) => {
        const next = { ...prev };
        ids.forEach((id) => delete next[id]);
        return next;
      });
      toast.success("Prints por analisar apagados.");
    } catch (err) {
      console.error(err);
      toast.error("Nao foi possivel apagar os prints.");
    }
  }, [pendingAnalysisRows, confirm]);

  const deleteAllProcessing = useCallback(async () => {
    if (!processingRows.length) {
      toast("Nao ha prints em analise.");
      return;
    }

    const confirmed = await confirm({
      title: "Apagar prints em analise",
      message: `Apagar ${processingRows.length} print(s) que ficaram em analise? Esta ação não pode ser revertida.`,
      confirmLabel: "Apagar",
      tone: "danger",
    });
    if (!confirmed) return;

    const targets = [...processingRows];
    const ids = new Set(targets.map((row) => row.id));

    try {
      await Promise.all(targets.map((row) => deleteOrderImportRecord(row)));
      queueRef.current = queueRef.current.filter((entry) => !ids.has(entry.id));
      setImports((prev) => prev.filter((row) => !ids.has(row.id)));
      setPreviewById((prev) => {
        const next = { ...prev };
        ids.forEach((id) => delete next[id]);
        return next;
      });
      toast.success("Prints em analise apagados.");
    } catch (err) {
      console.error(err);
      toast.error("Nao foi possivel apagar os prints em analise.");
    }
  }, [processingRows, confirm]);

  const resetProcessingToPending = useCallback(async () => {
    if (!processingRows.length) {
      toast("Nao ha prints em analise.");
      return;
    }

    const targets = [...processingRows];
    try {
      await Promise.all(
        targets.map((row) =>
          patchOrderImport(row.id, { status: "UPLOADED", errorMessage: null }),
        ),
      );
      const ids = new Set(targets.map((row) => row.id));
      queueRef.current = queueRef.current.filter((entry) => !ids.has(entry.id));
      setImports((prev) =>
        prev.map((row) =>
          ids.has(row.id) ? { ...row, status: "UPLOADED", errorMessage: null } : row,
        ),
      );
      toast.success("Prints repostos como por analisar. Podes voltar a analisar.");
    } catch (err) {
      console.error(err);
      toast.error("Nao foi possivel repor os prints.");
    }
  }, [processingRows]);

  const deleteAllReview = useCallback(async () => {
    if (!reviewRows.length) {
      toast("Nao ha encomendas para validar.");
      return;
    }

    const confirmed = await confirm({
      title: "Apagar encomendas",
      message: `Apagar ${reviewRows.length} encomenda(s) por validar? Esta ação não pode ser revertida.`,
      confirmLabel: "Apagar",
      tone: "danger",
    });
    if (!confirmed) return;

    const targets = [...reviewRows];
    const ids = new Set(targets.map((row) => row.id));

    try {
      await Promise.all(targets.map((row) => deleteOrderImportRecord(row)));
      queueRef.current = queueRef.current.filter((entry) => !ids.has(entry.id));
      setImports((prev) => prev.filter((row) => !ids.has(row.id)));
      setDraftById((prev) => {
        const next = { ...prev };
        ids.forEach((id) => delete next[id]);
        return next;
      });
      setPreviewById((prev) => {
        const next = { ...prev };
        ids.forEach((id) => delete next[id]);
        return next;
      });
      toast.success("Encomendas por validar apagadas.");
    } catch (err) {
      console.error(err);
      toast.error("Nao foi possivel apagar as encomendas.");
    }
  }, [reviewRows, confirm]);

  const handleImportCatalogText = async () => {
    const parsed = parseCatalogText(catalogText);
    if (!parsed.length) {
      toast.error("Nao foi possivel encontrar produtos com preco no catalogo colado.");
      return;
    }

    const ok = await confirm({
      title: "Substituir produtos pelo catalogo?",
      message: `Vao ficar apenas os ${parsed.length} produto(s) deste catalogo. Todos os outros produtos serao apagados.`,
      confirmLabel: "Substituir",
      cancelLabel: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;

    try {
      setImportingCatalog(true);
      const { created, updated, removed } = await bulkUpsertProducts(
        parsed.map((p) => ({ name: p.name, unit: p.unit, price: p.price })),
        { replace: true },
      );
      toast.success(
        `Catalogo importado: ${created} novo(s), ${updated} atualizado(s), ${removed} removido(s).`,
      );
      setCatalogText("");
    } catch (err) {
      console.error(err);
      toast.error("Nao foi possivel importar o catalogo.");
    } finally {
      setImportingCatalog(false);
    }
  };

  const handleCreateWeeklyCatalog = async () => {
    const label = newCatalogLabel.trim();
    if (!label) {
      toast.error("Define um nome para a lista semanal.");
      return;
    }
    if (!newCatalogProducts.size) {
      toast.error("Seleciona pelo menos um produto.");
      return;
    }

    try {
      setSavingCatalog(true);
      const selected = products
        .filter((p) => newCatalogProducts.has(p.id))
        .map((p) => ({
          productId: p.id,
          name: p.name,
          aliases: [],
          defaultUnit: p.unit,
          allowAlternativeUnit: true,
          price: p.price,
          isActive: true,
        }));

      const created = await createWeeklyCatalog({ weekId, label, products: selected });
      setCatalogs((prev) => [created, ...prev]);
      setSelectedCatalogId(created.id);
      setCatalogMode("weekly_catalog");
      setNewCatalogLabel("");
      setNewCatalogProducts(new Set());
      toast.success("Lista semanal criada.");
    } catch (err) {
      console.error(err);
      toast.error("Nao foi possivel criar a lista semanal.");
    } finally {
      setSavingCatalog(false);
    }
  };

  const onFilesSelected = useCallback(async (files: FileList | File[]) => {
    if (catalogMode === "weekly_catalog" && !selectedCatalog) {
      toast.error("Seleciona uma lista semanal antes do upload.");
      return;
    }

    const array = Array.from(files);
    if (!array.length) return;

    if (array.length > MAX_IMAGES_PER_SELECTION) {
      toast.error(`Maximo de ${MAX_IMAGES_PER_SELECTION} imagens por envio.`);
    }

    const limitedArray = array.slice(0, MAX_IMAGES_PER_SELECTION);

    const invalid = limitedArray.filter((f) => !isAcceptedImage(f));
    if (invalid.length > 0) {
      toast.error("Formato invalido. Usa JPG, JPEG, PNG ou WEBP.");
    }

    const validFiles = limitedArray.filter((f) => isAcceptedImage(f));
    if (!validFiles.length) return;

    setBusyUpload(true);
    try {
      for (const file of validFiles) {
        const fingerprint = await computeFingerprint(file);

        const optimized = await optimizeForFirestore(file);
        if (!optimized) {
          toast.error(`${file.name}: nao foi possivel reduzir a imagem o suficiente para guardar.`);
          continue;
        }

        const record = await createOrderImport({
          weekId,
          catalogMode,
          catalogId: catalogMode === "weekly_catalog" ? selectedCatalogId : null,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          imageDataUrl: optimized.dataUrl,
          fingerprint,
          aiMode: aiMode === "worker" ? "worker" : "mock",
        });

        setImports((prev) => [record, ...prev]);
        setPreviewById((prev) => ({ ...prev, [record.id]: optimized.dataUrl }));
      }
    } catch (err) {
      console.error(err);
      toast.error("Falha no upload/importacao de ficheiros.");
    } finally {
      setBusyUpload(false);
    }
  }, [aiMode, catalogMode, selectedCatalog, selectedCatalogId, weekId]);

  const handleDrop: React.DragEventHandler<HTMLDivElement> = async (event) => {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer?.files?.length) await onFilesSelected(event.dataTransfer.files);
  };

  useEffect(() => {
    if (!reviewRows.length) {
      setSelectedValidationId(null);
      setValidationModalOpen(false);
      return;
    }
    if (!selectedValidationId || !reviewRows.some((r) => r.id === selectedValidationId)) {
      setSelectedValidationId(reviewRows[0].id);
    }
  }, [reviewRows, selectedValidationId]);

  useEffect(() => {
    if (validationModalOpen && !reviewRows.length) {
      setValidationModalOpen(false);
    }
  }, [reviewRows.length, validationModalOpen]);

  const selectedRecord = useMemo(
    () => reviewRows.find((r) => r.id === selectedValidationId) ?? null,
    [reviewRows, selectedValidationId],
  );

  const selectedPreview = useMemo(
    () => (selectedRecord ? getPreviewSource(selectedRecord, previewById) : null),
    [previewById, selectedRecord],
  );

  useEffect(() => {
    if (!selectedRecord) return;

    setDraftById((prev) => {
      if (prev[selectedRecord.id]) return prev;
      return {
        ...prev,
        [selectedRecord.id]: selectedRecord.correctedDraft ?? buildDraftFromRecord(selectedRecord),
      };
    });

    setNewCustomerName(selectedRecord.analysisResult?.customer.displayName ?? "");
    setNewCustomerAddress("");
  }, [selectedRecord]);

  const selectedDraft = selectedRecord ? draftById[selectedRecord.id] ?? buildDraftFromRecord(selectedRecord) : undefined;

  const updateDraft = useCallback((recordId: string, patch: Partial<CorrectedOrderDraft>) => {
    setDraftById((prev) => ({
      ...prev,
      [recordId]: {
        ...(prev[recordId] ?? {
          customerId: null,
          phoneDetected: null,
          displayNameDetected: null,
          items: [],
          notes: "",
        }),
        ...patch,
      },
    }));
  }, []);

  const persistDraft = useCallback(async (recordId: string) => {
    const draft = draftById[recordId];
    if (!draft) return;
    try {
      await patchOrderImport(recordId, { correctedDraft: draft });
      updateLocalRecord(recordId, { correctedDraft: draft });
    } catch (err) {
      console.error(err);
      toast.error("Nao foi possivel guardar rascunho de validacao.");
    }
  }, [draftById, updateLocalRecord]);

  const createCustomerFromValidation = async () => {
    if (!selectedRecord || !selectedDraft) return;

    const phone = normalizePhonePT(selectedDraft.phoneDetected);
    if (!newCustomerName.trim() || !newCustomerAddress.trim()) {
      toast.error("Nome e morada sao obrigatorios para criar cliente.");
      return;
    }

    try {
      const created = await apiCreateCustomer({
        name: newCustomerName.trim(),
        address: newCustomerAddress.trim(),
        phone: phone ?? undefined,
        notes: "Criado na validacao de importacao IA.",
      });

      updateDraft(selectedRecord.id, { customerId: created.id, phoneDetected: created.phone ?? selectedDraft.phoneDetected });
      await persistDraft(selectedRecord.id);
      toast.success("Cliente criado e associado ao rascunho.");
    } catch (err) {
      console.error(err);
      toast.error("Nao foi possivel criar cliente.");
    }
  };

  const confirmSelectedImport = async () => {
    if (!selectedRecord || !selectedDraft) return;

    if (!selectedDraft.customerId) {
      toast.error("Seleciona ou cria um cliente antes de confirmar.");
      return;
    }

    const orderItems: Order["items"] = [];
    selectedDraft.items.forEach((item) => {
      const product = productsById.get(item.productId);
      if (!product) return;

      const quantity = Number(item.quantity) || 0;
      if (quantity <= 0) return;

      const validatedUnit = (item.unit ?? "").trim();

      orderItems.push({
        productId: item.productId,
        quantity,
        unit: (validatedUnit || product.unit) as Order["items"][number]["unit"],
        unitPrice: product.price,
      });
    });

    if (!orderItems.length) {
      toast.error("Sem linhas validas para criar encomenda.");
      return;
    }

    const nextRecordId =
      selectedValidationIndex >= 0 ? reviewRows[selectedValidationIndex + 1]?.id ?? null : null;

    setSavingValidation(true);
    try {
      await createOrder({
        customerId: selectedDraft.customerId,
        date: new Date().toISOString().slice(0, 10),
        status: "preparing",
        notes: [selectedDraft.notes, `Importacao IA: ${selectedRecord.id}`].filter(Boolean).join(" | "),
        items: orderItems,
      });

      // Registo de aprendizagem da IA (compara deteção original vs validação final)
      try {
        const original = buildDraftFromRecord(selectedRecord);
        const keyOf = (raw: string) => (raw || "").trim().toLowerCase();
        const finalByKey = new Map(selectedDraft.items.map((it) => [keyOf(it.productNameRaw), it]));
        const originalKeys = new Set(original.items.map((it) => keyOf(it.productNameRaw)));

        let itemEdits = 0;
        let itemsRemoved = 0;
        original.items.forEach((orig) => {
          const match = finalByKey.get(keyOf(orig.productNameRaw));
          if (!match) {
            itemsRemoved += 1;
            return;
          }
          if (
            (Number(match.quantity) || 0) !== (Number(orig.quantity) || 0) ||
            match.productId !== orig.productId
          ) {
            itemEdits += 1;
          }
        });
        const itemsAdded = selectedDraft.items.filter(
          (it) => !originalKeys.has(keyOf(it.productNameRaw)),
        ).length;

        const autoMatchedId = selectedRecord.analysisResult?.customer.matchedCustomerId ?? null;
        const customerAutoMatched = Boolean(autoMatchedId);
        const customerKept = customerAutoMatched && selectedDraft.customerId === autoMatchedId;
        const confidence =
          selectedRecord.overallConfidence ??
          selectedRecord.analysisResult?.order.overallConfidence ??
          0;

        await logAiLearningEntry({
          importId: selectedRecord.id,
          confidence,
          itemsDetected: original.items.length,
          itemsConfirmed: orderItems.length,
          itemEdits,
          itemsAdded,
          itemsRemoved,
          customerAutoMatched,
          customerKept,
          aiMode: selectedRecord.aiMode,
          aiModel: selectedRecord.aiModel,
        });
      } catch (logErr) {
        console.warn("Falha ao registar aprendizagem da IA", logErr);
      }

      // Aprendizagem real: guarda pares "texto do print -> produto" (aliases)
      // a partir da validacao, para a IA acertar nas proximas importacoes.
      try {
        const seen = new Set<string>();
        const aliasWrites: Array<Promise<void>> = [];

        const queueAlias = (rawText: string, productId: string) => {
          const raw = (rawText || "").trim();
          if (!raw || !productId) return;
          const product = productsById.get(productId);
          if (!product) return;
          const aliasText = normalizeProductName(raw);
          const canonical = normalizeProductName(product.name);
          // So guarda variacoes uteis (diferentes do nome do produto).
          if (!aliasText || aliasText === canonical || seen.has(aliasText)) return;
          seen.add(aliasText);
          aliasWrites.push(
            upsertProductAlias({
              aliasText,
              displayText: raw,
              productId: product.id,
              productName: product.name,
            }),
          );
        };

        selectedDraft.items.forEach((item) => queueAlias(item.productNameRaw, item.productId));

        (selectedRecord.analysisResult?.learningCandidates ?? []).forEach((cand) => {
          const c = cand as Record<string, unknown>;
          queueAlias(String(c.rawText ?? ""), String(c.normalizedProductId ?? ""));
        });

        if (aliasWrites.length) {
          await Promise.all(aliasWrites);
          void refreshAliases();
        }
      } catch (aliasErr) {
        console.warn("Falha ao guardar aliases da IA", aliasErr);
      }

      await deleteOrderImportRecord(selectedRecord);
      setImports((prev) => prev.filter((row) => row.id !== selectedRecord.id));
      setDraftById((prev) => {
        const next = { ...prev };
        delete next[selectedRecord.id];
        return next;
      });
      setPreviewById((prev) => {
        const next = { ...prev };
        delete next[selectedRecord.id];
        return next;
      });
      toast.success("Encomenda confirmada e integrada no fluxo normal.");
      advanceValidationQueue(nextRecordId);
    } catch (err) {
      console.error(err);
      toast.error("Nao foi possivel confirmar a encomenda.");
    } finally {
      setSavingValidation(false);
    }
  };

  const ignoreSelectedImport = async () => {
    if (!selectedRecord) return;
    try {
      const nextRecordId =
        selectedValidationIndex >= 0 ? reviewRows[selectedValidationIndex + 1]?.id ?? null : null;
      updateLocalRecord(selectedRecord.id, { status: "IGNORED" });
      await patchOrderImport(selectedRecord.id, { status: "IGNORED" });
      toast.success("Importacao marcada como ignorada.");
      advanceValidationQueue(nextRecordId);
    } catch (err) {
      console.error(err);
      toast.error("Nao foi possivel ignorar importacao.");
    }
  };

  return (
    <div className="page import-orders-page">
      <header className="page-header">
        <div>
          <h1>Importar encomendas</h1>
          <p className="page-subtitle">Upload de prints WhatsApp com validacao humana e confirmacao para encomenda real.</p>
        </div>
      </header>

      <section className="import-summary-grid">
        <article className="card import-summary-card"><span className="import-summary-label">Total de prints</span><strong>{summary.total}</strong></article>
        <article className="card import-summary-card import-summary-card--info"><span className="import-summary-label">A analisar</span><strong>{summary.processing}</strong></article>
        <article className="card import-summary-card import-summary-card--warning"><span className="import-summary-label">Para validar</span><strong>{summary.needsReview}</strong></article>
        <article className="card import-summary-card import-summary-card--accent"><span className="import-summary-label">Analisados</span><strong>{summary.analyzed}</strong></article>
        <article className="card import-summary-card import-summary-card--success"><span className="import-summary-label">Confirmados</span><strong>{summary.confirmed}</strong></article>
        <article className="card import-summary-card import-summary-card--danger"><span className="import-summary-label">Erros</span><strong>{summary.errors}</strong></article>
      </section>

      <section className="card import-config-card">
        <header className="import-step-head">
          <span className="import-step-badge">1</span>
          <div>
            <h2 className="card-title">Semana e catalogo ativo</h2>
            <p className="muted-hint">Define a semana de entrega e que catalogo de produtos a IA deve usar.</p>
          </div>
        </header>
        <div className="import-config-grid">
          <div className="field">
            <label>Semana (ISO)</label>
            <input value={weekId} onChange={(e) => setWeekId(e.target.value.toUpperCase())} placeholder="2026-W26" />
          </div>

          <div className="field">
            <label>Modo de catalogo</label>
            <select value={catalogMode} onChange={(e) => setCatalogMode(e.target.value as ImportCatalogMode)}>
              <option value="existing_products">Produtos existentes</option>
              <option value="weekly_catalog">Lista semanal</option>
            </select>
          </div>

          {catalogMode === "weekly_catalog" && (
            <div className="field">
              <label>Lista semanal</label>
              <select value={selectedCatalogId} onChange={(e) => setSelectedCatalogId(e.target.value)}>
                <option value="">Selecionar...</option>
                {catalogs.filter((c) => c.weekId === weekId).map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="import-active-products"><strong>Produtos ativos nesta configuracao: </strong><span>{activeWeeklyProducts.length}</span></div>

        <div className="import-catalog-upload">
          <h3>Importar catalogo da semana</h3>
          <p className="muted-hint">
            Cola aqui a lista da semana (formato WhatsApp). Ao importar, a lista de produtos passa a
            ser SO este catalogo (os restantes sao apagados) e os precos sao usados pela IA e nas
            folhas por cliente.
          </p>
          <div className="field">
            <label>Catalogo (colar texto)</label>
            <textarea
              rows={6}
              value={catalogText}
              onChange={(e) => setCatalogText(e.target.value)}
              placeholder={"\uD83C\uDF3f Lista da Semana \u2014 Quinta Pires\n\uD83C\uDF45 Tomate salada \u2014 1,50\u20ac/kg\n\uD83E\uDD51 Courgette \u2014 1,50\u20ac/kg\n..."}
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={importingCatalog || loadingProducts || !catalogText.trim()}
            onClick={handleImportCatalogText}
          >
            {importingCatalog ? "A importar..." : "Importar catalogo"}
          </button>
        </div>

        {catalogMode === "weekly_catalog" && (
          <div className="import-weekly-create">
            <h3>Criar lista semanal rapida</h3>
            <div className="field">
              <label>Nome da lista</label>
              <input value={newCatalogLabel} onChange={(e) => setNewCatalogLabel(e.target.value)} placeholder="Ex.: Lista semana 26" />
            </div>

            <div className="import-product-picker">
              {products.map((product) => {
                const checked = newCatalogProducts.has(product.id);
                return (
                  <label key={product.id} className="import-check-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setNewCatalogProducts((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(product.id);
                          else next.delete(product.id);
                          return next;
                        });
                      }}
                    />
                    <span>{product.name}</span>
                    <small>{product.unit}</small>
                  </label>
                );
              })}
            </div>

            <button type="button" className="btn-secondary" disabled={savingCatalog || loadingProducts} onClick={handleCreateWeeklyCatalog}>
              {savingCatalog ? "A guardar..." : "Criar lista semanal"}
            </button>
          </div>
        )}
      </section>

      <section className="card import-upload-card">
        <header className="import-step-head">
          <span className="import-step-badge">2</span>
          <div>
            <h2 className="card-title">Upload de prints</h2>
            <p className="muted-hint">Arrasta os prints do WhatsApp. As imagens sao otimizadas automaticamente.</p>
          </div>
        </header>
        <div
          className={`import-drop-zone${dragOver ? " drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <svg className="import-drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className="import-drop-title">Arrasta imagens para aqui</p>
          <p className="muted-hint">ou seleciona ficheiros &middot; JPG, PNG ou WEBP</p>
          <label className="btn-primary import-file-btn">
            Selecionar ficheiros
            <input
              type="file"
              multiple
              accept="image/jpeg,image/jpg,image/png,image/webp"
              onChange={async (e) => {
                const fileArray = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = "";
                if (fileArray.length) await onFilesSelected(fileArray);
              }}
              style={{ display: "none" }}
            />
          </label>
        </div>
        {busyUpload && (
          <p className="muted-hint import-upload-status">
            <span className="import-spinner" aria-hidden="true" /> A processar uploads...
          </p>
        )}
      </section>

      <section className="card import-list-card">
        <header className="import-step-head">
          <span className="import-step-badge">3</span>
          <div>
            <h2 className="card-title">Importacoes</h2>
            <p className="muted-hint">Prints carregados a espera de analise pela IA.</p>
          </div>
        </header>
        {loading ? (
          <p className="muted-hint">A carregar importacoes...</p>
        ) : (
          <div className="import-action-panel">
            <div className="import-action-count">
              <span className="import-action-number">{pendingAnalysisRows.length}</span>
              <span className="import-action-label">prints por analisar</span>
              {processingCount > 0 && (
                <span className="import-processing-chip">
                  <span className="import-spinner" aria-hidden="true" /> {processingCount} em analise
                </span>
              )}
            </div>
            <div className="import-action-buttons">
              <button
                type="button"
                className="btn-primary"
                onClick={analyzeAllPending}
                disabled={!pendingAnalysisRows.length}
              >
                {processingCount > 0 ? "A analisar..." : "Analisar todos"}
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={deleteAllPending}
                disabled={!pendingAnalysisRows.length}
              >
                Apagar prints
              </button>
            </div>
          </div>
        )}
        {!loading && processingRows.length > 0 && (
          <details className="import-processing-panel" open>
            <summary className="import-processing-summary">
              <span className="import-spinner" aria-hidden="true" />
              {processingRows.length} print(s) em analise
            </summary>
            <p className="muted-hint">
              Prints que ficaram presos em analise (ex.: a pagina foi fechada durante o processo).
              Podes repor para voltar a analisar, ou apagar.
            </p>
            <ul className="import-processing-list">
              {processingRows.map((row) => (
                <li key={row.id} className="import-processing-item">
                  <span className="import-processing-name" title={row.fileName}>
                    {row.fileName || row.id}
                  </span>
                  <button
                    type="button"
                    className="btn-danger import-processing-del"
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Apagar print em analise",
                        message: `Apagar "${row.fileName || row.id}"? Esta ação não pode ser revertida.`,
                        confirmLabel: "Apagar",
                        tone: "danger",
                      });
                      if (!ok) return;
                      try {
                        await deleteOrderImportRecord(row);
                        queueRef.current = queueRef.current.filter((entry) => entry.id !== row.id);
                        setImports((prev) => prev.filter((r) => r.id !== row.id));
                        setPreviewById((prev) => {
                          const next = { ...prev };
                          delete next[row.id];
                          return next;
                        });
                        toast.success("Print apagado.");
                      } catch (err) {
                        console.error(err);
                        toast.error("Nao foi possivel apagar o print.");
                      }
                    }}
                  >
                    Apagar
                  </button>
                </li>
              ))}
            </ul>
            <div className="import-action-buttons">
              <button type="button" className="btn-secondary" onClick={resetProcessingToPending}>
                Repor como por analisar
              </button>
              <button type="button" className="btn-danger" onClick={deleteAllProcessing}>
                Apagar todos em analise
              </button>
            </div>
          </details>
        )}
      </section>

      <section className="card import-validation-card">
        <header className="import-step-head">
          <span className="import-step-badge">4</span>
          <div>
            <h2 className="card-title">Validar encomendas</h2>
            <p className="muted-hint">Abre a fila, corrige e confirma. O sistema avanca automaticamente para a seguinte.</p>
          </div>
        </header>

        <div className="import-action-panel">
          <div className="import-action-count">
            <span className="import-action-number">{reviewRows.length}</span>
            <span className="import-action-label">encomendas por validar</span>
          </div>
          <div className="import-action-buttons">
            <button type="button" className="btn-primary" onClick={openValidationQueue} disabled={!reviewRows.length}>
              {reviewRows.length ? `Validar (${reviewRows.length})` : "Sem encomendas para validar"}
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={deleteAllReview}
              disabled={!reviewRows.length}
            >
              Apagar encomendas
            </button>
          </div>
        </div>
      </section>

      {validationModalOpen && selectedRecord && selectedDraft && (
        <div
          className="import-modal-backdrop"
          role="presentation"
          onClick={() => setValidationModalOpen(false)}
        >
          <div
            className="import-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-validation-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="import-modal-header">
              <div>
                <h3 id="import-validation-modal-title">Validar print</h3>
                <p>
                  {selectedValidationIndex >= 0
                    ? `${selectedValidationIndex + 1} de ${reviewRows.length}`
                    : "Fila de validação"}
                </p>
              </div>
              <div className="import-modal-header-actions">
                <button type="button" className="btn-secondary" onClick={() => setValidationModalOpen(false)}>
                  Fechar
                </button>
              </div>
            </header>

            <div className="import-validation-layout import-validation-layout-modal">
              <div className="import-validation-image-block">
                {selectedPreview ? (
                  <>
                    <img src={selectedPreview} alt={selectedRecord.fileName} className="import-validation-image" />
                    <a href={selectedPreview} target="_blank" rel="noreferrer" className="btn-secondary">Abrir imagem original</a>
                  </>
                ) : (
                  <div className="import-preview-warning">
                    <p>Preview indisponivel.</p>
                    <p>Este print foi importado antes da nova versao. Apaga-o e volta a carregar a imagem.</p>
                  </div>
                )}
              </div>

              <div className="import-validation-editor">
                <div className="import-validation-row">
                  <label>Estado atual</label>
                  <span className={statusClassName(selectedRecord.status)}>{STATUS_LABELS[selectedRecord.status]}</span>
                </div>
                <div className="import-validation-row">
                  <label>Confianca global</label>
                  <span className={confidenceClass(selectedRecord.overallConfidence ?? 0)}>
                    {typeof selectedRecord.overallConfidence === "number"
                      ? `${Math.round(selectedRecord.overallConfidence * 100)}%`
                      : "-"}
                  </span>
                </div>

                <div className="field">
                  <label>Cliente associado</label>
                  <select
                    value={selectedDraft.customerId ?? ""}
                    onChange={(e) => updateDraft(selectedRecord.id, { customerId: e.target.value || null })}
                    onBlur={() => void persistDraft(selectedRecord.id)}
                  >
                    <option value="">Selecionar cliente...</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                <div className="field">
                  <label>Telefone detetado</label>
                  <input
                    value={selectedDraft.phoneDetected ?? ""}
                    onChange={(e) => updateDraft(selectedRecord.id, { phoneDetected: e.target.value || null })}
                    onBlur={() => void persistDraft(selectedRecord.id)}
                    placeholder="351XXXXXXXXX"
                  />
                </div>

                <div className="field">
                  <label>Notas da encomenda</label>
                  <textarea
                    value={selectedDraft.notes}
                    onChange={(e) => updateDraft(selectedRecord.id, { notes: e.target.value })}
                    onBlur={() => void persistDraft(selectedRecord.id)}
                    rows={3}
                  />
                </div>

                <div className="import-lines-title">Linhas da encomenda</div>
                <div className="import-lines-editor">
                  {selectedDraft.items.map((line, index) => (
                    <div key={`${selectedRecord.id}-${index}`} className="import-line-row">
                      <select
                        value={line.productId}
                        onChange={(e) => {
                          const next = [...selectedDraft.items];
                          next[index] = { ...line, productId: e.target.value };
                          updateDraft(selectedRecord.id, { items: next });
                        }}
                        onBlur={() => void persistDraft(selectedRecord.id)}
                      >
                        <option value="">Produto...</option>
                        {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                      </select>

                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.quantity}
                        onChange={(e) => {
                          const next = [...selectedDraft.items];
                          next[index] = { ...line, quantity: Number(e.target.value) || 0 };
                          updateDraft(selectedRecord.id, { items: next });
                        }}
                        onBlur={() => void persistDraft(selectedRecord.id)}
                      />

                      <select
                        value={line.unit}
                        onChange={(e) => {
                          const next = [...selectedDraft.items];
                          next[index] = { ...line, unit: e.target.value || "kg" };
                          updateDraft(selectedRecord.id, { items: next });
                        }}
                        onBlur={() => void persistDraft(selectedRecord.id)}
                      >
                        {UNIT_OPTIONS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                      </select>

                      <span className={confidenceClass(line.confidence)}>{Math.round(line.confidence * 100)}%</span>

                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() => {
                          const next = selectedDraft.items.filter((_, idx) => idx !== index);
                          updateDraft(selectedRecord.id, { items: next });
                          void persistDraft(selectedRecord.id);
                        }}
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    const first = products[0];
                    if (!first) return;
                    const next = [
                      ...selectedDraft.items,
                      {
                        productId: first.id,
                        quantity: 1,
                        unit: first.unit,
                        productNameRaw: first.name,
                        confidence: 0.7,
                        notes: "Linha adicionada manualmente",
                      },
                    ];
                    updateDraft(selectedRecord.id, { items: next });
                    void persistDraft(selectedRecord.id);
                  }}
                >
                  Adicionar linha
                </button>

                <div className="import-new-customer-box">
                  <h3>Novo cliente (se necessario)</h3>
                  <div className="field"><label>Nome</label><input value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} /></div>
                  <div className="field"><label>Morada</label><input value={newCustomerAddress} onChange={(e) => setNewCustomerAddress(e.target.value)} /></div>
                  <button type="button" className="btn-secondary" onClick={createCustomerFromValidation}>Criar cliente</button>
                </div>

                {selectedRecord.warnings.length > 0 && (
                  <div className="import-warning-list">
                    <strong>Avisos</strong>
                    <ul>
                      {selectedRecord.warnings.map((warning, idx) => <li key={`${selectedRecord.id}-w-${idx}`}>{warning}</li>)}
                    </ul>
                  </div>
                )}

                <div className="import-validation-actions">
                  <button type="button" className="btn-secondary" onClick={ignoreSelectedImport}>Ignorar print</button>
                  <button type="button" className="btn-primary" disabled={savingValidation} onClick={confirmSelectedImport}>
                    {savingValidation ? "A confirmar..." : "Confirmar e passar ao seguinte"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportOrdersPage;
