/**
 * Entity confidence scoring — the "noise-tolerant extractor" (family B).
 *
 * Perfect extraction is unattainable: residual boilerplate (footer "Related:
 * Microsoft patches…" links, ad copy, "you may also like" headlines) will
 * always leak some vendor/product mentions into cleanText. Rather than depend
 * on cleaning being perfect, every entity is born with a confidence derived
 * from *where* and *how* it appears, so noise entities are born weak and can
 * be gated out downstream (family C).
 *
 * Signals:
 * - zone: title/summary/lead paragraphs are strong; the tail of the body
 *   (where related-article lists and footers concentrate) is weak.
 * - frequency: repeated mentions corroborate a real subject.
 * - corroboration: a vendor/product co-occurring with cyber keywords or a CVE
 *   is about a security event; a lone vendor name in a link is likely noise.
 *
 * Structural identifiers (CVE, IOC) are precise by format and scored high
 * regardless of zone — "CVE-2026-1234" is not accidentally a CVE.
 */

export type TextZone = 'title' | 'summary' | 'lead' | 'body' | 'tail';

/** Max confidence a placement zone can justify on its own. */
const ZONE_WEIGHT: Record<TextZone, number> = {
  title: 1.0,
  summary: 0.9,
  lead: 0.8,
  body: 0.6,
  tail: 0.3,
};

const REPEAT_BONUS = 0.1;
/** A vendor/product with no nearby cyber signal is capped here — likely noise. */
const UNCORROBORATED_CAP = 0.45;
/** Structural regex matches (CVE/IOC) are precise regardless of placement. */
const STRUCTURAL_CONFIDENCE = 0.95;

export interface EntitySignals {
  entityType: string;
  /** Zones the entity was found in (best one drives the base score). */
  zones: TextZone[];
  occurrences: number;
  /** Article contains cyber keywords or a CVE (corroborating security context). */
  corroborated: boolean;
}

export function scoreEntity(signals: EntitySignals): number {
  if (signals.entityType === 'cve' || signals.entityType.startsWith('ioc_')) {
    // Placement still matters a little: a CVE only in the tail is less trusted.
    const onlyTail = signals.zones.length > 0 && signals.zones.every((z) => z === 'tail');
    return round(onlyTail ? 0.6 : STRUCTURAL_CONFIDENCE);
  }

  const baseZone = Math.max(0, ...signals.zones.map((z) => ZONE_WEIGHT[z]));
  let score = baseZone + (signals.occurrences >= 2 ? REPEAT_BONUS : 0);

  // Vendor/product without security context is the classic false positive.
  const contextual = signals.entityType === 'vendor' || signals.entityType === 'product';
  if (contextual && !signals.corroborated) {
    score = Math.min(score, UNCORROBORATED_CAP);
  }

  return round(Math.max(0, Math.min(1, score)));
}

/**
 * Splits an article into weighted zones. `body` is the middle; `tail` is the
 * final slice where boilerplate concentrates; `lead` is the opening.
 */
export function buildZonedText(input: {
  title?: string | null;
  summary?: string | null;
  body?: string | null;
}): Record<TextZone, string> {
  const body = (input.body ?? '').trim();
  const leadLen = 500;
  const tailLen = 400;

  const lead = body.slice(0, leadLen);
  const tail = body.length > leadLen + tailLen ? body.slice(-tailLen) : '';
  const middle = body.slice(leadLen, tail ? body.length - tailLen : undefined);

  return {
    title: input.title ?? '',
    summary: input.summary ?? '',
    lead,
    body: middle,
    tail,
  };
}

/** Which zones contain the phrase, and total occurrence count across zones. */
export function locatePhrase(
  zones: Record<TextZone, string>,
  phrase: string
): { zones: TextZone[]; occurrences: number } {
  const pattern = phraseRegex(phrase);
  const found: TextZone[] = [];
  let occurrences = 0;

  for (const zone of Object.keys(zones) as TextZone[]) {
    const matches = zones[zone].match(pattern);
    if (matches && matches.length > 0) {
      found.push(zone);
      occurrences += matches.length;
    }
  }

  return { zones: found, occurrences };
}

/**
 * Cross-check (family C): reconcile deterministic vendor entities against the
 * LLM classifier's vendorRoles. A regex-matched vendor the LLM judges
 * `unrelated`/`unknown` is the confident-but-dumb signal disagreeing with the
 * smart one — down-weight it; a vendor the LLM affirms as affected is boosted.
 * Pure and side-effect free so it is unit-testable and reusable.
 */
export interface VendorRoleVerdict {
  vendor: string;
  role: string;
}

export function crossCheckVendorConfidence(
  vendor: string,
  currentConfidence: number,
  llmRoles: VendorRoleVerdict[]
): number {
  const verdict = llmRoles.find((r) => r.vendor.toLowerCase() === vendor.toLowerCase());
  if (!verdict) return round(currentConfidence);

  if (verdict.role === 'unrelated' || verdict.role === 'unknown') {
    return round(currentConfidence * 0.4);
  }
  // affected / reporting / mitigating / researching / patching all affirm the
  // vendor is genuinely part of the story.
  return round(Math.min(1, currentConfidence + 0.2));
}

/** Vendors the LLM contradicts (present deterministically, judged unrelated). */
export function contradictedVendors(
  deterministicVendors: string[],
  llmRoles: VendorRoleVerdict[]
): string[] {
  return deterministicVendors.filter((vendor) => {
    const verdict = llmRoles.find((r) => r.vendor.toLowerCase() === vendor.toLowerCase());
    return verdict?.role === 'unrelated';
  });
}

function phraseRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'gi');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
