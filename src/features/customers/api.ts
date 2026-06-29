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
import type { Customer } from "../../types";

const customersCol = collection(db, "customers");

export async function fetchCustomers(): Promise<Customer[]> {
  const snapshot = await getDocs(customersCol);
  return snapshot.docs.map((d) => {
    const data = d.data() as Omit<Customer, "id">;
    return {
      id: d.id,
      ...data,
    };
  });
}

function buildPayload(data: Omit<Customer, "id">) {
  const payload: any = {
    ...data,
  };

  // remove campos undefined (Firestore não gosta de undefined)
  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) {
      delete payload[key];
    }
  });

  return payload;
}

export async function createCustomer(
  data: Omit<Customer, "id">
): Promise<Customer> {
  const payload = {
    ...buildPayload(data),
    createdAt: serverTimestamp(),
  };

  const docRef = await addDoc(customersCol, payload);

  return {
    id: docRef.id,
    ...data,
  };
}

export async function updateCustomer(
  id: string,
  data: Omit<Customer, "id">
): Promise<void> {
  const ref = doc(customersCol, id);
  const payload = {
    ...buildPayload(data),
    updatedAt: serverTimestamp(),
  };
  await updateDoc(ref, payload);
}

export async function deleteCustomer(id: string): Promise<void> {
  const ref = doc(customersCol, id);
  await deleteDoc(ref);
}
