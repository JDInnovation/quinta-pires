import {
  collection,
  getDocs,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import type { Order } from "../../types";

const ordersCol = collection(db, "orders");

export async function fetchOrders(): Promise<Order[]> {
  const snapshot = await getDocs(ordersCol);
  return snapshot.docs.map((d) => {
    const data = d.data() as Omit<Order, "id">;
    return { ...data, id: d.id };
    
  });
}

export async function createOrder(data: Omit<Order, "id">): Promise<Order> {
  const payload: any = { ...data, createdAt: serverTimestamp() };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  const ref = await addDoc(ordersCol, payload);
  return { ...data, id: ref.id };

}

// ✅ ESTA era a export em falta
export async function updateOrder(orderId: string, data: Omit<Order, "id">): Promise<void> {
  const ref = doc(ordersCol, orderId);

  const payload: any = { ...data };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  await updateDoc(ref, payload);
}

export async function updateOrderStatus(
  orderId: string,
  status: Order["status"]
): Promise<void> {
  const ref = doc(ordersCol, orderId);
  await updateDoc(ref, { status });
}

export async function deleteOrder(orderId: string): Promise<void> {
  const ref = doc(ordersCol, orderId);
  await deleteDoc(ref);
}
