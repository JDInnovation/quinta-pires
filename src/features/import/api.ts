import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import type {
  CorrectedOrderDraft,
  CreateOrderImportInput,
  ImportedOrderAnalysis,
  ImportCatalogMode,
  OrderImportRecord,
  WeeklyCatalog,
  WeeklyCatalogProduct,
  AiLearningEntry,
  CreateAiLearningEntryInput,
  ProductAlias,
  UpsertProductAliasInput,
  CustomerAlias,
  UpsertCustomerAliasInput,
  CustomerPreference,
  UpsertCustomerPreferenceInput,
  ProductUnitPref,
  BumpProductUnitPrefInput,
  AiCorrection,
  UpsertAiCorrectionInput,
} from "./types";

const orderImportsCol = collection(db, "orderImports");
const weeklyCatalogsCol = collection(db, "weeklyCatalogs");
const aiLearningCol = collection(db, "aiLearningLog");
const productAliasesCol = collection(db, "productAliases");
const customerAliasesCol = collection(db, "customerAliases");
const customerPreferencesCol = collection(db, "customerPreferences");
const productUnitPrefsCol = collection(db, "productUnitPrefs");
const aiCorrectionsCol = collection(db, "aiCorrections");

function safeDocId(text: string): string {
  return text.replace(/\s+/g, "-").replace(/[/#?[\]]/g, "_").slice(0, 140);
}

function toOrderImportRecord(id: string, raw: Record<string, unknown>): OrderImportRecord {
  return {
    id,
    weekId: String(raw.weekId ?? ""),
    catalogMode: (raw.catalogMode as ImportCatalogMode) ?? "existing_products",
    catalogId: (raw.catalogId as string | null) ?? null,
    status: (raw.status as OrderImportRecord["status"]) ?? "UPLOADED",
    fileName: String(raw.fileName ?? ""),
    fileSize: Number(raw.fileSize ?? 0),
    fileType: String(raw.fileType ?? ""),
    storagePath: String(raw.storagePath ?? ""),
    downloadURL: String(raw.downloadURL ?? ""),
    imageDataUrl: String(raw.imageDataUrl ?? ""),
    fingerprint: String(raw.fingerprint ?? ""),
    aiProvider: String(raw.aiProvider ?? "mock-provider"),
    aiMode: (raw.aiMode as "mock" | "worker" | "live") ?? "mock",
    aiModel: String(raw.aiModel ?? "mock-image-v1"),
    overallConfidence:
      typeof raw.overallConfidence === "number" ? raw.overallConfidence : null,
    requiresValidation: Boolean(raw.requiresValidation ?? true),
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.map((w) => String(w))
      : [],
    errorMessage: typeof raw.errorMessage === "string" ? raw.errorMessage : null,
    analysisResult: (raw.analysisResult as ImportedOrderAnalysis | null) ?? null,
    correctedDraft: (raw.correctedDraft as CorrectedOrderDraft | null) ?? null,
    confirmedOrderId:
      typeof raw.confirmedOrderId === "string" ? raw.confirmedOrderId : null,
    confirmedAt: raw.confirmedAt,
    confirmedBy: typeof raw.confirmedBy === "string" ? raw.confirmedBy : null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function toWeeklyCatalog(id: string, raw: Record<string, unknown>): WeeklyCatalog {
  return {
    id,
    weekId: String(raw.weekId ?? ""),
    label: String(raw.label ?? ""),
    mode: (raw.mode as ImportCatalogMode) ?? "weekly_catalog",
    products: Array.isArray(raw.products)
      ? (raw.products as WeeklyCatalogProduct[])
      : [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export async function createOrderImport(
  input: CreateOrderImportInput,
): Promise<OrderImportRecord> {
  const payload = {
    ...input,
    storagePath: input.storagePath ?? "",
    downloadURL: input.downloadURL ?? "",
    imageDataUrl: input.imageDataUrl ?? "",
    status: "UPLOADED",
    aiProvider: input.aiMode === "mock" ? "mock-provider" : "cloudflare-worker",
    aiModel: input.aiMode === "mock" ? "mock-image-v1" : "openai-responses",
    overallConfidence: null,
    requiresValidation: true,
    warnings: [],
    errorMessage: null,
    analysisResult: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const docRef = await addDoc(orderImportsCol, payload);
  return {
    id: docRef.id,
    ...payload,
  } as OrderImportRecord;
}

export async function listOrderImports(): Promise<OrderImportRecord[]> {
  const snap = await getDocs(orderImportsCol);
  const items = snap.docs.map((d) =>
    toOrderImportRecord(d.id, d.data() as Record<string, unknown>),
  );

  return items.sort((a, b) => {
    const aMs = Number((a.createdAt as { seconds?: number })?.seconds ?? 0);
    const bMs = Number((b.createdAt as { seconds?: number })?.seconds ?? 0);
    return bMs - aMs;
  });
}

export async function findOrderImportByFingerprint(
  fingerprint: string,
): Promise<OrderImportRecord | null> {
  const q = query(orderImportsCol, where("fingerprint", "==", fingerprint));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const first = snap.docs[0];
  return toOrderImportRecord(first.id, first.data() as Record<string, unknown>);
}

export async function patchOrderImport(
  id: string,
  patch: Partial<OrderImportRecord>,
): Promise<void> {
  const refDoc = doc(orderImportsCol, id);
  const payload: Record<string, unknown> = {
    ...patch,
    updatedAt: serverTimestamp(),
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) {
      delete payload[key];
    }
  });

  await updateDoc(refDoc, payload);
}

export async function deleteOrderImportRecord(record: OrderImportRecord): Promise<void> {
  const docRef = doc(orderImportsCol, record.id);
  await deleteDoc(docRef);
}

export async function logAiLearningEntry(
  input: CreateAiLearningEntryInput,
): Promise<void> {
  await addDoc(aiLearningCol, {
    ...input,
    createdAt: serverTimestamp(),
  });
}

export async function listAiLearningEntries(): Promise<AiLearningEntry[]> {
  const snap = await getDocs(aiLearningCol);
  const rows = snap.docs.map((d) => {
    const raw = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      importId: String(raw.importId ?? ""),
      confidence: Number(raw.confidence ?? 0),
      itemsDetected: Number(raw.itemsDetected ?? 0),
      itemsConfirmed: Number(raw.itemsConfirmed ?? 0),
      itemEdits: Number(raw.itemEdits ?? 0),
      itemsAdded: Number(raw.itemsAdded ?? 0),
      itemsRemoved: Number(raw.itemsRemoved ?? 0),
      customerAutoMatched: Boolean(raw.customerAutoMatched ?? false),
      customerKept: Boolean(raw.customerKept ?? false),
      aiMode: String(raw.aiMode ?? ""),
      aiModel: String(raw.aiModel ?? ""),
      createdAt: raw.createdAt,
    } satisfies AiLearningEntry;
  });
  return rows.sort((a, b) => {
    const aMs = Number((a.createdAt as { seconds?: number })?.seconds ?? 0);
    const bMs = Number((b.createdAt as { seconds?: number })?.seconds ?? 0);
    return aMs - bMs;
  });
}

export async function listProductAliases(): Promise<ProductAlias[]> {
  const snap = await getDocs(productAliasesCol);
  const rows = snap.docs.map((d) => {
    const raw = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      aliasText: String(raw.aliasText ?? ""),
      displayText: String(raw.displayText ?? ""),
      productId: String(raw.productId ?? ""),
      productName: String(raw.productName ?? ""),
      count: Number(raw.count ?? 0),
      updatedAt: raw.updatedAt,
    } satisfies ProductAlias;
  });
  return rows.sort((a, b) => b.count - a.count);
}

export async function upsertProductAlias(
  input: UpsertProductAliasInput,
): Promise<void> {
  const id = input.aliasText.replace(/\s+/g, "-").slice(0, 140);
  if (!id || !input.productId) return;
  const ref = doc(productAliasesCol, id);
  await setDoc(
    ref,
    {
      aliasText: input.aliasText,
      displayText: input.displayText,
      productId: input.productId,
      productName: input.productName,
      count: increment(1),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

// --- Aliases de cliente (nome/apelido do print -> cliente) ---
export async function listCustomerAliases(): Promise<CustomerAlias[]> {
  const snap = await getDocs(customerAliasesCol);
  const rows = snap.docs.map((d) => {
    const raw = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      aliasText: String(raw.aliasText ?? ""),
      displayText: String(raw.displayText ?? ""),
      customerId: String(raw.customerId ?? ""),
      customerName: String(raw.customerName ?? ""),
      count: Number(raw.count ?? 0),
      updatedAt: raw.updatedAt,
    } satisfies CustomerAlias;
  });
  return rows.sort((a, b) => b.count - a.count);
}

export async function upsertCustomerAlias(
  input: UpsertCustomerAliasInput,
): Promise<void> {
  const id = safeDocId(input.aliasText);
  if (!id || !input.customerId) return;
  const ref = doc(customerAliasesCol, id);
  await setDoc(
    ref,
    {
      aliasText: input.aliasText,
      displayText: input.displayText,
      customerId: input.customerId,
      customerName: input.customerName,
      count: increment(1),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

// --- Preferencias de cliente (instrucoes recorrentes por cliente) ---
export async function listCustomerPreferences(): Promise<CustomerPreference[]> {
  const snap = await getDocs(customerPreferencesCol);
  const rows = snap.docs.map((d) => {
    const raw = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      customerId: String(raw.customerId ?? ""),
      customerName: String(raw.customerName ?? ""),
      text: String(raw.text ?? ""),
      count: Number(raw.count ?? 0),
      updatedAt: raw.updatedAt,
    } satisfies CustomerPreference;
  });
  return rows.sort((a, b) => b.count - a.count);
}

export async function upsertCustomerPreference(
  input: UpsertCustomerPreferenceInput,
): Promise<void> {
  const key = input.text.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 100);
  if (!input.customerId || !key) return;
  const id = `${input.customerId}__${key}`;
  const ref = doc(customerPreferencesCol, id);
  await setDoc(
    ref,
    {
      customerId: input.customerId,
      customerName: input.customerName,
      text: input.text.trim(),
      count: increment(1),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

// --- Unidade preferida por produto ---
export async function listProductUnitPrefs(): Promise<ProductUnitPref[]> {
  const snap = await getDocs(productUnitPrefsCol);
  return snap.docs.map((d) => {
    const raw = d.data() as Record<string, unknown>;
    const counts = (raw.unitCounts as Record<string, unknown>) ?? {};
    const unitCounts: Record<string, number> = {};
    Object.keys(counts).forEach((k) => {
      unitCounts[k] = Number(counts[k] ?? 0);
    });
    return {
      id: d.id,
      productId: String(raw.productId ?? d.id),
      productName: String(raw.productName ?? ""),
      unitCounts,
      updatedAt: raw.updatedAt,
    } satisfies ProductUnitPref;
  });
}

export async function bumpProductUnitPref(
  input: BumpProductUnitPrefInput,
): Promise<void> {
  const unit = (input.unit ?? "").trim();
  if (!input.productId || !unit) return;
  const ref = doc(productUnitPrefsCol, input.productId);
  await setDoc(
    ref,
    {
      productId: input.productId,
      productName: input.productName,
      unitCounts: { [unit]: increment(1) },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

// --- Correcoes (aprendizagem negativa: evitar mapeamentos errados) ---
export async function listAiCorrections(): Promise<AiCorrection[]> {
  const snap = await getDocs(aiCorrectionsCol);
  const rows = snap.docs.map((d) => {
    const raw = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      aliasText: String(raw.aliasText ?? ""),
      displayText: String(raw.displayText ?? ""),
      fromProductId: String(raw.fromProductId ?? ""),
      fromProductName: String(raw.fromProductName ?? ""),
      toProductId: String(raw.toProductId ?? ""),
      toProductName: String(raw.toProductName ?? ""),
      count: Number(raw.count ?? 0),
      updatedAt: raw.updatedAt,
    } satisfies AiCorrection;
  });
  return rows.sort((a, b) => b.count - a.count);
}

export async function upsertAiCorrection(
  input: UpsertAiCorrectionInput,
): Promise<void> {
  const id = safeDocId(input.aliasText);
  if (!id || !input.toProductId) return;
  const ref = doc(aiCorrectionsCol, id);
  await setDoc(
    ref,
    {
      aliasText: input.aliasText,
      displayText: input.displayText,
      fromProductId: input.fromProductId,
      fromProductName: input.fromProductName,
      toProductId: input.toProductId,
      toProductName: input.toProductName,
      count: increment(1),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function listWeeklyCatalogs(): Promise<WeeklyCatalog[]> {
  const snap = await getDocs(weeklyCatalogsCol);
  const rows = snap.docs.map((d) =>
    toWeeklyCatalog(d.id, d.data() as Record<string, unknown>),
  );

  return rows.sort((a, b) => b.weekId.localeCompare(a.weekId, "pt-PT"));
}

export async function createWeeklyCatalog(input: {
  weekId: string;
  label: string;
  products: WeeklyCatalogProduct[];
}): Promise<WeeklyCatalog> {
  const payload = {
    weekId: input.weekId,
    label: input.label,
    mode: "weekly_catalog" as const,
    products: input.products,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const docRef = await addDoc(weeklyCatalogsCol, payload);
  return {
    id: docRef.id,
    ...payload,
  };
}
