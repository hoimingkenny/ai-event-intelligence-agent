/**
 * Analyst allowlist for the authenticated workspace (ADR-0003).
 * Fail closed: empty / unset allowlist denies everyone.
 */

export function parseAnalystAllowlist(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAnalystAllowed(
  username: string | null | undefined,
  allowlist: Set<string> | string | null | undefined
): boolean {
  if (!username?.trim()) return false;
  const set = allowlist instanceof Set ? allowlist : parseAnalystAllowlist(allowlist);
  if (set.size === 0) return false;
  return set.has(username.trim().toLowerCase());
}
