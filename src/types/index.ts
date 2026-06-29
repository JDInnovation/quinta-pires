// src/types/index.ts

export type ProductUnit = "kg" | "un" | "molho";

export interface Customer {
  id: string;
  name: string;
  nif?: string;
  address: string;
  phone?: string;
  notes?: string;
}

export interface Product {
  id: string;
  name: string;
  unit: ProductUnit;
  price: number; // por unidade
}

export interface OrderItem {
  productId: string;
  quantity: number;
  unit?: ProductUnit;
  unitPrice: number;
}



export type OrderStatus = "preparing" | "delivered" | "cancelled";

export interface Order {
  id: string;
  customerId: string;
  date: string;
  deliveryDate?: string;
  items: OrderItem[];
  status: OrderStatus;
  notes?: string;
}

