import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
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
} from "./types";

const orderImportsCol = collection(db, "orderImports");
const weeklyCatalogsCol = collection(db, "weeklyCatalogs");
const aiLearningCol = collection(db, "aiLearningLog");

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
