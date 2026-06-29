import React, { useEffect, useMemo, useState } from "react";
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
  Cell,
} from "recharts";
import { useCustomers } from "../../context/CustomersContext";
import { useProducts } from "../../context/ProductsContext";
import { useOrders } from "../../context/OrdersContext";
import { listAiLearningEntries } from "../import/api";
import type { AiLearningEntry } from "../import/types";
import type { Order, Product } from "../../types";

const formatCurrency = (value: number) =>
  value.toLocaleString("pt-PT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

const formatNumber = (value: number, digits = 0) =>
  value.toLocaleString("pt-PT", { maximumFractionDigits: digits });

function toDateSafe(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object") {
    const obj = value as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === "function") {
      const d = obj.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }
    if (typeof obj.seconds === "number") {
      const d = new Date(obj.seconds * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const m = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (m) {
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      const d = new Date(year, Number(m[2]) - 1, Number(m[1]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function weekStart(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diffToMonday = (day + 6) % 7;
  date.setDate(date.getDate() - diffToMonday);
  return date;
}

function formatWeekLabel(d: Date): string {
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
}

const orderTotal = (o: Order) =>
  o.items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);

const orderTotalCatalog = (o: Order, productsById: Map<string, Product>) =>
  o.items.reduce((sum, it) => {
    const price = productsById.get(it.productId)?.price ?? (Number(it.unitPrice) || 0);
    return sum + (Number(it.quantity) || 0) * (Number(price) || 0);
  }, 0);

const isAiOrder = (o: Order) => (o.notes ?? "").toLowerCase().includes("importacao ia");

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

type WindowOption = 4 | 8 | 12;

const FORECAST_PREVIEW = 6;

interface ForecastRow {
  product: Product;
  predicted: number;
  avg: number;
  lastWeek: number;
  weeksWithData: number;
  trend: "up" | "down" | "flat";
  confidence: "alta" | "media" | "baixa";
}

const BAR_COLORS = ["#34d399", "#3b82f6", "#f05252", "#f59e0b", "#22d3ee"];

const chartAxis = { fontSize: 12, fill: "#98a1b2" };
const tooltipStyle = {
  background: "#1b1f29",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 10,
  color: "#e7e9ee",
  fontSize: 12,
};

const InsightsPage: React.FC = () => {
  const { customers } = useCustomers();
  const { products } = useProducts();
  const { orders, loadingOrders } = useOrders();
  const [windowWeeks, setWindowWeeks] = useState<WindowOption>(8);
  const [forecastExpanded, setForecastExpanded] = useState(false);
  const [learning, setLearning] = useState<AiLearningEntry[]>([]);

  useEffect(() => {
    let alive = true;
    listAiLearningEntries()
      .then((rows) => {
        if (alive) setLearning(rows);
      })
      .catch((err) => console.warn("Falha ao carregar aprendizagem da IA", err));
    return () => {
      alive = false;
    };
  }, []);

  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const customersById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const activeOrders = useMemo(() => orders.filter((o) => o.status !== "cancelled"), [orders]);
  const deliveredOrders = useMemo(() => orders.filter((o) => o.status === "delivered"), [orders]);

  // --- Janela de semanas (segunda a domingo), terminando na semana passada completa ---
  const weekWindow = useMemo(() => {
    const thisWeekStart = weekStart(new Date());
    const starts: Date[] = [];
    for (let i = windowWeeks; i >= 1; i -= 1) {
      const d = new Date(thisWeekStart);
      d.setDate(d.getDate() - 7 * i);
      starts.push(d);
    }
    return starts;
  }, [windowWeeks]);

  const weekIndexOf = (d: Date): number => {
    const ws = weekStart(d).getTime();
    return weekWindow.findIndex((w) => w.getTime() === ws);
  };

  // --- Previsão de procura por produto ---
  const forecast = useMemo<ForecastRow[]>(() => {
    const series = new Map<string, number[]>();
    products.forEach((p) => series.set(p.id, new Array(weekWindow.length).fill(0)));

    activeOrders.forEach((o) => {
      const d = toDateSafe(o.date);
      if (!d) return;
      const idx = weekIndexOf(d);
      if (idx < 0) return;
      o.items.forEach((it) => {
        const arr = series.get(it.productId);
        if (arr) arr[idx] += Number(it.quantity) || 0;
      });
    });

    const rows: ForecastRow[] = [];
    series.forEach((arr, productId) => {
      const product = productsById.get(productId);
      if (!product) return;

      const n = arr.length;
      let weightedSum = 0;
      let weightTotal = 0;
      arr.forEach((qty, i) => {
        const weight = i + 1; // semanas mais recentes pesam mais
        weightedSum += qty * weight;
        weightTotal += weight;
      });
      const predicted = weightTotal ? weightedSum / weightTotal : 0;
      const avg = n ? arr.reduce((a, b) => a + b, 0) / n : 0;
      const weeksWithData = arr.filter((q) => q > 0).length;
      const lastWeek = arr[n - 1] ?? 0;

      const recent = arr.slice(-2).reduce((a, b) => a + b, 0) / 2;
      const prior = arr.slice(0, -2);
      const priorAvg = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : recent;
      const trend: ForecastRow["trend"] =
        recent > priorAvg * 1.15 ? "up" : recent < priorAvg * 0.85 ? "down" : "flat";

      const confidence: ForecastRow["confidence"] =
        weeksWithData >= Math.max(4, n / 2) ? "alta" : weeksWithData >= 2 ? "media" : "baixa";

      rows.push({ product, predicted, avg, lastWeek, weeksWithData, trend, confidence });
    });

    return rows.filter((r) => r.predicted > 0).sort((a, b) => b.predicted - a.predicted);
  }, [activeOrders, products, productsById, weekWindow]);

  const predictedRevenue = useMemo(
    () => forecast.reduce((sum, r) => sum + r.predicted * (r.product.price || 0), 0),
    [forecast],
  );

  const forecastChartData = useMemo(
    () => forecast.slice(0, 8).map((r) => ({ name: r.product.name, qty: Number(r.predicted.toFixed(1)) })),
    [forecast],
  );

  // --- Impacto da IA ---
  const aiImpact = useMemo(() => {
    const aiOrders = activeOrders.filter(isAiOrder);
    const aiValue = aiOrders.reduce((s, o) => s + orderTotal(o), 0);
    const share = activeOrders.length ? aiOrders.length / activeOrders.length : 0;
    return { count: aiOrders.length, value: aiValue, share };
  }, [activeOrders]);

  // --- Prontidao da IA (gauge composto) ---
  const readiness = useMemo(() => {
    const withPhone = customers.filter((c) => (c.phone ?? "").replace(/\D/g, "").length >= 9).length;
    const phoneCoverage = customers.length ? withPhone / customers.length : 0;

    const withPrice = products.filter((p) => (p.price || 0) > 0).length;
    const catalogReadiness = products.length ? withPrice / products.length : 0;

    const weeksWithOrders = new Set(
      activeOrders.map((o) => toDateSafe(o.date)).filter(Boolean).map((d) => weekStart(d as Date).getTime()),
    ).size;
    const historyDepth = Math.min(weeksWithOrders / 12, 1);

    const aiAdoption = Math.min(aiImpact.count / 15, 1);

    const score = Math.round(
      (phoneCoverage * 0.3 + catalogReadiness * 0.2 + historyDepth * 0.3 + aiAdoption * 0.2) * 100,
    );

    return { score, phoneCoverage, catalogReadiness, historyDepth, weeksWithOrders, withPhone };
  }, [customers, products, activeOrders, aiImpact.count]);

  const readinessLabel =
    readiness.score >= 75 ? "Avançado" : readiness.score >= 45 ? "Em progresso" : "Inicial";

  // --- Analise de encomendas ---
  const analytics = useMemo(() => {
    const revenue = deliveredOrders.reduce((s, o) => s + orderTotal(o), 0);
    const count = deliveredOrders.length;
    // Ticket medio = quantidade da encomenda x preco do catalogo
    const catalogRevenue = deliveredOrders.reduce((s, o) => s + orderTotalCatalog(o, productsById), 0);
    const avgTicket = count ? catalogRevenue / count : 0;
    const activeCustomers = new Set(activeOrders.map((o) => o.customerId)).size;
    const cancelled = orders.filter((o) => o.status === "cancelled").length;
    const cancelRate = orders.length ? cancelled / orders.length : 0;
    return { revenue, count, avgTicket, activeCustomers, cancelRate };
  }, [deliveredOrders, activeOrders, orders, productsById]);

  // --- Tendencia semanal de faturacao ---
  const weeklyRevenue = useMemo(() => {
    const map = new Map<number, number>();
    weekWindow.forEach((w) => map.set(w.getTime(), 0));
    deliveredOrders.forEach((o) => {
      const d = toDateSafe(o.date);
      if (!d) return;
      const key = weekStart(d).getTime();
      if (map.has(key)) map.set(key, (map.get(key) ?? 0) + orderTotal(o));
    });
    return weekWindow.map((w) => ({ name: formatWeekLabel(w), value: Number((map.get(w.getTime()) ?? 0).toFixed(2)) }));
  }, [deliveredOrders, weekWindow]);

  // --- Top clientes ---
  const topCustomers = useMemo(() => {
    const map = new Map<string, number>();
    deliveredOrders.forEach((o) => {
      map.set(o.customerId, (map.get(o.customerId) ?? 0) + orderTotal(o));
    });
    return [...map.entries()]
      .map(([customerId, value]) => ({
        name: customers.find((c) => c.id === customerId)?.name ?? "Cliente",
        value,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [deliveredOrders, customers]);

  // --- Deteção de anomalias (encomendas atipicas) ---
  const anomalies = useMemo(() => {
    const rows = activeOrders
      .map((o) => ({ order: o, total: orderTotalCatalog(o, productsById) }))
      .filter((r) => r.total > 0);
    if (rows.length < 5)
      return { items: [] as Array<{ order: Order; total: number; kind: "alta" | "baixa"; deviation: number }>, mean: 0 };

    const totals = rows.map((r) => r.total);
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    const variance = totals.reduce((a, b) => a + (b - mean) ** 2, 0) / totals.length;
    const std = Math.sqrt(variance);
    if (std <= 0) return { items: [], mean };

    const items = rows
      .map((r) => {
        const z = (r.total - mean) / std;
        return { order: r.order, total: r.total, kind: (z >= 0 ? "alta" : "baixa") as "alta" | "baixa", deviation: z };
      })
      .filter((r) => Math.abs(r.deviation) >= 2)
      .sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation))
      .slice(0, 6);

    return { items, mean };
  }, [activeOrders, productsById]);

  // --- Sazonalidade: procura (quantidade) por mes ---
  const seasonality = useMemo(() => {
    const qty = new Array(12).fill(0);
    activeOrders.forEach((o) => {
      const d = toDateSafe(o.date);
      if (!d) return;
      const m = d.getMonth();
      o.items.forEach((it) => {
        qty[m] += Number(it.quantity) || 0;
      });
    });
    const max = Math.max(...qty, 0);
    const peakIdx = qty.indexOf(max);
    return {
      cells: qty.map((value, i) => ({ month: MONTH_LABELS[i], value, intensity: max ? value / max : 0 })),
      max,
      peak: max > 0 ? MONTH_LABELS[peakIdx] : null,
    };
  }, [activeOrders]);

  // --- Metricas reais de aprendizagem da IA ---
  const aiLearning = useMemo(() => {
    const total = learning.length;
    if (!total) {
      return {
        total: 0,
        avgConfidence: 0,
        avgAccuracy: 0,
        autoMatchRate: 0,
        keepRate: 0,
        trend: [] as Array<{ name: string; confidence: number; accuracy: number }>,
        improving: 0,
      };
    }

    const accuracyOf = (e: AiLearningEntry) => {
      const base = Math.max(e.itemsDetected, e.itemsConfirmed, 1);
      const errors = e.itemEdits + e.itemsAdded + e.itemsRemoved + (e.customerAutoMatched && !e.customerKept ? 1 : 0);
      return Math.max(0, 1 - errors / base);
    };

    const avgConfidence = learning.reduce((s, e) => s + (e.confidence || 0), 0) / total;
    const avgAccuracy = learning.reduce((s, e) => s + accuracyOf(e), 0) / total;
    const autoMatched = learning.filter((e) => e.customerAutoMatched).length;
    const autoMatchRate = autoMatched ? learning.filter((e) => e.customerKept).length / autoMatched : 0;
    const keepRate = autoMatched / total;

    const trend = learning.map((e, i) => ({
      name: `#${i + 1}`,
      confidence: Math.round((e.confidence || 0) * 100),
      accuracy: Math.round(accuracyOf(e) * 100),
    }));

    const half = Math.floor(total / 2);
    let improving = 0;
    if (total >= 4 && half > 0) {
      const firstAcc = learning.slice(0, half).reduce((s, e) => s + accuracyOf(e), 0) / half;
      const lastAcc = learning.slice(-half).reduce((s, e) => s + accuracyOf(e), 0) / half;
      improving = Math.round((lastAcc - firstAcc) * 100);
    }

    return { total, avgConfidence, avgAccuracy, autoMatchRate, keepRate, trend, improving };
  }, [learning]);

  const confidenceClass = (c: ForecastRow["confidence"]) =>
    c === "alta" ? "confidence-good" : c === "media" ? "confidence-mid" : "confidence-low";

  const trendIcon = (t: ForecastRow["trend"]) => (t === "up" ? "▲" : t === "down" ? "▼" : "—");
  const trendClass = (t: ForecastRow["trend"]) =>
    t === "up" ? "insights-trend-up" : t === "down" ? "insights-trend-down" : "insights-trend-flat";

  const hasData = forecast.length > 0 || analytics.count > 0;

  return (
    <div className="page insights-page">
      <header className="page-header insights-header">
        <div>
          <h1>Insights & Previsões</h1>
          <p className="page-subtitle">
            Previsão de procura, impacto da IA e análise de encomendas com base no histórico real.
          </p>
        </div>
        <div className="insights-window-toggle" role="group" aria-label="Janela de previsão">
          {[4, 8, 12].map((w) => (
            <button
              key={w}
              type="button"
              className={`insights-window-btn${windowWeeks === w ? " active" : ""}`}
              onClick={() => setWindowWeeks(w as WindowOption)}
            >
              {w}s
            </button>
          ))}
        </div>
      </header>

      {loadingOrders && <p className="muted-hint">A carregar dados...</p>}

      {!loadingOrders && !hasData && (
        <div className="card insights-empty">
          <h2 className="card-title">Ainda sem dados suficientes</h2>
          <p className="muted-hint">
            Assim que existirem encomendas no histórico, a previsão de procura e os insights de IA aparecem aqui.
          </p>
        </div>
      )}

      {!loadingOrders && hasData && (
        <>
          {/* Destaque: prontidão da IA + previsão de faturação */}
          <section className="insights-hero">
            <article className="card insights-gauge-card">
              <div className="insights-gauge-head">
                <span className="import-summary-label">Prontidão da IA</span>
                <span className="insights-gauge-badge">{readinessLabel}</span>
              </div>
              <div className="insights-gauge-value">{readiness.score}<small>/100</small></div>
              <div className="insights-gauge-track">
                <div className="insights-gauge-fill" style={{ width: `${readiness.score}%` }} />
              </div>
              <ul className="insights-gauge-breakdown">
                <li>
                  <span>Clientes reconhecíveis</span>
                  <strong>{Math.round(readiness.phoneCoverage * 100)}%</strong>
                </li>
                <li>
                  <span>Catálogo configurado</span>
                  <strong>{Math.round(readiness.catalogReadiness * 100)}%</strong>
                </li>
                <li>
                  <span>Semanas de histórico</span>
                  <strong>{readiness.weeksWithOrders}</strong>
                </li>
                <li>
                  <span>Encomendas via IA</span>
                  <strong>{aiImpact.count}</strong>
                </li>
              </ul>
            </article>

            <div className="insights-hero-kpis">
              <article className="card insights-kpi insights-kpi--accent">
                <span className="import-summary-label">Faturação prevista (próx. semana)</span>
                <strong>{formatCurrency(predictedRevenue)}</strong>
                <small className="muted-hint">Soma das previsões × preço unitário</small>
              </article>
              <article className="card insights-kpi insights-kpi--info">
                <span className="import-summary-label">Encomendas via IA</span>
                <strong>{aiImpact.count}</strong>
                <small className="muted-hint">{Math.round(aiImpact.share * 100)}% do total · {formatCurrency(aiImpact.value)}</small>
              </article>
              <article className="card insights-kpi">
                <span className="import-summary-label">Produtos com previsão</span>
                <strong>{forecast.length}</strong>
                <small className="muted-hint">de {products.length} no catálogo</small>
              </article>
            </div>
          </section>

          {/* Previsão de procura */}
          <section className="card insights-section">
            <div className="insights-section-head">
              <h2 className="card-title">Previsão de procura — próxima semana</h2>
              <p className="muted-hint">Média ponderada das últimas {windowWeeks} semanas (mais peso ao recente).</p>
            </div>

            {forecastChartData.length > 0 && (
              <div className="insights-chart">
                <ResponsiveContainer width="100%" height={Math.max(220, forecastChartData.length * 38)}>
                  <BarChart data={forecastChartData} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(134,169,139,0.12)" horizontal={false} />
                    <XAxis type="number" tick={chartAxis} stroke="rgba(134,169,139,0.2)" />
                    <YAxis type="category" dataKey="name" width={120} tick={chartAxis} stroke="rgba(134,169,139,0.2)" />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(74,222,128,0.06)" }} />
                    <Bar dataKey="qty" radius={[0, 6, 6, 0]}>
                      {forecastChartData.map((_, i) => (
                        <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="insights-table-wrap">
              <table className="insights-table insights-table--compact">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Previsão</th>
                    <th>Média</th>
                    <th>Tendência</th>
                    <th>Confiança</th>
                  </tr>
                </thead>
                <tbody>
                  {(forecastExpanded ? forecast : forecast.slice(0, FORECAST_PREVIEW)).map((r) => (
                    <tr key={r.product.id}>
                      <td>{r.product.name}</td>
                      <td><strong>{formatNumber(r.predicted, 1)}</strong> <small>{r.product.unit}</small></td>
                      <td className="muted-hint">{formatNumber(r.avg, 1)}</td>
                      <td className={trendClass(r.trend)}>{trendIcon(r.trend)}</td>
                      <td className={confidenceClass(r.confidence)}>{r.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {forecast.length > FORECAST_PREVIEW && (
              <button
                type="button"
                className="insights-expand-btn"
                onClick={() => setForecastExpanded((v) => !v)}
                aria-expanded={forecastExpanded}
              >
                <span className={`insights-expand-caret${forecastExpanded ? " open" : ""}`}>▾</span>
                {forecastExpanded
                  ? "Ver menos"
                  : `Ver mais ${forecast.length - FORECAST_PREVIEW} produto${forecast.length - FORECAST_PREVIEW === 1 ? "" : "s"}`}
              </button>
            )}
          </section>

          {/* Análise de encomendas */}
          <section className="insights-kpi-grid">
            <article className="card insights-kpi"><span className="import-summary-label">Faturação (entregue)</span><strong>{formatCurrency(analytics.revenue)}</strong></article>
            <article className="card insights-kpi"><span className="import-summary-label">Encomendas entregues</span><strong>{analytics.count}</strong></article>
            <article className="card insights-kpi"><span className="import-summary-label">Ticket médio</span><strong>{formatCurrency(analytics.avgTicket)}</strong><small className="muted-hint">Quantidade × preço do catálogo</small></article>
            <article className="card insights-kpi"><span className="import-summary-label">Clientes ativos</span><strong>{analytics.activeCustomers}</strong></article>
            <article className="card insights-kpi insights-kpi--danger"><span className="import-summary-label">Taxa de cancelamento</span><strong>{Math.round(analytics.cancelRate * 100)}%</strong></article>
          </section>

          <section className="insights-two">
            <article className="card insights-section">
              <div className="insights-section-head">
                <h2 className="card-title">Faturação semanal</h2>
                <p className="muted-hint">Últimas {windowWeeks} semanas (encomendas entregues).</p>
              </div>
              <div className="insights-chart">
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={weeklyRevenue} margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(134,169,139,0.12)" />
                    <XAxis dataKey="name" tick={chartAxis} stroke="rgba(134,169,139,0.2)" />
                    <YAxis tick={chartAxis} stroke="rgba(134,169,139,0.2)" width={48} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatCurrency(Number(v))} cursor={{ stroke: "rgba(59,130,246,0.25)" }} />
                    <Line type="monotone" dataKey="value" stroke="#34d399" strokeWidth={2.5} dot={{ r: 3, fill: "#34d399" }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="card insights-section">
              <div className="insights-section-head">
                <h2 className="card-title">Top clientes</h2>
                <p className="muted-hint">Por valor entregue.</p>
              </div>
              <ol className="insights-rank">
                {topCustomers.length === 0 && <li className="muted-hint">Sem dados.</li>}
                {topCustomers.map((c, i) => (
                  <li key={c.name + i} className="insights-rank-row">
                    <span className="insights-rank-pos">{i + 1}</span>
                    <span className="insights-rank-name">{c.name}</span>
                    <strong className="insights-rank-value">{formatCurrency(c.value)}</strong>
                  </li>
                ))}
              </ol>
            </article>
          </section>

          {/* Aprendizagem real da IA */}
          <section className="card insights-section">
            <div className="insights-section-head">
              <h2 className="card-title">Aprendizagem da IA</h2>
              <p className="muted-hint">
                {aiLearning.total > 0
                  ? `Baseado em ${aiLearning.total} importação${aiLearning.total === 1 ? "" : "ões"} validada${aiLearning.total === 1 ? "" : "s"} por ti.`
                  : "Ainda sem importações validadas. Cada print que validas ensina a IA e aparece aqui."}
              </p>
            </div>

            {aiLearning.total === 0 ? (
              <p className="muted-hint">
                Valida algumas encomendas importadas na página <strong>Importar</strong> para começar a medir a evolução.
              </p>
            ) : (
              <>
                <div className="insights-kpi-grid">
                  <article className="insights-kpi insights-kpi--accent insights-kpi--bare">
                    <span className="import-summary-label">Precisão média</span>
                    <strong>{Math.round(aiLearning.avgAccuracy * 100)}%</strong>
                    <small className="muted-hint">Linhas aceites sem correção</small>
                  </article>
                  <article className="insights-kpi insights-kpi--info insights-kpi--bare">
                    <span className="import-summary-label">Confiança média</span>
                    <strong>{Math.round(aiLearning.avgConfidence * 100)}%</strong>
                    <small className="muted-hint">Auto-avaliação da IA</small>
                  </article>
                  <article className="insights-kpi insights-kpi--bare">
                    <span className="import-summary-label">Clientes reconhecidos</span>
                    <strong>{Math.round(aiLearning.autoMatchRate * 100)}%</strong>
                    <small className="muted-hint">Match correto quando deteta</small>
                  </article>
                  <article className={`insights-kpi insights-kpi--bare${aiLearning.improving >= 0 ? " insights-kpi--accent" : " insights-kpi--danger"}`}>
                    <span className="import-summary-label">Evolução</span>
                    <strong>{aiLearning.improving >= 0 ? "+" : ""}{aiLearning.improving} pp</strong>
                    <small className="muted-hint">Precisão recente vs inicial</small>
                  </article>
                </div>

                {aiLearning.trend.length >= 2 && (
                  <div className="insights-chart">
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={aiLearning.trend} margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(134,169,139,0.12)" />
                        <XAxis dataKey="name" tick={chartAxis} stroke="rgba(134,169,139,0.2)" />
                        <YAxis domain={[0, 100]} tick={chartAxis} stroke="rgba(134,169,139,0.2)" width={40} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${v}%`, n === "accuracy" ? "Precisão" : "Confiança"]} />
                        <Line type="monotone" dataKey="accuracy" stroke="#34d399" strokeWidth={2.5} dot={false} />
                        <Line type="monotone" dataKey="confidence" stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 3" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="insights-legend">
                      <span className="insights-legend-item"><i style={{ background: "#34d399" }} /> Precisão real</span>
                      <span className="insights-legend-item"><i style={{ background: "#3b82f6" }} /> Confiança da IA</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="insights-two">
            {/* Deteção de anomalias */}
            <article className="card insights-section">
              <div className="insights-section-head">
                <h2 className="card-title">Encomendas atípicas</h2>
                <p className="muted-hint">Valores muito acima/abaixo do habitual (≥ 2 desvios-padrão).</p>
              </div>
              {anomalies.items.length === 0 ? (
                <p className="muted-hint">
                  {activeOrders.length < 5
                    ? "Poucas encomendas para detetar padrões."
                    : "Nenhuma encomenda atípica — tudo dentro do normal."}
                </p>
              ) : (
                <ul className="insights-anomaly-list">
                  {anomalies.items.map((a) => {
                    const d = toDateSafe(a.order.date);
                    return (
                      <li key={a.order.id} className="insights-anomaly-row">
                        <span className={`insights-anomaly-tag insights-anomaly-tag--${a.kind}`}>
                          {a.kind === "alta" ? "▲ Alta" : "▼ Baixa"}
                        </span>
                        <span className="insights-anomaly-info">
                          <strong>{customersById.get(a.order.customerId)?.name ?? "Cliente"}</strong>
                          <small className="muted-hint">
                            {d ? d.toLocaleDateString("pt-PT") : "—"} · {Math.abs(a.deviation).toFixed(1)}σ da média
                          </small>
                        </span>
                        <strong className="insights-anomaly-value">{formatCurrency(a.total)}</strong>
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>

            {/* Sazonalidade */}
            <article className="card insights-section">
              <div className="insights-section-head">
                <h2 className="card-title">Sazonalidade</h2>
                <p className="muted-hint">
                  Procura por mês (quantidade total){seasonality.peak ? ` · pico em ${seasonality.peak}` : ""}.
                </p>
              </div>
              {seasonality.max === 0 ? (
                <p className="muted-hint">Sem dados de procura por mês.</p>
              ) : (
                <div className="insights-heatmap">
                  {seasonality.cells.map((cell) => (
                    <div
                      key={cell.month}
                      className="insights-heat-cell"
                      style={{
                        background: `color-mix(in srgb, var(--accent) ${Math.round(cell.intensity * 100)}%, var(--bg-surface))`,
                      }}
                      title={`${cell.month}: ${formatNumber(cell.value, 0)}`}
                    >
                      <span className="insights-heat-month">{cell.month}</span>
                      <span className="insights-heat-value">{formatNumber(cell.value, 0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </section>
        </>
      )}
    </div>
  );
};

export default InsightsPage;
