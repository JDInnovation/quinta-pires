import {
  collection,
  getDocs,
  addDoc,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import type { Product } from "../../types";

const productsCol = collection(db, "products");

export async function fetchProducts(): Promise<Product[]> {
  const snapshot = await getDocs(productsCol);
  return snapshot.docs.map((d) => {
    const data = d.data() as Omit<Product, "id">;
    return { ...data, id: d.id };
  });
}

/**
 * Cria produtos base no Firestore se a coleção estiver vazia.
 * Útil para migração do "initialProducts" (hardcoded) para Firestore.
 */
export async function seedProductsIfEmpty(seed: Product[]): Promise<void> {
  const snapshot = await getDocs(productsCol);
  if (!snapshot.empty) return;

  const batch = writeBatch(db);
  for (const p of seed) {
    const ref = doc(db, "products", p.id);
    batch.set(ref, {
      name: p.name,
      unit: p.unit,
      price: p.price,
    });
  }
  await batch.commit();
}

/**
 * Cria um produto. Se enviares um `id`, cria/usa esse ID como docId (ex: "brocolos-roxos").
 * Se não enviares, cria um docId aleatório.
 */
export async function createProduct(
  data: Omit<Product, "id"> & { id?: string }
): Promise<Product> {
  const { id, ...rest } = data;
  const payload: any = { ...rest };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  if (id && id.trim()) {
    const ref = doc(db, "products", id.trim());
    await setDoc(ref, payload, { merge: false });
    return { ...(rest as Omit<Product, "id">), id: id.trim() };
  }

  const ref = await addDoc(productsCol, payload);
  return { ...(rest as Omit<Product, "id">), id: ref.id };
}

export async function updateProduct(
  productId: string,
  data: Omit<Product, "id">
): Promise<void> {
  const ref = doc(db, "products", productId);
  const payload: any = { ...data };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
  await updateDoc(ref, payload);
}

export async function deleteProduct(productId: string): Promise<void> {
  const ref = doc(db, "products", productId);
  await deleteDoc(ref);
}
