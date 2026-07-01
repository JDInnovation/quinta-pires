import type { ProductUnit } from "../../types";

export interface ParsedCatalogItem {
  name: string;
  price: number;
  unit: ProductUnit;
  rawUnit: string;
}

/** Remove emojis, variation selectors and zero-width joiners from a label. */
function stripEmojis(value: string): string {
  return value
    .replace(/[\p{Extended_Pictographic}\u200D\uFE0F]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map a raw unit label from the catalog to one of the supported product units. */
export function mapCatalogUnit(rawUnit: string): ProductUnit {
  const u = rawUnit.toLowerCase().trim();
  if (u.startsWith("kg") || u === "k") return "kg";
  if (u.startsWith("molho")) return "molho";
  // "un", "uni", "caixa", "saco", "ramo", "pes", "" -> unidade
  return "un";
}

/**
 * Normalize a product name so that names coming from the catalog can be
 * matched against existing products regardless of accents, casing or emojis.
 */
export function normalizeProductName(name: string): string {
  return stripEmojis(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Nome — 1,50€/kg  |  Nome - 5€  |  Nome — 7,50€ (10 pés)  |  Nome — 1,75€/caixa 125g
const PRICE_LINE_RE =
  /^(.*?)\s*[—–-]\s*(\d+(?:[.,]\d+)?)\s*€\s*(?:\/\s*([^()\n]+?))?\s*(?:\([^)]*\))?\s*$/u;

/**
 * Parse a pasted weekly catalog (WhatsApp/emoji format) and extract only the
 * product lines that contain a price. Section headers, promos and footer lines
 * (which never contain "€") are ignored.
 */
export function parseCatalogText(text: string): ParsedCatalogItem[] {
  const items: ParsedCatalogItem[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes("€")) continue;

    const match = line.match(PRICE_LINE_RE);
    if (!match) continue;

    const name = stripEmojis(match[1]);
    if (!name) continue;

    const price = Number(match[2].replace(",", "."));
    if (!Number.isFinite(price) || price <= 0) continue;

    const rawUnit = (match[3] ?? "").trim();
    const key = normalizeProductName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    items.push({ name, price, unit: mapCatalogUnit(rawUnit), rawUnit });
  }

  return items;
}
