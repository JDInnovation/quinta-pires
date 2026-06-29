import React, { useEffect, useMemo, useState } from "react";
import type { Customer } from "../../types";

interface CustomerListProps {
  customers: Customer[];
  onEdit?: (customer: Customer) => void;
  onDelete?: (customer: Customer) => void;
}

const PAGE_SIZE = 25;

function getPaginationItems(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) items.push("…");
  for (let i = start; i <= end; i++) items.push(i);
  if (end < total - 1) items.push("…");
  items.push(total);
  return items;
}

const CustomerList: React.FC<CustomerListProps> = ({
  customers,
  onEdit,
  onDelete,
}) => {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return customers.filter((c) => {
      const hay = [c.name, c.nif ?? "", c.address, c.phone ?? "", c.notes ?? ""]
        .join(" ")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return hay.includes(q);
    });
  }, [customers, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageCustomers = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  const paginationItems = useMemo(() => getPaginationItems(page, pageCount), [page, pageCount]);
  const showingFrom = filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const showingTo = Math.min(page * PAGE_SIZE, filtered.length);

  if (customers.length === 0) {
    return (
      <div className="card">
        <h2 className="card-title">Clientes</h2>
        <p className="card-subtitle">
          Ainda não tens clientes registados. Adiciona o primeiro no
          formulário acima.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="card-title">Clientes</h2>
      <p className="card-subtitle">
        Lista de clientes que podem receber encomendas.
      </p>

      <div className="customers-toolbar">
        <div className="orders-toolbar-group" style={{ maxWidth: 320 }}>
          <label>Pesquisar cliente</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nome, NIF, morada, telefone..."
          />
        </div>
      </div>

      <div className="table-wrapper">
        <table className="simple-table">
          <thead>
            <tr>
              <th scope="col">Nome</th>
              <th scope="col">NIF</th>
              <th scope="col">Morada</th>
              <th scope="col">Telefone</th>
              <th scope="col">Notas</th>
              <th scope="col" style={{ width: "1%" }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {pageCustomers.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                  Nenhum cliente encontrado.
                </td>
              </tr>
            ) : (
              pageCustomers.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.nif ?? "—"}</td>
                  <td>{c.address}</td>
                  <td>{c.phone ?? "—"}</td>
                  <td>{c.notes ?? "—"}</td>
                  <td>
                    <div className="table-actions">
                      {onEdit && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => onEdit(c)}
                        >
                          Editar
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() => onDelete(c)}
                        >
                          Apagar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > PAGE_SIZE && (
        <div className="orders-footer">
          <div className="orders-count">
            A mostrar <strong>{showingFrom}</strong>–<strong>{showingTo}</strong> de{" "}
            <strong>{filtered.length}</strong>
          </div>
          <div className="pagination">
            <button
              type="button"
              className="page-btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Página anterior"
            >
              ‹
            </button>
            {paginationItems.map((it, idx) =>
              it === "…" ? (
                <span key={`ellipsis-${idx}`} className="pagination-ellipsis">…</span>
              ) : (
                <button
                  key={it}
                  type="button"
                  className={`page-btn ${it === page ? "active" : ""}`}
                  onClick={() => setPage(it)}
                >
                  {it}
                </button>
              )
            )}
            <button
              type="button"
              className="page-btn"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              aria-label="Página seguinte"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerList;
