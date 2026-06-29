import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Product } from "../types";
import {
  fetchProducts,
  seedProductsIfEmpty,
  createProduct as apiCreateProduct,
  updateProduct as apiUpdateProduct,
  deleteProduct as apiDeleteProduct,
} from "../features/products/api";
import { initialProducts } from "../data/initialProducts";
import toast from "react-hot-toast";

interface ProductsContextValue {
  products: Product[];
  loadingProducts: boolean;
  createProduct: (data: Omit<Product, "id"> & { id?: string }) => Promise<void>;
  updateProduct: (id: string, data: Omit<Product, "id">) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
}

const ProductsContext = createContext<ProductsContextValue | undefined>(undefined);

export const ProductsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        let data = await fetchProducts();
        if (!data.length) {
          await seedProductsIfEmpty(initialProducts);
          data = await fetchProducts();
        }
        data.sort((a, b) => a.name.localeCompare(b.name, "pt-PT"));
        setProducts(data);
      } catch (err) {
        console.error("Erro ao carregar produtos:", err);
        setProducts(initialProducts);
        toast.error("Erro ao carregar produtos do servidor.");
      } finally {
        setLoadingProducts(false);
      }
    })();
  }, []);

  const handleCreateProduct = async (data: Omit<Product, "id"> & { id?: string }) => {
    const created = await apiCreateProduct(data);
    setProducts((prev) => {
      const next = [created, ...prev];
      next.sort((a, b) => a.name.localeCompare(b.name, "pt-PT"));
      return next;
    });
    toast.success(`Produto "${data.name}" criado.`);
  };

  const handleUpdateProduct = async (id: string, data: Omit<Product, "id">) => {
    await apiUpdateProduct(id, data);
    setProducts((prev) => {
      const next = prev.map((p) => (p.id === id ? { id, ...data } : p));
      next.sort((a, b) => a.name.localeCompare(b.name, "pt-PT"));
      return next;
    });
    toast.success(`Produto "${data.name}" atualizado.`);
  };

  const handleDeleteProduct = async (id: string) => {
    const prev = products;
    setProducts((p) => p.filter((prod) => prod.id !== id));
    try {
      await apiDeleteProduct(id);
      toast.success("Produto apagado.");
    } catch (err) {
      console.error("Erro ao apagar produto:", err);
      try {
        const fresh = await fetchProducts();
        fresh.sort((a, b) => a.name.localeCompare(b.name, "pt-PT"));
        setProducts(fresh);
      } catch {
        setProducts(prev);
      }
      toast.error("Não foi possível apagar o produto.");
      throw err;
    }
  };

  return (
    <ProductsContext.Provider
      value={{
        products,
        loadingProducts,
        createProduct: handleCreateProduct,
        updateProduct: handleUpdateProduct,
        deleteProduct: handleDeleteProduct,
      }}
    >
      {children}
    </ProductsContext.Provider>
  );
};

export function useProducts() {
  const ctx = useContext(ProductsContext);
  if (!ctx) throw new Error("useProducts must be used within ProductsProvider");
  return ctx;
}
