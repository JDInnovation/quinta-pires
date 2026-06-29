// src/features/dashboard/mockData.ts
// src/features/dashboard/mockData.ts
import type { Order, Product } from "../../types";

export const productsMock: Product[] = [
  { id: "broccoli", name: "Brócolos", unit: "kg", price: 2.5 },
  { id: "kale", name: "Couve Kale", unit: "molho", price: 0.8 },
  { id: "orange", name: "Laranja Algarve", unit: "kg", price: 2.0 },
];

export const ordersMock: Order[] = [
  {
    id: "ord-1",
    customerId: "c1",
    date: "2025-12-01",
    deliveryDate: "2025-12-01",
    status: "delivered",
    items: [
      { productId: "broccoli", quantity: 5, unitPrice: 2.5 },
      { productId: "orange", quantity: 3, unitPrice: 2.0 },
    ],
  },
  {
    id: "ord-2",
    customerId: "c2",
    date: "2025-12-02",
    deliveryDate: "2025-12-02",
    status: "delivered",
    items: [
      { productId: "kale", quantity: 4, unitPrice: 0.8 },
      { productId: "orange", quantity: 6, unitPrice: 2.0 },
    ],
  },
  {
    id: "ord-3",
    customerId: "c3",
    date: "2025-12-03",
    deliveryDate: "2025-12-03",
    status: "delivered",
    items: [
      { productId: "broccoli", quantity: 2, unitPrice: 2.5 },
      { productId: "kale", quantity: 3, unitPrice: 0.8 },
    ],
  },
];
