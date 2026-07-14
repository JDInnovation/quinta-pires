import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import toast from "react-hot-toast";
import type { Order, Customer, Product } from "../types";
import logoUrl from "../assets/logo.png";
import warningUrl from "../assets/warning.png";

/* ================================================================
   Image pre-load (cached base64)
   ================================================================ */
function loadImage(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const imageCache = new Map<string, Promise<string | null>>();
function loadCachedImage(url: string): Promise<string | null> {
  if (!imageCache.has(url)) imageCache.set(url, loadImage(url));
  return imageCache.get(url)!;
}

/* ================================================================
   Brand palette (earthy green)
   ================================================================ */
const BRAND = {
  green: [22, 101, 52] as [number, number, number],   // header bg
  greenLight: [74, 222, 128] as [number, number, number],
  dark: [6, 13, 8] as [number, number, number],
  surface: [14, 34, 20] as [number, number, number],
  text: [60, 60, 60] as [number, number, number],
  muted: [130, 130, 130] as [number, number, number],
  stripe: [245, 250, 246] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  border: [200, 215, 205] as [number, number, number],
};

/* ================================================================
   Helpers
   ================================================================ */
function getPreparingOrders(orders: Order[]): Order[] {
  return orders.filter((o) => o.status === "preparing");
}

function normalizeUnit(unit?: string): string {
  const u = (unit ?? "").trim().toLowerCase();
  if (!u) return "";
  if (u === "uni" || u === "unidade" || u === "unidades") return "un";
  return u;
}

function formatUnitLabel(unit: string): string {
  const u = normalizeUnit(unit);
  if (u === "un") return "uni";
  return u;
}

function formatQty(q: number): string {
  const isInt = Math.abs(q - Math.round(q)) < 1e-9;
  return q.toLocaleString("pt-PT", { maximumFractionDigits: isInt ? 0 : 2 });
}

function formatMoney(value?: number): string {
  const v = typeof value === "number" ? value : 0;
  if (!v) return "—";
  return v.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
}

type TotalsByProductAndUnit = Map<string, Map<string, number>>;

function addQty(
  totals: TotalsByProductAndUnit,
  productId: string,
  unit: string,
  qty: number,
) {
  const u = normalizeUnit(unit) || "";
  const byUnit = totals.get(productId) ?? new Map<string, number>();
  const prev = byUnit.get(u) ?? 0;
  byUnit.set(u, prev + qty);
  totals.set(productId, byUnit);
}

function buildQtyString(
  byUnit: Map<string, number>,
  fallbackUnit?: string,
): string {
  const entries = Array.from(byUnit.entries()).filter(([, q]) => q !== 0);
  if (entries.length === 1 && entries[0][0] === "" && fallbackUnit) {
    return `${formatQty(entries[0][1])} ${formatUnitLabel(fallbackUnit)}`;
  }
  return entries
    .map(([unit, qty]) => {
      const u = unit || fallbackUnit || "";
      return `${formatQty(qty)} ${formatUnitLabel(u)}`.trim();
    })
    .join(" + ");
}

// Referencia interna gerada pela importacao IA (ex: "Importacao IA: abc123").
const IMPORT_ID_RE = /Importa[çc][ãa]o\s*IA:\s*([^\s|]+)/i;

/** Notas visiveis (sem o segmento tecnico "Importacao IA: <id>"). */
function collectDisplayNotes(orders: Order[]): string[] {
  const notes = orders.map((o) =>
    (o.notes ?? "")
      .split("|")
      .map((part) => part.trim())
      .filter((part) => part && !IMPORT_ID_RE.test(part))
      .join(" | ")
      .trim(),
  );
  return Array.from(new Set(notes.filter(Boolean)));
}

/** IDs de referencia da importacao IA presentes nas notas das encomendas. */
function collectImportRefIds(orders: Order[]): string[] {
  const ids = new Set<string>();
  orders.forEach((o) => {
    (o.notes ?? "")
      .split("|")
      .map((part) => part.trim())
      .forEach((part) => {
        const match = part.match(IMPORT_ID_RE);
        if (match) ids.add(match[1]);
      });
  });
  return Array.from(ids);
}

/* ================================================================
   Shared PDF primitives
   ================================================================ */

/** Branded header bar with title + date */
function drawHeader(doc: jsPDF, title: string, today: string, logo: string | null): number {
  const pw = doc.internal.pageSize.getWidth();
  const topMargin = 30;
  let leftOffset = 40;

  // Logo
  if (logo) {
    const logoH = 36;
    const logoW = 36;
    doc.addImage(logo, "PNG", 40, topMargin - 6, logoW, logoH);
    leftOffset = 40 + logoW + 10;
  }

  // Title
  doc.setTextColor(...BRAND.green);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(title, leftOffset, topMargin + 8);

  // Subtitle line
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...BRAND.muted);
  doc.text("QUINTA PIRES — Gestão de Entregas", leftOffset, topMargin + 22);

  // Date right-aligned
  doc.text(`Data: ${today}`, pw - 40, topMargin + 22, { align: "right" });

  // Thin separator line under header
  const lineY = topMargin + 32;
  doc.setDrawColor(...BRAND.green);
  doc.setLineWidth(1);
  doc.line(40, lineY, pw - 40, lineY);

  // reset text color
  doc.setTextColor(...BRAND.text);
  return lineY + 16; // Y position after header
}

/** Thin accent line separator */
function drawSeparator(doc: jsPDF, y: number) {
  const pw = doc.internal.pageSize.getWidth();
  doc.setDrawColor(...BRAND.border);
  doc.setLineWidth(0.5);
  doc.line(40, y, pw - 40, y);
}

/** Footer on each page */
function drawFooter(doc: jsPDF) {
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(...BRAND.muted);
    doc.text("Quinta Pires — Documento gerado automaticamente", 40, ph - 20);
    doc.text(`Página ${i} / ${pages}`, pw - 40, ph - 20, { align: "right" });
  }
}

/** Notes block rendered below the last table */
function renderNotesBlock(doc: jsPDF, notes: string[], warningImg: string | null) {
  if (!notes.length) return;

  const lastY = (doc as any).lastAutoTable?.finalY ?? 120;
  const ph = doc.internal.pageSize.getHeight();
  const pw = doc.internal.pageSize.getWidth();
  const mx = 40;
  const maxW = pw - mx * 2;

  let y = lastY + 20;
  const est = 16 + notes.length * 14;
  if (y + est > ph - 50) {
    doc.addPage();
    y = 40;
  }

  // Warning icon + Label
  let labelX = mx;
  if (warningImg) {
    const iconSize = 14;
    doc.addImage(warningImg, "PNG", mx, y - iconSize + 2, iconSize, iconSize);
    labelX = mx + iconSize + 4;
  }
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BRAND.green);
  doc.text("NOTAS INTERNAS", labelX, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...BRAND.text);

  const lines: string[] = [];
  for (const note of notes) {
    const wrapped = doc.splitTextToSize(`• ${note}`, maxW) as string[];
    lines.push(...wrapped);
  }
  doc.setFontSize(11);
  doc.text(lines, mx, y + 18);
}

/** Shared autoTable theme */
const tableTheme = {
  styles: {
    fontSize: 9,
    cellPadding: { top: 5, right: 6, bottom: 5, left: 6 },
    lineColor: BRAND.border,
    lineWidth: 0.25,
    textColor: BRAND.text,
    font: "helvetica",
  } as const,
  headStyles: {
    fillColor: BRAND.white,
    textColor: BRAND.green,
    fontStyle: "bold" as const,
    fontSize: 8,
    halign: "left" as const,
  },
  alternateRowStyles: {
    fillColor: BRAND.stripe,
  },
  columnStyles: {} as Record<number, object>,
};

/* ================================================================
   1) Picking list — aggregated products in preparation
   ================================================================ */
export async function exportPickingListPdf(orders: Order[], products: Product[]) {
  const prep = getPreparingOrders(orders);
  if (!prep.length) {
    toast.error("Não há encomendas em preparação.");
    return;
  }

  const logo = await loadCachedImage(logoUrl);

  const totals: TotalsByProductAndUnit = new Map();
  prep.forEach((o) =>
    o.items.forEach((it) => {
      const p = products.find((pp) => pp.id === it.productId);
      addQty(totals, it.productId, it.unit ?? p?.unit ?? "", it.quantity);
    }),
  );

  const rows = Array.from(totals.entries()).map(([pid, byUnit]) => {
    const p = products.find((pp) => pp.id === pid);
    return [p?.name ?? "Produto", buildQtyString(byUnit, p?.unit), ""];
  });

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const today = new Date().toLocaleDateString("pt-PT");
  const startY = drawHeader(doc, "Produtos em Preparação", today, logo);

  // Subtitle
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.muted);
  doc.text(
    `Lista agregada de ${prep.length} encomenda(s) em preparação  ·  ${rows.length} produto(s)`,
    40,
    startY - 4,
  );
  doc.setTextColor(...BRAND.text);

  autoTable(doc, {
    startY,
    head: [["Produto", "Quantidade Planeada", "Comprar ✓"]],
    body: rows,
    ...tableTheme,
    styles: {
      ...tableTheme.styles,
      fontSize: 12,
    },
    headStyles: {
      ...tableTheme.headStyles,
      fontSize: 10,
    },
    columnStyles: {
      0: { cellWidth: 200, fontStyle: "bold" },
      1: { halign: "center", cellWidth: 80 },
      2: { halign: "center", cellWidth: 90 },
    },
  });

  drawFooter(doc);
  doc.save(`produtos-preparacao-${today.replace(/\//g, "-")}.pdf`);
}

/* ================================================================
   2) Customer sheets — one page per customer
   ================================================================ */
export async function exportCustomerSheetsPdf(
  orders: Order[],
  customers: Customer[],
  products: Product[],
) {
  const prep = getPreparingOrders(orders);
  if (!prep.length) {
    toast.error("Não há encomendas em preparação.");
    return;
  }

  const logo = await loadCachedImage(logoUrl);
  const warningImg = await loadCachedImage(warningUrl);

  const byCustomer = new Map<string, Order[]>();
  prep.forEach((o) => {
    const list = byCustomer.get(o.customerId) ?? [];
    list.push(o);
    byCustomer.set(o.customerId, list);
  });

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const today = new Date().toLocaleDateString("pt-PT");
  let first = true;

  const customerNameById = new Map(customers.map((c) => [c.id, c.name] as const));
  const sortedCustomerEntries = Array.from(byCustomer.entries()).sort((a, b) =>
    (customerNameById.get(a[0]) ?? "Cliente desconhecido").localeCompare(
      customerNameById.get(b[0]) ?? "Cliente desconhecido",
      "pt-PT",
    ),
  );

  sortedCustomerEntries.forEach(([cid, custOrders]) => {
    if (!first) doc.addPage();
    first = false;

    const c = customers.find((cc) => cc.id === cid);
    const name = c?.name ?? "Cliente desconhecido";

    // Check if this is a first-time customer (no orders besides the current preparing ones)
    const totalOrdersForCustomer = orders.filter((o) => o.customerId === cid).length;
    const isFirstTime = totalOrdersForCustomer === custOrders.length;

    const startY = drawHeader(doc, name, today, logo);

    // Customer info box
    const pw = doc.internal.pageSize.getWidth();
    doc.setFillColor(245, 250, 246);
    doc.roundedRect(40, startY - 6, pw - 80, 62, 4, 4, "F");

    let infoY = startY + 8;

    // Phone — prominent
    if (c?.phone) {
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...BRAND.dark);
      doc.text(`Tel: ${c.phone}`, 52, infoY);
      infoY += 16;
    }

    // Address — prominent
    if (c?.address) {
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...BRAND.dark);
      doc.text(`Morada: ${c.address}`, 52, infoY);
      infoY += 14;
    }

    // NIF — destacado (usado para faturacao)
    if (c?.nif) {
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...BRAND.dark);
      doc.text(`NIF: ${c.nif}`, 52, infoY);
      infoY += 14;
    }

    doc.setTextColor(...BRAND.text);

    // Aggregate products
    const totals: TotalsByProductAndUnit = new Map();
    custOrders.forEach((o) =>
      o.items.forEach((it) => {
        const p = products.find((pp) => pp.id === it.productId);
        addQty(totals, it.productId, it.unit ?? p?.unit ?? "", it.quantity);
      }),
    );

    const rows = Array.from(totals.entries()).map(([pid, byUnit]) => {
      const p = products.find((pp) => pp.id === pid);
      return [
        p?.name ?? "Produto",
        buildQtyString(byUnit, p?.unit),
        formatMoney(p?.price),
        "",
      ];
    });

    // First-time customer: add "Saco" line at €1
    if (isFirstTime) {
      rows.push(["Saco", "1 un", formatMoney(1), ""]);
    }

    drawSeparator(doc, startY + 62);

    autoTable(doc, {
      startY: startY + 70,
      head: [["Produto", "Qtd. Planeada", "Preço/un.", "Peso Real"]],
      body: rows,
      ...tableTheme,
      columnStyles: {
        0: { cellWidth: 180, fontStyle: "bold" },
        1: { halign: "center", cellWidth: 70 },
        2: { halign: "right", cellWidth: 70 },
        3: { halign: "center", cellWidth: 120 },
      },
    });

    renderNotesBlock(doc, collectDisplayNotes(custOrders), warningImg);

    // Referencia interna da importacao IA no rodape da pagina do cliente
    const importRefIds = collectImportRefIds(custOrders);
    if (importRefIds.length) {
      const ph = doc.internal.pageSize.getHeight();
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...BRAND.muted);
      doc.text(`Ref. importacao IA: ${importRefIds.join(", ")}`, 40, ph - 32);
      doc.setTextColor(...BRAND.text);
    }
  });

  drawFooter(doc);
  doc.save(`encomendas-clientes-${today.replace(/\//g, "-")}.pdf`);
}

export async function exportAccountSheetPdf() {
  const logo = await loadCachedImage(logoUrl);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const today = new Date().toLocaleDateString("pt-PT");
  const startY = drawHeader(doc, "Folha de Contas", today, logo);

  const operatorY = startY + 12;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Operador:", 40, operatorY);
  doc.setDrawColor(...BRAND.border);
  doc.setLineWidth(1);
  doc.rect(100, operatorY - 10, 130, 16);

  const y = operatorY + 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Valor inicial da caixa:", 40, y);

  const rectX = 165;
  const rectY = y - 14;
  const rectW = 110;
  const rectH = 14;
  doc.setDrawColor(...BRAND.border);
  doc.setLineWidth(1);
  doc.rect(rectX, rectY, rectW, rectH);

  const nextY = y + 30;
  doc.setFontSize(12);
  doc.text("Movimentos da caixa", 40, nextY);

  const accountRows = Array.from({ length: 20 }, () => ["", "", "", ""]);

  autoTable(doc, {
    startY: y + 10,
    head: [["Nome", "Valor", "Pagou", "Pagamento"]],
    body: accountRows,
    ...tableTheme,
    styles: {
      ...tableTheme.styles,
      fontSize: 10,
      cellPadding: { top: 4, right: 4, bottom: 4, left: 4 },
    },
    headStyles: {
      ...tableTheme.headStyles,
      fontSize: 9,
    },
    columnStyles: {
      0: { cellWidth: 220 },
      1: { cellWidth: 60, halign: "right" },
      2: { cellWidth: 45, halign: "center" },
      3: { cellWidth: 110 },
    },
    didDrawCell: (data) => {
      if (data.section === "body") {
        const cell = data.cell;
        const { x, y: cellY, width, height } = cell;
        if (data.column.index === 2) {
          const boxSize = 10;
          const boxX = x + (width - boxSize) / 2;
          const boxY = cellY + (height - boxSize) / 2;
          doc.setDrawColor(...BRAND.text);
          doc.setLineWidth(0.8);
          doc.rect(boxX, boxY, boxSize, boxSize);
        }
        if (data.column.index === 3) {
          const boxSize = 8;
          const left = x + 5;
          const top = cellY + (height - boxSize) / 2;
          doc.setDrawColor(...BRAND.text);
          doc.setLineWidth(0.8);
          doc.rect(left, top, boxSize, boxSize);
          doc.rect(left + 52, top, boxSize, boxSize);
          doc.setFontSize(8);
          doc.setFont("helvetica", "normal");
          doc.text("MBWAY", left + boxSize + 3, top + boxSize);
          doc.text("DINHEIRO", left + 52 + boxSize + 3, top + boxSize);
        }
      }
    },
  });

  const firstTableEndY = (doc as any).lastAutoTable?.finalY ?? (y + 10);
  const gastosTitleY = firstTableEndY + 24;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Gastos", 40, gastosTitleY);

  const expenseRows = Array.from({ length: 8 }, () => ["", ""]);

  autoTable(doc, {
    startY: gastosTitleY + 10,
    head: [["Nome do gasto", "Valor"]],
    body: expenseRows,
    ...tableTheme,
    styles: {
      ...tableTheme.styles,
      fontSize: 10,
    },
    headStyles: {
      ...tableTheme.headStyles,
      fontSize: 9,
    },
    columnStyles: {
      0: { cellWidth: 260 },
      1: { cellWidth: 100, halign: "right" },
    },
  });

  drawFooter(doc);
  doc.save(`folha-de-contas-${today.replace(/\//g, "-")}.pdf`);
}

/* ================================================================
   4) Catálogo — todos os produtos e preços (letra grande, legível)
   ================================================================ */
export async function exportCatalogPdf(products: Product[]) {
  if (!products.length) {
    toast.error("Não há produtos no catálogo.");
    return;
  }

  const logo = await loadCachedImage(logoUrl);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const today = new Date().toLocaleDateString("pt-PT");
  const startY = drawHeader(doc, "Catálogo de Produtos", today, logo);

  const sorted = [...products].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-PT", { sensitivity: "base" }),
  );

  const rows = sorted.map((p) => [
    p.name,
    formatUnitLabel(p.unit),
    `${formatMoney(p.price)} / ${formatUnitLabel(p.unit)}`,
  ]);

  doc.setFontSize(11);
  doc.setTextColor(...BRAND.muted);
  doc.text(`${sorted.length} produto(s)`, 40, startY - 4);
  doc.setTextColor(...BRAND.text);

  autoTable(doc, {
    startY,
    head: [["Produto", "Unidade", "Preço"]],
    body: rows,
    ...tableTheme,
    styles: {
      ...tableTheme.styles,
      fontSize: 15,
      cellPadding: { top: 9, right: 8, bottom: 9, left: 8 },
    },
    headStyles: {
      ...tableTheme.headStyles,
      fontSize: 13,
    },
    columnStyles: {
      0: { cellWidth: 300, fontStyle: "bold" },
      1: { halign: "center", cellWidth: 90 },
      2: { halign: "right", cellWidth: 125, fontStyle: "bold" },
    },
  });

  drawFooter(doc);
  doc.save(`catalogo-produtos-${today.replace(/\//g, "-")}.pdf`);
}
