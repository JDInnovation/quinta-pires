import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Order } from "../types";
import {
  fetchOrders,
  createOrder as apiCreateOrder,
  updateOrder as apiUpdateOrder,
  updateOrderStatus as apiUpdateOrderStatus,
  deleteOrder as apiDeleteOrder,
} from "../features/orders/api";
import toast from "react-hot-toast";

interface OrdersContextValue {
  orders: Order[];
  loadingOrders: boolean;
  createOrder: (data: Omit<Order, "id">) => Promise<void>;
  updateOrder: (orderId: string, data: Omit<Order, "id">) => Promise<void>;
  updateOrderStatus: (orderId: string, status: Order["status"]) => Promise<void>;
  deleteOrder: (orderId: string) => Promise<void>;
}

const OrdersContext = createContext<OrdersContextValue | undefined>(undefined);

export const OrdersProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchOrders();
        setOrders(data);
      } catch (err) {
        console.error("Erro ao carregar encomendas:", err);
        toast.error("Não foi possível carregar encomendas.");
      } finally {
        setLoadingOrders(false);
      }
    })();
  }, []);

  const handleCreateOrder = async (data: Omit<Order, "id">) => {
    const created = await apiCreateOrder(data);
    setOrders((prev) => [created, ...prev]);
    toast.success("Encomenda criada com sucesso.");
  };

  const handleUpdateOrder = async (orderId: string, data: Omit<Order, "id">) => {
    await apiUpdateOrder(orderId, data);
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { id: orderId, ...data } : o)));
    toast.success("Encomenda atualizada.");
  };

  const handleUpdateOrderStatus = async (orderId: string, status: Order["status"]) => {
    await apiUpdateOrderStatus(orderId, status);
    setOrders((prev) =>
      prev.map((order) => (order.id === orderId ? { ...order, status } : order))
    );
  };

  const handleDeleteOrder = async (orderId: string) => {
    const prev = orders;
    setOrders((p) => p.filter((o) => o.id !== orderId));
    try {
      await apiDeleteOrder(orderId);
      toast.success("Encomenda apagada.");
    } catch (err) {
      console.error("Erro ao apagar encomenda:", err);
      try {
        const fresh = await fetchOrders();
        setOrders(fresh);
      } catch {
        setOrders(prev);
      }
      toast.error("Não foi possível apagar a encomenda.");
      throw err;
    }
  };

  return (
    <OrdersContext.Provider
      value={{
        orders,
        loadingOrders,
        createOrder: handleCreateOrder,
        updateOrder: handleUpdateOrder,
        updateOrderStatus: handleUpdateOrderStatus,
        deleteOrder: handleDeleteOrder,
      }}
    >
      {children}
    </OrdersContext.Provider>
  );
};

export function useOrders() {
  const ctx = useContext(OrdersContext);
  if (!ctx) throw new Error("useOrders must be used within OrdersProvider");
  return ctx;
}
