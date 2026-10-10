export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseCount(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function* objects(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const child of value) yield* objects(child);
  } else {
    const record = asRecord(value);
    if (!record) return;
    yield record;
    for (const child of Object.values(record)) yield* objects(child);
  }
}

export function* embeddedJson(html: string): Generator<unknown> {
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      yield JSON.parse(script[1]);
    } catch {
      // Executable scripts are not data payloads.
    }
  }
}

export function formatPostDate(value: unknown): string | null {
  const timestamp = parseCount(value);
  if (timestamp === null || timestamp < 100000000 || timestamp > 9999999999) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(timestamp * 1000));
}

export function formatIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function parseFormattedCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/,/g, "").replace(/\s*(?:lượt xem|views|subscribers|likes|comments|bình luận).*$/i, "");
  const m = clean.match(/^([\d.]+)\s*([KMBkmb]|tr|triệu|nghìn|tỷ)?$/i);
  if (!m) {
    const raw = clean.replace(/[^\d]/g, "");
    const num = Number(raw);
    return Number.isSafeInteger(num) && num >= 0 ? num : null;
  }
  let val = parseFloat(m[1]);
  if (isNaN(val)) return null;
  const unit = (m[2] || "").toLowerCase();
  if (unit === "k" || unit === "nghìn") val *= 1_000;
  else if (unit === "m" || unit === "tr" || unit === "triệu") val *= 1_000_000;
  else if (unit === "b" || unit === "tỷ") val *= 1_000_000_000;
  const rounded = Math.round(val);
  return Number.isSafeInteger(rounded) && rounded >= 0 ? rounded : null;
}
