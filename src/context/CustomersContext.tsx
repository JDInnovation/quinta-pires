import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Customer } from "../types";
import {
  fetchCustomers,
  createCustomer as apiCreateCustomer,
  updateCustomer as apiUpdateCustomer,
  deleteCustomer as apiDeleteCustomer,
} from "../features/customers/api";
import toast from "react-hot-toast";

interface CustomersContextValue {
  customers: Customer[];
  loadingCustomers: boolean;
  createCustomer: (data: Omit<Customer, "id">) => Promise<void>;
  updateCustomer: (id: string, data: Omit<Customer, "id">) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
}

const CustomersContext = createContext<CustomersContextValue | undefined>(undefined);

export const CustomersProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchCustomers();
        setCustomers(data);
      } catch (err) {
        console.error("Erro ao carregar clientes:", err);
        toast.error("Não foi possível carregar clientes.");
      } finally {
        setLoadingCustomers(false);
      }
    })();
  }, []);

  const handleCreateCustomer = async (data: Omit<Customer, "id">) => {
    const created = await apiCreateCustomer(data);
    setCustomers((prev) => [created, ...prev]);
    toast.success(`Cliente "${data.name}" criado.`);
  };

  const handleUpdateCustomer = async (id: string, data: Omit<Customer, "id">) => {
    await apiUpdateCustomer(id, data);
    setCustomers((prev) => prev.map((c) => (c.id === id ? { id, ...data } : c)));
    toast.success(`Cliente "${data.name}" atualizado.`);
  };

  const handleDeleteCustomer = async (id: string) => {
    const prev = customers;
    setCustomers((p) => p.filter((c) => c.id !== id));
    try {
      await apiDeleteCustomer(id);
      toast.success("Cliente apagado.");
    } catch (err) {
      console.error("Erro ao apagar cliente:", err);
      setCustomers(prev);
      toast.error("Não foi possível apagar o cliente.");
      throw err;
    }
  };

  return (
    <CustomersContext.Provider
      value={{
        customers,
        loadingCustomers,
        createCustomer: handleCreateCustomer,
        updateCustomer: handleUpdateCustomer,
        deleteCustomer: handleDeleteCustomer,
      }}
    >
      {children}
    </CustomersContext.Provider>
  );
};

export function useCustomers() {
  const ctx = useContext(CustomersContext);
  if (!ctx) throw new Error("useCustomers must be used within CustomersProvider");
  return ctx;
}
