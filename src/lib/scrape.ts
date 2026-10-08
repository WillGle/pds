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
