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
  // Callouts (notas dos produtos / instrucoes de entrega)
  productBg: [240, 249, 244] as [number, number, number],
  productBorder: [167, 214, 186] as [number, number, number],
  deliveryBg: [255, 247, 224] as [number, number, number],
  deliveryBorder: [251, 191, 36] as [number, number, number],
  deliveryAccent: [180, 83, 9] as [number, number, number],
};

/* ================================================================
   Layout constants (tudo alinhado com a largura da tabela)
   ================================================================ */
// Margem esquerda e largura util. A largura ocupa quase toda a folha A4
// (595pt - 2*40 de margem = 515) e as colunas da tabela somam esse valor,
// para o conteudo preencher a pagina em vez de ficar espaco livre a direita.
const CONTENT_LEFT = 40;
const TABLE_WIDTH = 515;

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

/** Normaliza texto para comparacao (sem acentos, minusculas). */
function normalizeText(value: string): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Extrai o qualificador de uma nota de produto removendo o nome do produto.
 *  Ex: nota "Laranja Madura" + produto "Laranja" -> "Madura". */
function productQualifier(note: string, productName: string): string {
  const noteWords = note.trim().split(/\s+/);
  const nameWords = productName.trim().split(/\s+/);
  let i = 0;
  while (
    i < nameWords.length &&
    i < noteWords.length &&
    normalizeText(noteWords[i]) === normalizeText(nameWords[i])
  ) {
    i++;
  }
  const rest = noteWords.slice(i).join(" ").trim();
  return rest || note.trim();
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

/** Segmentos individuais das notas (sem o segmento tecnico "Importacao IA: <id>"). */
function collectNoteSegments(orders: Order[]): string[] {
  const seen = new Set<string>();
  const segments: string[] = [];
  orders.forEach((o) => {
    (o.notes ?? "")
      // Separadores possiveis entre instrucoes: "|", nova linha, ";" e bullets.
      .split(/[|\n;•·]+/)
      .map((part) => part.trim())
      .forEach((part) => {
        if (!part || IMPORT_ID_RE.test(part)) return;
        const key = part.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        segments.push(part);
      });
  });
  return segments;
}

// Deteta instrucoes de entrega: horarios, onde deixar, morada alternativa, etc.
const DELIVERY_RE =
  /entrega|entregar|deixar|portaria|campainha|vizinh|rece[cç][aã]o|morada|\brua\b|avenida|\bav\.?\b|\blote\b|\bandar\b|\bporta\b|hor[aá]rio|\b\d{1,2}[:h]\d{0,2}\b|ap[oó]s as|at[eé] as|antes das|depois das/i;
// Deteta notas de estado/qualidade do produto (ex: "Laranja Madura", "Pepino Pequeno").
const PRODUCT_STATE_RE =
  /\b(madur[oa]s?|verdes?|verdinh\w*|pequen[oa]s?|grandes?|m[eé]di[oa]s?|frescos?|frescas?|doces?|amarel[oa]s?|molinh\w*|durinh\w*|rij[oa]s?)\b/i;

type NoteKind = "delivery" | "product" | "internal";
function classifyNote(segment: string): NoteKind {
  if (DELIVERY_RE.test(segment)) return "delivery";
  if (PRODUCT_STATE_RE.test(segment)) return "product";
  return "internal";
}

/** Distribui os segmentos por entrega / produto / interno. Quando um segmento
 *  tem sinais de AMBOS (ex: "Entrega apos as 18H, tomate maduro") divide-o por
 *  virgulas/"e"/bullets e classifica cada pedaco separadamente. */
function distributeNoteSegments(segments: string[]): {
  delivery: string[];
  product: string[];
  internal: string[];
} {
  const delivery: string[] = [];
  const product: string[] = [];
  const internal: string[] = [];

  segments.forEach((seg) => {
    const mixed = DELIVERY_RE.test(seg) && PRODUCT_STATE_RE.test(seg);
    const pieces = mixed
      ? seg
          .split(/,| e (?=\S)/i)
          .map((p) => p.trim())
          .filter(Boolean)
      : [seg];
    pieces.forEach((piece) => {
      const kind = classifyNote(piece);
      if (kind === "delivery") delivery.push(piece);
      else if (kind === "product") product.push(piece);
      else internal.push(piece);
    });
  });

  return { delivery, product, internal };
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

/** Linha do NIF, com icone de atencao, imediatamente por baixo da tabela. */
function renderNifLine(
  doc: jsPDF,
  y: number,
  nif: string,
  warningImg: string | null,
): number {
  const ph = doc.internal.pageSize.getHeight();
  if (y + 26 > ph - 45) {
    doc.addPage();
    y = 40;
  }
  const mx = 40;
  let x = mx;
  if (warningImg) {
    const iconSize = 16;
    doc.addImage(warningImg, "PNG", x, y - iconSize + 5, iconSize, iconSize);
    x += iconSize + 7;
  }
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BRAND.dark);
  doc.text(`NIF: ${nif}`, x, y + 5);
  doc.setTextColor(...BRAND.text);
  return y + 26;
}

/** Desenha um cartao arredondado com barra de acento a esquerda que acompanha
 *  os cantos redondos (a barra e feita com um retangulo arredondado por baixo,
 *  coberto por um segundo retangulo com o fundo do cartao). Devolve o X onde o
 *  conteudo do cartao deve comecar. */
function drawCard(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: {
    bg: [number, number, number];
    border: [number, number, number];
    accent?: [number, number, number];
  },
): number {
  const r = 6;
  const barW = 4;
  if (opts.accent) {
    // Base (acento) com cantos redondos
    doc.setFillColor(...opts.accent);
    doc.roundedRect(x, y, w, h, r, r, "F");
    // Conteudo por cima, deixando so a barra de acento visivel a esquerda
    doc.setFillColor(...opts.bg);
    doc.setDrawColor(...opts.border);
    doc.setLineWidth(0.75);
    doc.roundedRect(x + barW, y, w - barW, h, r, r, "FD");
    return x + barW;
  }
  doc.setFillColor(...opts.bg);
  doc.setDrawColor(...opts.border);
  doc.setLineWidth(0.75);
  doc.roundedRect(x, y, w, h, r, r, "FD");
  return x;
}

/** Caixa de destaque (callout) para instrucoes de entrega / notas internas. */
function renderCallout(
  doc: jsPDF,
  y: number,
  opts: {
    title: string;
    items: string[];
    bg: [number, number, number];
    border: [number, number, number];
    accent: [number, number, number];
    icon?: string | null;
  },
): number {
  const ph = doc.internal.pageSize.getHeight();
  const x = CONTENT_LEFT;
  const boxW = TABLE_WIDTH;
  const padX = 14;
  const padY = 14;
  const barW = 5;
  const contentLeft = x + barW + padX;
  const textMaxW = boxW - barW - padX * 2;
  const titleH = 18;
  const lineH = 16;

  // Pre-calcula as linhas do corpo (quebra de texto)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  const wrapped: string[] = [];
  opts.items.forEach((it) => {
    const lines = doc.splitTextToSize(`•  ${it}`, textMaxW) as string[];
    wrapped.push(...lines);
  });

  const boxH = padY + titleH + wrapped.length * lineH + padY - 4;

  if (y + boxH > ph - 45) {
    doc.addPage();
    y = 40;
  }

  // Cartao arredondado com barra de acento (cantos acompanhados)
  drawCard(doc, x, y, boxW, boxH, {
    bg: opts.bg,
    border: opts.border,
    accent: opts.accent,
  });

  // Titulo (com icone opcional)
  const titleY = y + padY + 5;
  let titleX = contentLeft;
  if (opts.icon) {
    const iconSize = 15;
    doc.addImage(opts.icon, "PNG", contentLeft, titleY - iconSize + 3, iconSize, iconSize);
    titleX = contentLeft + iconSize + 6;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...opts.accent);
  doc.text(opts.title, titleX, titleY);

  // Corpo
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(...BRAND.text);
  doc.text(wrapped, contentLeft, titleY + lineH + 3);

  return y + boxH + 14;
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

    // Caixa de info do cliente (mesmo aspeto dos restantes cartoes).
    // Altura dinamica: a morada quebra para varias linhas quando e comprida.
    const infoBoxTop = startY - 6;
    const infoPadLeft = 14;
    const infoTextMaxW = TABLE_WIDTH - 5 - infoPadLeft * 2;

    let addrLines: string[] = [];
    if (c?.address) {
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      addrLines = doc.splitTextToSize(`Morada: ${c.address}`, infoTextMaxW) as string[];
    }

    const phoneH = c?.phone ? 20 : 0;
    const addrH = addrLines.length * 17;
    const infoBoxH = Math.max(46, 16 + phoneH + addrH);

    const infoContentLeft =
      drawCard(doc, CONTENT_LEFT, infoBoxTop, TABLE_WIDTH, infoBoxH, {
        bg: BRAND.stripe,
        border: BRAND.border,
        accent: BRAND.green,
      }) + infoPadLeft;

    let infoY = infoBoxTop + 24;

    // Phone — prominent
    if (c?.phone) {
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...BRAND.dark);
      doc.text(`Tel: ${c.phone}`, infoContentLeft, infoY);
      infoY += 20;
    }

    // Address — prominent (quebra para varias linhas se necessario)
    if (addrLines.length) {
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...BRAND.dark);
      addrLines.forEach((ln) => {
        doc.text(ln, infoContentLeft, infoY);
        infoY += 17;
      });
    }

    doc.setTextColor(...BRAND.text);

    const infoBoxBottom = infoBoxTop + infoBoxH;
    const separatorY = infoBoxBottom + 10;
    const tableStartY = separatorY + 8;

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

    // Segmenta e classifica as notas das encomendas.
    const segments = collectNoteSegments(custOrders);
    const { delivery: deliveryNotes, product: productNotes, internal: internalNotes } =
      distributeNoteSegments(segments);

    // Associa cada nota de produto a linha do respetivo produto (match por nome).
    // A nota fica escrita na propria linha, por baixo do nome do produto.
    const usedProductNotes = new Set<number>();
    const rowNotes: string[] = rows.map((row) => {
      const pname = String(row[0]);
      for (let idx = 0; idx < productNotes.length; idx++) {
        if (usedProductNotes.has(idx)) continue;
        if (normalizeText(productNotes[idx]).includes(normalizeText(pname))) {
          usedProductNotes.add(idx);
          return productQualifier(productNotes[idx], pname);
        }
      }
      return "";
    });

    // Reserva uma segunda linha na celula do nome quando ha nota a desenhar.
    rows.forEach((row, i) => {
      if (rowNotes[i]) row[0] = `${row[0]}\n `;
    });

    // Notas de produto que nao casaram com nenhuma linha vao para as notas internas.
    const leftoverProductNotes = productNotes.filter((_, idx) => !usedProductNotes.has(idx));
    const remainingInternal = [...internalNotes, ...leftoverProductNotes];

    // Separador alinhado com a largura da tabela.
    doc.setDrawColor(...BRAND.border);
    doc.setLineWidth(0.5);
    doc.line(CONTENT_LEFT, separatorY, CONTENT_LEFT + TABLE_WIDTH, separatorY);

    autoTable(doc, {
      startY: tableStartY,
      head: [["Produto", "Qtd. Planeada", "Preço/un.", "Peso Real"]],
      body: rows,
      ...tableTheme,
      styles: {
        ...tableTheme.styles,
        fontSize: 11,
        cellPadding: { top: 7, right: 8, bottom: 7, left: 8 },
      },
      headStyles: {
        ...tableTheme.headStyles,
        fontSize: 10,
      },
      columnStyles: {
        0: { cellWidth: 240, fontStyle: "bold" },
        1: { halign: "center", cellWidth: 85 },
        2: { halign: "right", cellWidth: 80 },
        3: { halign: "center", cellWidth: 110 },
      },
      // Escreve a nota do produto (estado/qualidade) na propria linha, por baixo
      // do nome, em italico e cor de destaque.
      didDrawCell: (data) => {
        if (data.section !== "body" || data.column.index !== 0) return;
        const note = rowNotes[data.row.index];
        if (!note) return;
        const { x, y: cy, height } = data.cell;
        doc.setFont("helvetica", "italic");
        doc.setFontSize(10);
        doc.setTextColor(...BRAND.green);
        doc.text(note, x + 8, cy + height - 7);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...BRAND.text);
      },
    });

    // Estrutura por baixo da tabela de produtos:
    //  1) NIF (icone de atencao) imediatamente por baixo da ultima linha;
    //  2) instrucoes de entrega (horario, onde deixar, morada alternativa);
    //  3) eventuais notas internas restantes.
    let blockY = (((doc as any).lastAutoTable?.finalY as number) ?? startY + 70) + 18;

    if (c?.nif) {
      blockY = renderNifLine(doc, blockY, c.nif, warningImg);
    }

    if (deliveryNotes.length) {
      blockY = renderCallout(doc, blockY, {
        title: deliveryNotes.length > 1 ? "Instruções de entrega" : "Instrução de entrega",
        items: deliveryNotes,
        bg: BRAND.deliveryBg,
        border: BRAND.deliveryBorder,
        accent: BRAND.deliveryAccent,
        icon: warningImg,
      });
    }

    if (remainingInternal.length) {
      blockY = renderCallout(doc, blockY, {
        title: "Notas internas",
        items: remainingInternal,
        bg: BRAND.stripe,
        border: BRAND.border,
        accent: BRAND.muted,
      });
    }

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
