import { findKnownService, type KnownService } from "@/lib/services";

export type Frequency = "weekly" | "monthly" | "quarterly" | "annual";

export type Subscription = {
  merchant: string;
  amount: number;
  frequency: Frequency;
  occurrences: number;
  monthlyEquivalent: number;
  service?: Pick<KnownService, "name" | "url" | "label">;
};

export type ScanResult = {
  subscriptions: Subscription[];
  monthlyTotal: number;
  transactionsAnalyzed: number;
  periodDays: number;
};

type Tx = { date: Date; merchant: string; amount: number };

const MAX_ROWS = 100_000;

/* ------------------------------------------------------------------ CSV -- */

/** Picks the delimiter (comma, semicolon, tab, pipe) by counting in the first lines. */
function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join("\n");
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    let count = 0;
    let quoted = false;
    for (const ch of sample) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** Full RFC-4180-style parser: quoted fields may contain delimiters, quotes and newlines. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endCell = () => {
    row.push(cell.trim());
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;

    if (rows.length > MAX_ROWS) throw new Error("This file is too large to scan (over 100,000 rows).");
  }
  if (cell !== "" || row.length) endRow();
  return rows;
}

/* -------------------------------------------------------------- headers -- */

function norm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

type Columns = {
  date: number;
  desc: number;
  debit: number;
  credit: number;
  amount: number;
  type: number;
};

function pickColumn(headers: string[], tests: RegExp[]): number {
  // Earlier patterns win, so "transaction date" beats "value date".
  for (const re of tests) {
    const i = headers.findIndex((h) => re.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

function mapColumns(rawHeaders: string[]): Columns {
  const h = rawHeaders.map(norm);
  const date = pickColumn(h, [/^(transaction|txn|tran|posting|trans) date$/, /^date$/, /\bdate\b(?!.*value)/, /\bdate\b/]);
  const desc = pickColumn(h, [
    /\b(narration|description|merchant|particulars|payee)\b/,
    /\b(transaction )?(remarks|details)\b/,
    /^name$/,
  ]);
  const debit = pickColumn(h, [/\b(debit|withdrawal|withdrawals|withdrawn|paid out|money out)\b/, /^dr( amt| amount)?$/]);
  const credit = pickColumn(h, [/\b(credit|deposit|deposits|paid in|money in)\b/, /^cr( amt| amount)?$/]);
  const amountCandidates = h.map((x, i) => (/\bamount\b|^amt$/.test(x) && !/balance/.test(x) && i !== debit && i !== credit ? i : -1));
  const amount = amountCandidates.find((i) => i >= 0) ?? -1;
  const type = pickColumn(h, [/^(transaction )?type$/, /^dr cr$/, /^cr dr$/, /\bdr cr\b/]);
  return { date, desc, debit, credit, amount, type };
}

function findHeaderRow(rows: string[][]): { index: number; cols: Columns } | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cols = mapColumns(rows[i]);
    if (cols.date >= 0 && cols.desc >= 0 && (cols.debit >= 0 || cols.amount >= 0)) return { index: i, cols };
  }
  return null;
}

/* -------------------------------------------------------------- parsing -- */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function makeDate(y: number, m: number, d: number): Date | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

/**
 * Parses statement dates. Numeric dates are read as DAY first (DD/MM/YYYY, the
 * Indian standard); if the "month" part is above 12 and the "day" part is not,
 * the file is clearly MM/DD and is read that way instead.
 */
export function parseDate(value: string): Date | null {
  const s = value.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/i, "");
  if (!s) return null;
  let m: RegExpMatchArray | null;

  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/))) {
    return makeDate(+m[1], +m[2], +m[3]);
  }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    if (b > 12 && a <= 12) return makeDate(y, a, b); // MM/DD/YYYY
    return makeDate(y, b, a); // DD/MM/YYYY
  }
  if ((m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})[ ,.-]+(\d{2}|\d{4})$/))) {
    const mon = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
    return mon ? makeDate(+m[3], mon, +m[1]) : null;
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/))) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 4)] ?? MONTHS[m[1].toLowerCase().slice(0, 3)];
    return mon ? makeDate(+m[3], mon, +m[2]) : null;
  }
  return null;
}

type ParsedAmount = { value: number; marker: "debit" | "credit" | null };

/** Returns a signed value (negative for "-" or "(...)") plus any Dr/Cr marker. */
export function parseAmount(raw: string): ParsedAmount | null {
  let s = raw.trim();
  if (!s) return null;
  let marker: ParsedAmount["marker"] = null;
  if (/cr\.?$/i.test(s)) marker = "credit";
  else if (/dr\.?$/i.test(s)) marker = "debit";
  s = s.replace(/(cr|dr)\.?$/i, "");
  const negative = /^\s*-|^\(.*\)$|-\s*$/.test(s.trim());
  s = s.replace(/[₹$€£]|rs\.?|inr|usd|[,\s()+-]/gi, "");
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return { value: negative ? -n : n, marker };
}

const NOISE_WORDS = new Set([
  "upi", "neft", "imps", "rtgs", "pos", "ach", "nach", "ecs", "emandate", "mandate", "autopay", "auto", "debit",
  "card", "payment", "pymt", "txn", "ref", "purchase", "dr", "cr", "to", "from", "by", "via", "recurring",
]);

/** Stable key for grouping charges from the same merchant despite changing reference numbers. */
export function merchantKey(description: string): string {
  const cleaned = description
    .toLowerCase()
    .replace(/@[a-z0-9.-]+/g, " ") // UPI handles like netflix@okaxis
    .replace(/\d+/g, " ")
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter((w) => w && !NOISE_WORDS.has(w))
    .join(" ")
    .trim();
  return cleaned || description.toLowerCase().trim();
}

function displayName(description: string) {
  const s = description.replace(/\s+/g, " ").trim();
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

/* ------------------------------------------------------------ detection -- */

const CYCLES: { frequency: Frequency; days: number; tolerance: number; maxSpread: number; minOccurrences: number }[] = [
  { frequency: "weekly", days: 7, tolerance: 2, maxSpread: 1.03, minOccurrences: 4 },
  { frequency: "monthly", days: 30.4, tolerance: 5, maxSpread: 1.15, minOccurrences: 2 },
  { frequency: "quarterly", days: 91, tolerance: 10, maxSpread: 1.15, minOccurrences: 2 },
  { frequency: "annual", days: 365, tolerance: 15, maxSpread: 1.15, minOccurrences: 2 },
];

function monthlyEquivalent(amount: number, frequency: Frequency) {
  switch (frequency) {
    case "weekly": return (amount * 52) / 12;
    case "monthly": return amount;
    case "quarterly": return amount / 3;
    case "annual": return amount / 12;
  }
}

const DAY = 86_400_000;

export function analyzeCsv(csv: string): ScanResult {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one transaction.");

  const header = findHeaderRow(rows);
  if (!header) {
    throw new Error("Could not identify Date, Description/Narration and Amount (or Debit) columns.");
  }
  const { cols } = header;

  type Row = Tx & { signed: number; marker: ParsedAmount["marker"] };
  const parsed: Row[] = [];
  let negatives = 0;

  for (const cells of rows.slice(header.index + 1)) {
    const date = parseDate(cells[cols.date] ?? "");
    const description = (cells[cols.desc] ?? "").trim();
    if (!date || !description) continue;

    let amount: ParsedAmount | null = null;
    if (cols.debit >= 0) {
      amount = parseAmount(cells[cols.debit] ?? "");
      if (!amount || amount.value === 0) continue; // empty debit cell = money came in
      amount = { value: Math.abs(amount.value), marker: "debit" };
    } else {
      amount = parseAmount(cells[cols.amount] ?? "");
      if (!amount || amount.value === 0) continue;
    }

    let marker = amount.marker;
    if (cols.type >= 0) {
      const t = (cells[cols.type] ?? "").toLowerCase();
      if (/credit|^cr\b|\bcr$/.test(t)) marker = "credit";
      else if (/debit|^dr\b|\bdr$/.test(t)) marker = "debit";
    }
    if (marker === null && amount.value < 0) negatives++;

    parsed.push({ date, merchant: description, amount: Math.abs(amount.value), signed: amount.value, marker });
  }

  // Single signed "Amount" column: if the file mixes signs, negatives are
  // spending and positives are money in. If every amount is positive (typical of
  // card statements), they are all spending.
  const txs: Tx[] = parsed
    .filter((r) => {
      if (r.marker === "credit") return false;
      if (r.marker === "debit") return true;
      return negatives > 0 ? r.signed < 0 : true;
    })
    .map(({ date, merchant, amount }) => ({ date, merchant, amount }));

  if (!txs.length) throw new Error("No spending transactions were found in this CSV (check the date and amount columns).");

  // Group by merchant, collapsing exact same-day duplicates.
  const groups = new Map<string, Tx[]>();
  for (const tx of txs) {
    const key = merchantKey(tx.merchant);
    const list = groups.get(key) ?? [];
    if (!list.some((x) => x.date.getTime() === tx.date.getTime() && Math.abs(x.amount - tx.amount) < 0.01)) list.push(tx);
    groups.set(key, list);
  }

  const subscriptions: Subscription[] = [];

  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.getTime() - b.date.getTime());

    const gaps: number[] = [];
    for (let i = 1; i < list.length; i++) gaps.push((list[i].date.getTime() - list[i - 1].date.getTime()) / DAY);

    const amounts = list.map((x) => x.amount);
    const spread = Math.max(...amounts) / Math.min(...amounts);

    let best: { cycle: (typeof CYCLES)[number]; share: number } | null = null;
    for (const cycle of CYCLES) {
      const fits = gaps.filter((g) => Math.abs(g - cycle.days) <= cycle.tolerance).length;
      const share = fits / gaps.length;
      if (share >= 0.6 && list.length >= cycle.minOccurrences && spread <= cycle.maxSpread) {
        if (!best || share > best.share) best = { cycle, share };
      }
    }
    if (!best) continue;

    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const latest = list[list.length - 1];
    const service = findKnownService(latest.merchant);

    subscriptions.push({
      merchant: service ? service.name : displayName(latest.merchant),
      amount: avgAmount,
      frequency: best.cycle.frequency,
      occurrences: list.length,
      monthlyEquivalent: monthlyEquivalent(avgAmount, best.cycle.frequency),
      service: service ? { name: service.name, url: service.url, label: service.label } : undefined,
    });
  }

  subscriptions.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);

  const times = txs.map((t) => t.date.getTime());
  const periodDays = Math.round((Math.max(...times) - Math.min(...times)) / DAY);

  return {
    subscriptions,
    monthlyTotal: subscriptions.reduce((sum, s) => sum + s.monthlyEquivalent, 0),
    transactionsAnalyzed: txs.length,
    periodDays,
  };
}
