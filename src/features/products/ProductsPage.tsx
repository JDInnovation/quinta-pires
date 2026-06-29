import React, { useEffect, useMemo, useState } from "react";
import type { Product, ProductUnit } from "../../types";
import { useProducts } from "../../context/ProductsContext";
import { useConfirm } from "../../components/ConfirmProvider";
import toast from "react-hot-toast";

type Unit = ProductUnit;

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function toNumber(v: string): number {
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

type Draft = { name: string; unit: Unit; price: string };

const ProductsPage: React.FC = () => {
  const confirm = useConfirm();
  const {
    products,
    loadingProducts,
    createProduct,
    updateProduct,
    deleteProduct,
  } = useProducts();

  // filtros
  const [q, setQ] = useState<string>("");
  const [unitFilter, setUnitFilter] = useState<Unit | "all">("all");

  // drafts para edição inline
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  // Form de novo produto
  const [newName, setNewName] = useState<string>("");
  const [newUnit, setNewUnit] = useState<Unit>("kg");
  const [newPrice, setNewPrice] = useState<string>("");
  const [newId, setNewId] = useState<string>("");
  const autoId = useMemo(() => slugify(newName), [newName]);

  // Inicializa/atualiza drafts sem rebentar o que o user já está a editar
  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, Draft> = { ...prev };
      for (const p of products) {
        if (!next[p.id]) {
          next[p.id] = {
            name: p.name,
            unit: p.unit || "kg",
            price: String(p.price ?? 0),
          };
        }
      }
      // remove drafts de produtos que já não existem
      Object.keys(next).forEach((id) => {
        if (!products.some((p) => p.id === id)) delete next[id];
      });
      return next;
    });
  }, [products]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();

    return products
      .filter((p) => {
        const matchesQ =
          !query ||
          p.name.toLowerCase().includes(query) ||
          p.id.toLowerCase().includes(query);
        const matchesUnit = unitFilter === "all" ? true : p.unit === unitFilter;
        return matchesQ && matchesUnit;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-PT"));
  }, [products, q, unitFilter]);

  const handleDraftChange = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }));
  };

  const isDirty = (p: Product): boolean => {
    const d = drafts[p.id];
    if (!d) return false;
    const price = toNumber(d.price);
    return d.name !== p.name || d.unit !== p.unit || price !== p.price;
  };

  const handleSaveRow = async (p: Product) => {
    const d = drafts[p.id];
    if (!d) return;

    const name = d.name.trim();
    const price = toNumber(d.price);

    if (!name) {
      toast.error("O nome do produto não pode ficar vazio.");
      return;
    }

    if (!Number.isFinite(price) || price < 0) {
      toast.error("O preço tem de ser um número válido (>= 0).");
      return;
    }

    try {
      await updateProduct(p.id, {
        name,
        unit: d.unit,
        price,
      });
    } catch {
      toast.error("Não foi possível guardar.");
    }
  };

  const handleResetRow = (p: Product) => {
    setDrafts((prev) => ({
      ...prev,
      [p.id]: {
        name: p.name,
        unit: p.unit || "kg",
        price: String(p.price ?? 0),
      },
    }));
  };

  const handleDelete = async (p: Product) => {
    const ok = await confirm({
      title: "Apagar produto",
      message: `Apagar o produto "${p.name}"? Encomendas antigas podem ficar sem nome de produto se este ID for usado nelas.`,
      confirmLabel: "Apagar",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await deleteProduct(p.id);
    } catch {
      toast.error("Não foi possível apagar.");
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    const id = (newId.trim() || autoId).trim();
    const price = toNumber(newPrice);

    if (!name) {
      toast.error("Escreve o nome do produto.");
      return;
    }

    if (!id) {
      toast.error("O ID do produto não pode ficar vazio.");
      return;
    }

    if (products.some((p) => p.id === id)) {
      toast.error(`Já existe um produto com o ID "${id}".`);
      return;
    }

    if (!Number.isFinite(price) || price < 0) {
      toast.error("O preço tem de ser um número válido (>= 0).");
      return;
    }

    try {
      await createProduct({
        id,
        name,
        unit: newUnit,
        price,
      });

      setNewName("");
      setNewUnit("kg");
      setNewPrice("");
      setNewId("");
    } catch {
      toast.error("Não foi possível criar.");
    }
  };

  return (
    <div className="page products-page">
      <header className="page-header">
        <div>
          <h1>Produtos</h1>
          <p className="page-subtitle">
            Gere a tua lista de produtos (editar preços, adicionar e remover).
          </p>
        </div>
      </header>

      <div className="card">
        <h2 className="card-title">Adicionar produto</h2>
        <div className="products-toolbar">
          <div className="field">
            <label>Nome</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder='Ex: "Brócolos"'
            />
          </div>

          <div className="field">
            <label>Unidade</label>
            <select
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value as Unit)}
            >
              <option value="kg">kg</option>
              <option value="un">un</option>
              <option value="molho">molho</option>
            </select>
          </div>

          <div className="field">
            <label>Preço</label>
            <input
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="Ex: 2.50"
              inputMode="decimal"
            />
          </div>

          <div className="field">
            <label>ID (opcional)</label>
            <input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder={autoId || "ex: brocolos"}
            />
            <div className="muted-hint">
              Sugestão: <code>{autoId || "(escreve o nome)"}</code>
            </div>
          </div>

          <button type="button" className="btn-primary" onClick={handleCreate}>
            + Adicionar
          </button>
        </div>
      </div>

      <div className="card">
        <div className="products-list-header">
          <div>
            <h2 className="card-title">Lista de produtos</h2>
            <p className="page-subtitle">
              {loadingProducts
                ? "A carregar produtos…"
                : `${filtered.length} produto(s) mostrado(s)`}
            </p>
          </div>

          <div className="products-filters">
            <input
              className="inline-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Pesquisar por nome ou ID…"
            />

            <select
              className="inline-select"
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value as Unit | "all")}
            >
              <option value="all">Todas as unidades</option>
              <option value="kg">kg</option>
              <option value="un">un</option>
              <option value="molho">molho</option>
            </select>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="simple-table products-table responsive-cards">
            <thead>
              <tr>
                <th>Nome</th>
                <th>ID</th>
                <th>Unidade</th>
                <th>Preço</th>
                <th style={{ width: 220 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const d = drafts[p.id];
                const dirty = isDirty(p);

                return (
                  <tr key={p.id}>
                    <td data-label="Nome">
                      <input
                        className="inline-input"
                        value={d?.name ?? p.name}
                        onChange={(e) =>
                          handleDraftChange(p.id, { name: e.target.value })
                        }
                      />
                    </td>
                    <td data-label="ID">
                      <code className="mono">{p.id}</code>
                    </td>
                    <td data-label="Unidade">
                      <select
                        className="inline-select"
                        value={(d?.unit ?? p.unit) as string}
                        onChange={(e) =>
                          handleDraftChange(p.id, {
                            unit: e.target.value as Unit,
                          })
                        }
                      >
                        <option value="kg">kg</option>
                        <option value="un">un</option>
                        <option value="molho">molho</option>
                      </select>
                    </td>
                    <td data-label="Preço">
                      <input
                        className="inline-input inline-number"
                        value={d?.price ?? String(p.price ?? 0)}
                        onChange={(e) =>
                          handleDraftChange(p.id, { price: e.target.value })
                        }
                        inputMode="decimal"
                        placeholder="0.00"
                      />
                      <span className="price-suffix">€</span>
                    </td>
                    <td className="cell-actions">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={!dirty}
                          onClick={() => handleSaveRow(p)}
                          title={dirty ? "Guardar alterações" : "Sem alterações"}
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={!dirty}
                          onClick={() => handleResetRow(p)}
                        >
                          Repor
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() => handleDelete(p)}
                        >
                          Apagar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!loadingProducts && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: "#9ca3af" }}>
                    Nenhum produto encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ProductsPage;
