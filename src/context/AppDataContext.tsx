import type { ReactNode } from "react";
import { CustomersProvider, useCustomers } from "./CustomersContext";
import { ProductsProvider, useProducts } from "./ProductsContext";
import { OrdersProvider, useOrders } from "./OrdersContext";

/**
 * Wrapper que compõe os 3 contextos separados.
 * Mantém retrocompatibilidade com `useAppData()`.
 */
export const AppDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => (
  <CustomersProvider>
    <ProductsProvider>
      <OrdersProvider>{children}</OrdersProvider>
    </ProductsProvider>
  </CustomersProvider>
);

/** Hook de conveniência que agrega os 3 contextos. */
export const useAppData = () => {
  const customersCtx = useCustomers();
  const productsCtx = useProducts();
  const ordersCtx = useOrders();
  return { ...customersCtx, ...productsCtx, ...ordersCtx };
};

// Re-export dos hooks individuais para uso direto
export { useCustomers } from "./CustomersContext";
export { useProducts } from "./ProductsContext";
export { useOrders } from "./OrdersContext";
