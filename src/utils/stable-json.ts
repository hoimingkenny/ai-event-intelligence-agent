/**
 * Deterministic JSON serialization with object keys sorted recursively.
 *
 * Postgres `jsonb` does not preserve object key order on round-trip, so comparing a
 * stored observation value against a freshly-normalized in-memory value with plain
 * `JSON.stringify` reports a spurious difference. Canonicalizing both sides makes the
 * comparison order-insensitive.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const sorted: Record<string, unknown> = {};
    for (const [key, v] of entries) {
      sorted[key] = canonicalize(v);
    }
    return sorted;
  }
  return value;
}
