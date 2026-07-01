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
import { normalizeProductName } from "../features/import/catalogParser";
import toast from "react-hot-toast";

export interface CatalogUpsertItem {
  name: string;
  unit: Product["unit"];
  price: number;
}

interface ProductsContextValue {
  products: Product[];
  loadingProducts: boolean;
  createProduct: (data: Omit<Product, "id"> & { id?: string }) => Promise<void>;
  updateProduct: (id: string, data: Omit<Product, "id">) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  bulkUpsertProducts: (
    items: CatalogUpsertItem[],
    options?: { replace?: boolean },
  ) => Promise<{ created: number; updated: number; removed: number }>;
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

  const handleBulkUpsertProducts = async (
    items: CatalogUpsertItem[],
    options?: { replace?: boolean },
  ): Promise<{ created: number; updated: number; removed: number }> => {
    const byNormalizedName = new Map(
      products.map((p) => [normalizeProductName(p.name), p] as const),
    );

    const catalogKeys = new Set(
      items.map((item) => normalizeProductName(item.name)).filter(Boolean),
    );

    const updates: Array<{ id: string; data: Omit<Product, "id"> }> = [];
    const creates: CatalogUpsertItem[] = [];

    for (const item of items) {
      const key = normalizeProductName(item.name);
      if (!key) continue;
      const existing = byNormalizedName.get(key);
      if (existing) {
        // Preços seguem o catálogo; a unidade existente é preservada.
        if (existing.price !== item.price) {
          updates.push({
            id: existing.id,
            data: { name: existing.name, unit: existing.unit, price: item.price },
          });
        }
      } else {
        creates.push(item);
      }
    }

    // Em modo "replace", apaga os produtos que não constam do catálogo.
    const removals = options?.replace
      ? products.filter((p) => !catalogKeys.has(normalizeProductName(p.name)))
      : [];

    for (const r of removals) {
      await apiDeleteProduct(r.id);
    }

    for (const u of updates) {
      await apiUpdateProduct(u.id, u.data);
    }

    const createdProducts: Product[] = [];
    for (const c of creates) {
      const created = await apiCreateProduct({
        name: c.name,
        unit: c.unit,
        price: c.price,
      });
      createdProducts.push(created);
    }

    if (updates.length || createdProducts.length || removals.length) {
      const removedIds = new Set(removals.map((r) => r.id));
      setProducts((prev) => {
        const updateById = new Map(updates.map((u) => [u.id, u.data] as const));
        let next = prev
          .filter((p) => !removedIds.has(p.id))
          .map((p) => {
            const patch = updateById.get(p.id);
            return patch ? ({ id: p.id, ...patch } as Product) : p;
          });
        next = [...next, ...createdProducts];
        next.sort((a, b) => a.name.localeCompare(b.name, "pt-PT"));
        return next;
      });
    }

    return {
      created: createdProducts.length,
      updated: updates.length,
      removed: removals.length,
    };
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
        bulkUpsertProducts: handleBulkUpsertProducts,
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
