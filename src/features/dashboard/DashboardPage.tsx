import React, { useMemo, useState } from "react";
import { useCustomers } from "../../context/CustomersContext";
import { useProducts } from "../../context/ProductsContext";
import { useOrders } from "../../context/OrdersContext";
import type { Order, Customer, Product } from "../../types";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

import {
  exportPickingListPdf,
  exportCustomerSheetsPdf,
  exportAccountSheetPdf,
} from "../../utils/pdfExports";

/**
 * Dashboard (v2)
 * - KPIs: mês, ano, total; encomendas mês/total; ticket médio mês/total
 * - Rankings: top 3 clientes (valor), top 10 produtos (quantidade), top 10 produtos (valor)
 * - Gráficos: encomendas semanal, faturação semanal, ticket médio semanal, faturação total (mensal)
 *
 * Dependência:
 *   npm i recharts
 */

const formatCurrency = (value: number) =>
  value.toLocaleString("pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  });

const formatNumber = (value: number) =>
  value.toLocaleString("pt-PT", { maximumFractionDigits: 0 });

function toDateSafe(value: any): Date | null {
  if (!value) return null;

  if (value instanceof Date) return value;

  // Firestore Timestamp compat (se existir)
  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      const d = value.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }
    if (typeof value.seconds === "number") {
      const d = new Date(value.seconds * 1000);
      return !Number.isNaN(d.getTime()) ? d : null;
    }
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return !Number.isNaN(d.getTime()) ? d : null;
  }

  if (typeof value === "string") {
    // dd/MM/yyyy (ou dd-MM-yyyy)
    const m = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]) - 1;
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      const d = new Date(year, month, day);
      return !Number.isNaN(d.getTime()) ? d : null;
    }

    const d = new Date(value);
    return !Number.isNaN(d.getTime()) ? d : null;
  }

  return null;
}

// Semana inicia à segunda-feira (PT), às 00:00
function weekStart(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);

  const day = date.getDay(); // 0=Dom,1=Seg,...6=Sáb
  const diffToMonday = (day + 6) % 7; // Seg => 0, Ter => 1, Dom => 6
  date.setDate(date.getDate() - diffToMonday);
  return date;
}

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatWeekLabel(d: Date): string {
  // exemplo: "02 Dez"
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
}

function formatMonthLabel(d: Date): string {
  // exemplo: "Dez 2025"
  return d.toLocaleDateString("pt-PT", { month: "short", year: "numeric" });
}

type RangeOption = "12w" | "26w" | "52w" | "all";
const RANGE_OPTIONS: { key: RangeOption; label: string }[] = [
  { key: "12w", label: "12s" },
  { key: "26w", label: "26s" },
  { key: "52w", label: "52s" },
  { key: "all", label: "Tudo" },
];

const DashboardPage: React.FC = () => {
  const { customers } = useCustomers();
  const { products } = useProducts();
  const { orders } = useOrders();
  const [range, setRange] = useState<RangeOption>("12w");

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-11

  const currentMonthLabel = now.toLocaleDateString("pt-PT", {
    month: "long",
    year: "numeric",
  });

  const deliveredOrders = useMemo(
    () => orders.filter((o) => o.status === "delivered"),
    [orders]
  );

  // Por compatibilidade com o que já tinhas: usa `order.date` como data principal.
  // Se entretanto tiveres `deliveredAt`, podes trocar aqui sem mexer em mais nada.
  const getOrderDate = (o: Order) => toDateSafe((o as any).deliveredAt ?? o.date ?? (o as any).createdAt);

  const calcOrderTotal = (o: Order) =>
    o.items.reduce(
      (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
      0
    );

  const ordersOfMonth = useMemo(() => {
    return deliveredOrders.filter((o) => {
      const d = getOrderDate(o);
      if (!d) return false;
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    });
  }, [deliveredOrders, currentYear, currentMonth]);

  const ordersOfYear = useMemo(() => {
    return deliveredOrders.filter((o) => {
      const d = getOrderDate(o);
      if (!d) return false;
      return d.getFullYear() === currentYear;
    });
  }, [deliveredOrders, currentYear]);

  const kpis = useMemo(() => {
    const monthRevenue = ordersOfMonth.reduce((acc, o) => acc + calcOrderTotal(o), 0);
    const yearRevenue = ordersOfYear.reduce((acc, o) => acc + calcOrderTotal(o), 0);
    const totalRevenue = deliveredOrders.reduce((acc, o) => acc + calcOrderTotal(o), 0);

    const monthOrders = ordersOfMonth.length;
    const totalOrders = deliveredOrders.length;

    const avgTicketMonth = monthOrders > 0 ? monthRevenue / monthOrders : 0;
    const avgTicketTotal = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    return {
      monthRevenue,
      yearRevenue,
      totalRevenue,
      monthOrders,
      totalOrders,
      avgTicketMonth,
      avgTicketTotal,
    };
  }, [ordersOfMonth, ordersOfYear, deliveredOrders]);

  const customerMap = useMemo(() => {
    const map = new Map<string, Customer>();
    (customers ?? []).forEach((c) => {
      map.set(String(c.id), c);
    });
    return map;
  }, [customers]);

  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    (products ?? []).forEach((p) => {
      map.set(String(p.id), p);
    });
    return map;
  }, [products]);

  const getCustomerLabel = (c: Customer | undefined): string => {
    if (!c) return "—";
    return c.name || "—";
  };

  const topCustomers = useMemo(() => {
    const totals = new Map<string, { customerId: string; revenue: number; orders: number }>();

    deliveredOrders.forEach((o) => {
      const customerId = String(o.customerId ?? "");
      if (!customerId) return;

      const orderTotal = calcOrderTotal(o);
      const prev = totals.get(customerId) ?? { customerId, revenue: 0, orders: 0 };
      prev.revenue += orderTotal;
      prev.orders += 1;
      totals.set(customerId, prev);
    });

    const rows = Array.from(totals.values())
      .map((r) => {
        const c = customerMap.get(r.customerId);
        return {
          ...r,
          label: getCustomerLabel(c),
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    return rows.slice(0, 3);
  }, [deliveredOrders, customerMap]);

  const topProductsByQty = useMemo(() => {
    const qty = new Map<string, number>();

    deliveredOrders.forEach((o) => {
      o.items.forEach((it) => {
        const pid = String(it.productId ?? "");
        if (!pid) return;
        qty.set(pid, (qty.get(pid) ?? 0) + (Number(it.quantity) || 0));
      });
    });

    const rows = Array.from(qty.entries())
      .map(([productId, quantity]) => ({
        productId,
        name: productMap.get(productId)?.name ?? "Produto",
        quantity,
      }))
      .sort((a, b) => b.quantity - a.quantity);

    return rows.slice(0, 10);
  }, [deliveredOrders, productMap]);

  const topProductsByRevenue = useMemo(() => {
    const rev = new Map<string, number>();

    deliveredOrders.forEach((o) => {
      o.items.forEach((it) => {
        const pid = String(it.productId ?? "");
        if (!pid) return;
        const line = (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
        rev.set(pid, (rev.get(pid) ?? 0) + line);
      });
    });

    const rows = Array.from(rev.entries())
      .map(([productId, revenue]) => ({
        productId,
        name: productMap.get(productId)?.name ?? "Produto",
        revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    return rows.slice(0, 10);
  }, [deliveredOrders, productMap]);

  // --- Séries semanais (encomendas / faturação / ticket médio) ---
  const weeklySeries = useMemo(() => {
    const byWeek = new Map<
      string,
      { weekStart: Date; orders: number; revenue: number }
    >();

    deliveredOrders.forEach((o) => {
      const d = getOrderDate(o);
      if (!d) return;

      const ws = weekStart(d);
      const key = dateKey(ws);

      const entry = byWeek.get(key) ?? { weekStart: ws, orders: 0, revenue: 0 };
      entry.orders += 1;
      entry.revenue += calcOrderTotal(o);
      byWeek.set(key, entry);
    });

    const rows = Array.from(byWeek.values()).sort(
      (a, b) => a.weekStart.getTime() - b.weekStart.getTime()
    );

    const mapped = rows.map((r) => ({
      key: dateKey(r.weekStart),
      label: formatWeekLabel(r.weekStart),
      orders: r.orders,
      revenue: Math.round(r.revenue * 100) / 100,
      avgTicket: r.orders > 0 ? Math.round((r.revenue / r.orders) * 100) / 100 : 0,
    }));

    if (range === "all") return mapped;

    const limit = range === "12w" ? 12 : range === "26w" ? 26 : 52;
    return mapped.slice(Math.max(0, mapped.length - limit));
  }, [deliveredOrders, range]);

  // --- Série mensal (faturação total por mês) ---
  const monthlyRevenueSeries = useMemo(() => {
    const byMonth = new Map<string, { monthStart: Date; revenue: number; orders: number }>();

    deliveredOrders.forEach((o) => {
      const d = getOrderDate(o);
      if (!d) return;

      const ms = monthStart(d);
      const key = monthKey(ms);

      const entry = byMonth.get(key) ?? { monthStart: ms, revenue: 0, orders: 0 };
      entry.revenue += calcOrderTotal(o);
      entry.orders += 1;
      byMonth.set(key, entry);
    });

    return Array.from(byMonth.values())
      .sort((a, b) => a.monthStart.getTime() - b.monthStart.getTime())
      .map((r) => ({
        key: monthKey(r.monthStart),
        label: formatMonthLabel(r.monthStart),
        revenue: Math.round(r.revenue * 100) / 100,
        orders: r.orders,
      }));
  }, [deliveredOrders]);

  // --- Ações PDF (mantidas) ---
  const handleExportProducts = () => exportPickingListPdf(orders, products);
  const handleExportCustomerSheets = () => exportCustomerSheetsPdf(orders, customers, products);
  const handleExportAccountSheet = () => exportAccountSheetPdf();

  return (
    <div className="page dashboard-page">
      <header className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-subtitle">
            KPIs do mês/ano/total + evolução semanal e rankings.
          </p>
        </div>

        <div className="dashboard-header-right">
          <div className="chip">
            Mês atual: <strong>{currentMonthLabel}</strong>
          </div>

          <div className="dashboard-actions">
            <button type="button" className="btn-secondary" onClick={handleExportProducts}>
              PDF – Lista de produtos
            </button>
            <button type="button" className="btn-secondary" onClick={handleExportCustomerSheets}>
              PDF – Folhas por cliente
            </button>
            <button type="button" className="btn-secondary" onClick={handleExportAccountSheet}>
              PDF – Folha de contas
            </button>
          </div>
        </div>
      </header>

      {/* KPIs */}
      <section className="dashboard-kpi-grid">
        <KpiCard
          label="Faturação do mês atual"
          value={formatCurrency(kpis.monthRevenue)}
          hint="Somatório das encomendas entregues no mês."
        />
        <KpiCard
          label="Faturação anual"
          value={formatCurrency(kpis.yearRevenue)}
          hint={`Somatório das encomendas entregues em ${currentYear}.`}
        />
        <KpiCard
          label="Faturação total"
          value={formatCurrency(kpis.totalRevenue)}
          hint="Somatório de todas as encomendas entregues (sempre)."
        />
        <KpiCard
          label="Encomendas do mês"
          value={formatNumber(kpis.monthOrders)}
          hint="Nº de encomendas entregues no mês."
        />
        <KpiCard
          label="Encomendas totais"
          value={formatNumber(kpis.totalOrders)}
          hint="Nº total de encomendas entregues."
        />
        <KpiCard
          label="Ticket médio (mês)"
          value={formatCurrency(kpis.avgTicketMonth)}
          hint="Faturação do mês / encomendas do mês."
        />
        <KpiCard
          label="Ticket médio (total)"
          value={formatCurrency(kpis.avgTicketTotal)}
          hint="Faturação total / encomendas totais."
        />
      </section>

      {/* Rankings */}
      <section className="dashboard-rankings-grid">
        <div className="dashboard-panel-card">
          <div className="dashboard-panel-header">
            <div>
              <h2 className="dashboard-panel-title">Top 3 clientes</h2>
              <p className="dashboard-panel-subtitle">Por valor total de encomendas (entregues).</p>
            </div>
          </div>

          {topCustomers.length === 0 ? (
            <p className="dashboard-empty">Ainda não há dados suficientes.</p>
          ) : (
            <div className="table-wrapper">
              <table className="simple-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Nº encomendas</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {topCustomers.map((c) => (
                    <tr key={c.customerId}>
                      <td>{c.label}</td>
                      <td>{c.orders}</td>
                      <td>{formatCurrency(c.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="dashboard-panel-card">
          <div className="dashboard-panel-header">
            <div>
              <h2 className="dashboard-panel-title">Top 10 produtos</h2>
              <p className="dashboard-panel-subtitle">Por quantidade total vendida (entregues).</p>
            </div>
          </div>

          {topProductsByQty.length === 0 ? (
            <p className="dashboard-empty">Ainda não há dados suficientes.</p>
          ) : (
            <div className="table-wrapper">
              <table className="simple-table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Quantidade</th>
                  </tr>
                </thead>
                <tbody>
                  {topProductsByQty.map((p) => (
                    <tr key={p.productId}>
                      <td>{p.name}</td>
                      <td>{formatNumber(p.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="dashboard-panel-card">
          <div className="dashboard-panel-header">
            <div>
              <h2 className="dashboard-panel-title">Top 10 produtos</h2>
              <p className="dashboard-panel-subtitle">Por valor monetário total (entregues).</p>
            </div>
          </div>

          {topProductsByRevenue.length === 0 ? (
            <p className="dashboard-empty">Ainda não há dados suficientes.</p>
          ) : (
            <div className="table-wrapper">
              <table className="simple-table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {topProductsByRevenue.map((p) => (
                    <tr key={p.productId}>
                      <td>{p.name}</td>
                      <td>{formatCurrency(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Gráficos */}
      <section className="dashboard-charts-header">
        <div>
          <h2 className="dashboard-section-title">Evolução</h2>
          <p className="dashboard-section-subtitle">
            Séries baseadas em encomendas entregues. Ajusta o intervalo para os gráficos semanais.
          </p>
        </div>

        <div className="dashboard-range">
          <span className="dashboard-range-label">Intervalo:</span>
          <div className="dashboard-range-seg">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`seg-btn ${range === opt.key ? "active" : ""}`}
                onClick={() => setRange(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="dashboard-charts-grid-2">
        <ChartCard
          title="Nº de encomendas (semanal)"
          subtitle="Quantidade de encomendas entregues por semana."
        >
          {weeklySeries.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={weeklySeries}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 12 }} />
                <YAxis tick={{ fill: "#9ca3af", fontSize: 12 }} />
                <Tooltip
                  formatter={(v: any) => [formatNumber(Number(v)), "Encomendas"]}
                  labelFormatter={(l) => `Semana: ${l}`}
                  contentStyle={{
                    background: "#020617",
                    border: "1px solid #1f2937",
                    borderRadius: 12,
                    color: "#e5e7eb",
                  }}
                />
                <Bar dataKey="orders" radius={[10, 10, 0, 0]} fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Faturação (semanal)"
          subtitle="Faturação total (EUR) por semana."
        >
          {weeklySeries.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={weeklySeries}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 12 }} />
                <YAxis tick={{ fill: "#9ca3af", fontSize: 12 }} />
                <Tooltip
                  formatter={(v: any) => [formatCurrency(Number(v)), "Faturação"]}
                  labelFormatter={(l) => `Semana: ${l}`}
                  contentStyle={{
                    background: "#020617",
                    border: "1px solid #1f2937",
                    borderRadius: 12,
                    color: "#e5e7eb",
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="revenue" strokeWidth={2} dot={false} stroke="#34d399" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Ticket médio (semanal)"
          subtitle="Faturação semanal / nº encomendas semana."
        >
          {weeklySeries.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={weeklySeries}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 12 }} />
                <YAxis tick={{ fill: "#9ca3af", fontSize: 12 }} />
                <Tooltip
                  formatter={(v: any) => [formatCurrency(Number(v)), "Ticket médio"]}
                  labelFormatter={(l) => `Semana: ${l}`}
                  contentStyle={{
                    background: "#020617",
                    border: "1px solid #1f2937",
                    borderRadius: 12,
                    color: "#e5e7eb",
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="avgTicket" strokeWidth={2} dot={false} stroke="#f59e0b" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Faturação total (mensal)"
          subtitle="Faturação total por mês (toda a série histórica)."
        >
          {monthlyRevenueSeries.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthlyRevenueSeries}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#9ca3af", fontSize: 12 }}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fill: "#9ca3af", fontSize: 12 }} />
                <Tooltip
                  formatter={(v: any) => [formatCurrency(Number(v)), "Faturação"]}
                  labelFormatter={(l) => `Mês: ${l}`}
                  contentStyle={{
                    background: "#020617",
                    border: "1px solid #1f2937",
                    borderRadius: 12,
                    color: "#e5e7eb",
                  }}
                />
                <Bar dataKey="revenue" radius={[10, 10, 0, 0]} fill="#34d399" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </section>
    </div>
  );
};

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, hint }) => {
  return (
    <div className="dashboard-kpi-card">
      <span className="dashboard-kpi-label">{label}</span>
      <span className="dashboard-kpi-value">{value}</span>
      {hint && <span className="dashboard-kpi-hint">{hint}</span>}
    </div>
  );
};

const ChartCard: React.FC<{
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, children }) => {
  return (
    <div className="dashboard-chart-card">
      <div className="dashboard-chart-head">
        <div>
          <h3 className="dashboard-chart-title">{title}</h3>
          {subtitle && <p className="dashboard-chart-subtitle">{subtitle}</p>}
        </div>
      </div>

      <div className="dashboard-chart-container">{children}</div>
    </div>
  );
};

const EmptyChart: React.FC = () => (
  <div className="dashboard-chart-empty">Ainda não há dados suficientes.</div>
);

export default DashboardPage;
