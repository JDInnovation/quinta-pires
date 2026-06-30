import React, { useEffect, useMemo, useState } from "react";
import type { Customer, Order, Product } from "../../types";
import { useConfirm } from "../../components/ConfirmProvider";

type OrderStatus = Order["status"];

interface OrderListProps {
  orders: Order[];
  customers: Customer[];
  products: Product[];
  onChangeStatus?: (
    orderId: string,
    status: OrderStatus
  ) => void | Promise<void>;
  onDelete?: (orderId: string) => void | Promise<void>;
  onEdit?: (order: Order) => void | Promise<void>;
  onBulkDelete?: (orderIds: string[]) => void | Promise<void>;
  onBulkChangeStatus?: (orderIds: string[], status: OrderStatus) => void | Promise<void>;
}

const statusOptions: { value: OrderStatus; label: string }[] = [
  { value: "preparing", label: "Em preparação" },
  { value: "delivered", label: "Entregue" },
  { value: "cancelled", label: "Cancelada" },
];

function getCustomerName(customers: Customer[], id: string): string {
  const customer = customers.find((c) => c.id === id);
  return customer ? customer.name : "—";
}

function getOrderShortDescription(order: Order, products: Product[]): string {
  if (!order.items.length) return "Sem produtos";

  const itemsCount = order.items.length;
  const firstItem = order.items[0];
  const product = products.find((p) => p.id === firstItem.productId);

  if (!product) {
    return itemsCount === 1 ? "1 produto" : `${itemsCount} produtos`;
  }

  if (itemsCount === 1) {
    const unit = firstItem.unit ?? product.unit ?? "";
    return `${firstItem.quantity} ${unit} de ${product.name}`;
  }

  const unit = firstItem.unit ?? product.unit ?? "";

  return `${firstItem.quantity} ${unit} de ${product.name} + ${
    itemsCount - 1
  } produto(s)`;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("pt-PT");
}

function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    // remove acentos (diacríticos)
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function parseDateToMs(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const ms = d.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function createdAtToMs(createdAt?: Order["createdAt"]): number {
  if (createdAt == null) return Number.POSITIVE_INFINITY; // acabada de criar (sem timestamp ainda) → topo
  if (typeof createdAt === "number") return createdAt;
  if (typeof createdAt === "string") {
    const ms = new Date(createdAt).getTime();
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  }
  if (typeof createdAt === "object" && typeof createdAt.seconds === "number") {
    return createdAt.seconds * 1000 + (createdAt.nanoseconds ?? 0) / 1e6;
  }
  return Number.POSITIVE_INFINITY;
}

function startOfDayMs(dateStr?: string): number | null {
  const ms = parseDateToMs(dateStr);
  if (ms == null) return null;
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfDayMs(dateStr?: string): number | null {
  const ms = parseDateToMs(dateStr);
  if (ms == null) return null;
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

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

const OrderList: React.FC<OrderListProps> = ({
  orders,
  customers,
  products,
  onChangeStatus,
  onDelete,
  onEdit,
  onBulkDelete,
  onBulkChangeStatus,
}) => {
  const confirm = useConfirm();
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<OrderStatus>("preparing");

  // filtros
  const [search, setSearch] = useState<string>("");
  const [customerFilter, setCustomerFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">(
    "all"
  );
  const [deliveryFrom, setDeliveryFrom] = useState<string>("");
  const [deliveryTo, setDeliveryTo] = useState<string>("");
  const [onlyWithDelivery, setOnlyWithDelivery] = useState<boolean>(false);
  const [onlyWithNotes, setOnlyWithNotes] = useState<boolean>(false);

  // paginação
  const PAGE_SIZE = 15;
  const [page, setPage] = useState<number>(1);

  const customerById = useMemo(
    () => new Map(customers.map((c) => [c.id, c])),
    [customers]
  );
  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const customersWithOrders = useMemo(() => {
    const ids = new Set(orders.map((o) => o.customerId));
    return customers
      .filter((c) => ids.has(c.id))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "pt-PT"));
  }, [customers, orders]);

  const productsInOrders = useMemo(() => {
    const ids = new Set<string>();
    for (const o of orders) for (const it of o.items) ids.add(it.productId);
    return products
      .filter((p) => ids.has(p.id))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "pt-PT"));
  }, [products, orders]);

  const filteredOrders = useMemo(() => {
    const q = normalizeForSearch(search);
    const fromMs = startOfDayMs(deliveryFrom);
    const toMs = endOfDayMs(deliveryTo);

    const filtered = orders.filter((order) => {
      // cliente
      if (customerFilter !== "all" && order.customerId !== customerFilter) {
        return false;
      }

      // estado
      if (statusFilter !== "all" && order.status !== statusFilter) {
        return false;
      }

      // produto
      if (productFilter !== "all") {
        const hasProduct = order.items.some(
          (it) => it.productId === productFilter
        );
        if (!hasProduct) return false;
      }

      // só com entrega marcada
      if (onlyWithDelivery && !order.deliveryDate) return false;

      // só com notas
      if (onlyWithNotes && !(order.notes && order.notes.trim().length > 0)) {
        return false;
      }

      // intervalo de entrega
      if (fromMs != null || toMs != null) {
        if (!order.deliveryDate) return false;
        const deliveryMs = parseDateToMs(order.deliveryDate);
        if (deliveryMs == null) return false;
        if (fromMs != null && deliveryMs < fromMs) return false;
        if (toMs != null && deliveryMs > toMs) return false;
      }

      // pesquisa livre
      if (q) {
        const customerName = customerById.get(order.customerId)?.name ?? "";
        const productNames = order.items
          .map((it) => productById.get(it.productId)?.name ?? it.productId)
          .join(" ");

        const statusLabel =
          statusOptions.find((opt) => opt.value === order.status)?.label ?? "";

        const haystack = normalizeForSearch(
          [
            order.id,
            customerName,
            productNames,
            order.notes ?? "",
            order.date ?? "",
            order.deliveryDate ?? "",
            statusLabel,
          ].join(" ")
        );

        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    // Ordena sempre por ordem de criação (mais recentes primeiro),
    // independentemente dos filtros aplicados.
    return filtered.slice().sort((a, b) => {
      const aMs = createdAtToMs(a.createdAt);
      const bMs = createdAtToMs(b.createdAt);
      if (aMs !== bMs) return bMs - aMs;

      // desempate: data da encomenda, entrega, depois ID
      const aDate = parseDateToMs(a.date) ?? -Infinity;
      const bDate = parseDateToMs(b.date) ?? -Infinity;
      if (aDate !== bDate) return bDate - aDate;

      const aDel = parseDateToMs(a.deliveryDate) ?? -Infinity;
      const bDel = parseDateToMs(b.deliveryDate) ?? -Infinity;
      if (aDel !== bDel) return bDel - aDel;

      return String(b.id).localeCompare(String(a.id), 'pt-PT');
    });
  }, [
    orders,
    search,
    customerFilter,
    productFilter,
    statusFilter,
    deliveryFrom,
    deliveryTo,
    onlyWithDelivery,
    onlyWithNotes,
    customerById,
    productById,
  ]);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE)),
    [filteredOrders.length]
  );

  const pageOrders = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredOrders.slice(start, start + PAGE_SIZE);
  }, [filteredOrders, page]);

  // ao alterar filtros, volta à página 1
  useEffect(() => {
    setPage(1);
  }, [
    search,
    customerFilter,
    productFilter,
    statusFilter,
    deliveryFrom,
    deliveryTo,
    onlyWithDelivery,
    onlyWithNotes,
  ]);

  // se ficar numa página fora do range (ex: apagou encomendas), corrige
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  // se a encomenda expandida desaparecer na paginação, fecha
  useEffect(() => {
    if (!expandedOrderId) return;
    const stillVisible = pageOrders.some((o) => o.id === expandedOrderId);
    if (!stillVisible) setExpandedOrderId(null);
  }, [expandedOrderId, pageOrders]);

  if (!orders.length) {
    return (
      <div className="card">
        <h2 className="card-title">Encomendas</h2>
        <p className="page-subtitle">
          Ainda não tens encomendas registadas. Cria a primeira no formulário
          ao lado.
        </p>
      </div>
    );
  }

  const toggleExpand = (orderId: string) => {
    setExpandedOrderId((current) => (current === orderId ? null : orderId));
  };

  const clearFilters = () => {
    setSearch("");
    setCustomerFilter("all");
    setProductFilter("all");
    setStatusFilter("all");
    setDeliveryFrom("");
    setDeliveryTo("");
    setOnlyWithDelivery(false);
    setOnlyWithNotes(false);
  };

  // Selection helpers
  const filteredIds = useMemo(() => new Set(filteredOrders.map((o) => o.id)), [filteredOrders]);
  const allFilteredSelected = filteredIds.size > 0 && Array.from(filteredIds).every((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredIds));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (!onBulkDelete || selectedIds.size === 0) return;
    const confirmed = await confirm({
      title: "Apagar encomendas",
      message: `Tens a certeza que queres apagar ${selectedIds.size} encomenda(s)?`,
      confirmLabel: "Apagar",
      tone: "danger",
    });
    if (!confirmed) return;
    onBulkDelete(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const handleBulkChangeStatus = async () => {
    if (!onBulkChangeStatus || selectedIds.size === 0) return;
    const label = statusOptions.find((o) => o.value === bulkStatus)?.label ?? bulkStatus;
    const confirmed = await confirm({
      title: "Alterar estado",
      message: `Alterar o estado de ${selectedIds.size} encomenda(s) para "${label}"?`,
      confirmLabel: "Alterar",
    });
    if (!confirmed) return;
    onBulkChangeStatus(Array.from(selectedIds), bulkStatus);
    setSelectedIds(new Set());
  };

  const paginationItems = useMemo(
    () => getPaginationItems(page, pageCount),
    [page, pageCount]
  );

  const showingFrom = filteredOrders.length
    ? (page - 1) * PAGE_SIZE + 1
    : 0;
  const showingTo = Math.min(page * PAGE_SIZE, filteredOrders.length);

  return (
    <div className="card">
      <h2 className="card-title">Encomendas</h2>

      <div className="orders-toolbar">
        <div className="orders-toolbar-row">
          <div className="orders-toolbar-group" style={{ minWidth: 240 }}>
            <label>Pesquisar</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cliente, produto, notas, ID..."
            />
          </div>

          <div className="orders-toolbar-group">
            <label>Cliente</label>
            <select
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
            >
              <option value="all">Todos</option>
              {customersWithOrders.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="orders-toolbar-group">
            <label>Produto</label>
            <select
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
            >
              <option value="all">Todos</option>
              {productsInOrders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="orders-toolbar-group">
            <label>Estado</label>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as OrderStatus | "all")
              }
            >
              <option value="all">Todos</option>
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="orders-toolbar-row">
          <div className="orders-toolbar-group" style={{ maxWidth: 180 }}>
            <label>Entrega de</label>
            <input
              type="date"
              value={deliveryFrom}
              onChange={(e) => setDeliveryFrom(e.target.value)}
            />
          </div>

          <div className="orders-toolbar-group" style={{ maxWidth: 180 }}>
            <label>Entrega até</label>
            <input
              type="date"
              value={deliveryTo}
              onChange={(e) => setDeliveryTo(e.target.value)}
            />
          </div>

          <label className="orders-toolbar-toggle">
            <input
              type="checkbox"
              checked={onlyWithDelivery}
              onChange={(e) => setOnlyWithDelivery(e.target.checked)}
            />
            Só com entrega marcada
          </label>

          <label className="orders-toolbar-toggle">
            <input
              type="checkbox"
              checked={onlyWithNotes}
              onChange={(e) => setOnlyWithNotes(e.target.checked)}
            />
            Só com notas
          </label>

          <div className="orders-toolbar-actions">
            <button type="button" className="btn-secondary" onClick={toggleSelectAll}>
              {allFilteredSelected ? "Desselecionar tudo" : `Selecionar tudo (${filteredOrders.length})`}
            </button>
            {selectedIds.size > 0 && onBulkChangeStatus && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <select
                  value={bulkStatus}
                  onChange={(e) => setBulkStatus(e.target.value as OrderStatus)}
                >
                  {statusOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-secondary" onClick={handleBulkChangeStatus}>
                  Alterar estado ({selectedIds.size})
                </button>
              </span>
            )}
            {selectedIds.size > 0 && onBulkDelete && (
              <button type="button" className="btn-danger" onClick={handleBulkDelete}>
                Apagar selecionadas ({selectedIds.size})
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={clearFilters}>
              Limpar filtros
            </button>
          </div>
        </div>
      </div>

      {!filteredOrders.length ? (
        <div className="card" style={{ marginTop: 8 }}>
          <p className="page-subtitle" style={{ margin: 0 }}>
            Não existem encomendas com estes filtros.
          </p>
        </div>
      ) : (
        <>
          <div className="table-wrapper">
            <table className="simple-table responsive-cards">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      aria-label="Selecionar todas as encomendas"
                    />
                  </th>
                  <th scope="col">Data</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Resumo</th>
                  <th scope="col">Total</th>
                  <th scope="col" style={{ width: "220px" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {pageOrders.map((order) => {
              const customerName = getCustomerName(
                customers,
                order.customerId
              );
              const description = getOrderShortDescription(order, products);
              const total = order.items.reduce(
                (sum, item) => sum + item.quantity * item.unitPrice,
                0
              );
              const isExpanded = expandedOrderId === order.id;

              return (
                <React.Fragment key={order.id}>
                  <tr className={selectedIds.has(order.id) ? "row-selected" : ""}>
                    <td className="cell-check" data-label="Selecionar">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(order.id)}
                        onChange={() => toggleSelectOne(order.id)}
                        aria-label={`Selecionar encomenda de ${customerName}`}
                      />
                    </td>
                    <td data-label="Data">{formatDate(order.date)}</td>
                    <td data-label="Cliente">{customerName}</td>
                    <td data-label="Estado">
                      {onChangeStatus ? (
                        <select
                          value={order.status}
                          onChange={(e) =>
                            onChangeStatus(
                              order.id,
                              e.target.value as OrderStatus
                            )
                          }
                        >
                          {statusOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        statusOptions.find(
                          (opt) => opt.value === order.status
                        )?.label ?? "—"
                      )}
                    </td>
                    <td data-label="Resumo">{description}</td>
                    <td data-label="Total">
                      {total.toLocaleString("pt-PT", {
                        style: "currency",
                        currency: "EUR",
                      })}
                    </td>
                    <td className="cell-actions">
                      <div className="table-actions">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => toggleExpand(order.id)}
                        >
                          {isExpanded ? "Esconder" : "Ver encomenda"}
                        </button>
                        {onEdit && (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => onEdit(order)}
                          >
                            Editar
                          </button>
                        )}
                        {onDelete && (
                          <button
                            type="button"
                            className="btn-danger"
                            onClick={() => onDelete(order.id)}
                          >
                            Apagar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr className="order-details-row">
                      <td colSpan={7}>
                        <div className="order-details-card">
                          <div className="order-details-header">
                            <div>
                              <strong>Detalhes da encomenda</strong>
                              {order.notes && (
                                <p style={{ marginTop: "0.15rem" }}>
                                  <span style={{ opacity: 0.8 }}>
                                    Notas:&nbsp;
                                  </span>
                                  {order.notes}
                                </p>
                              )}
                            </div>
                            <div className="order-details-meta">
                              <span>
                                Encomenda: {formatDate(order.date)}
                              </span>
                              {order.deliveryDate && (
                                <span>
                                  Entrega: {formatDate(order.deliveryDate)}
                                </span>
                              )}
                            </div>
                          </div>

                          <table className="simple-table order-items-table">
                            <thead>
                              <tr>
                                <th>Produto</th>
                                <th>Quantidade</th>
                                <th>Preço / un.</th>
                                <th>Subtotal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {order.items.map((item, idx) => {
                                const product = products.find(
                                  (p) => p.id === item.productId
                                );
                                const lineTotal =
                                  item.quantity * item.unitPrice;

                                return (
                                  <tr key={idx}>
                                    <td>{product?.name ?? "—"}</td>
                                    <td>
                                      {item.quantity}{" "}
                                      {item.unit ?? product?.unit ?? ""}
                                    </td>
                                    <td>
                                      {item.unitPrice.toLocaleString(
                                        "pt-PT",
                                        {
                                          style: "currency",
                                          currency: "EUR",
                                        }
                                      )}
                                    </td>
                                    <td>
                                      {lineTotal.toLocaleString("pt-PT", {
                                        style: "currency",
                                        currency: "EUR",
                                      })}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
                })}
              </tbody>
            </table>
          </div>

          <div className="orders-footer">
            <div className="orders-count">
              A mostrar <strong>{showingFrom}</strong>–<strong>{showingTo}</strong> de{" "}
              <strong>{filteredOrders.length}</strong>
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
                  <span key={`ellipsis-${idx}`} className="pagination-ellipsis">
                    …
                  </span>
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
        </>
      )}
    </div>
  );
};

export default OrderList;
