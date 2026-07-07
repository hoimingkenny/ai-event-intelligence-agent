import { createHash } from 'node:crypto';
import { detectCategorizedCyberKeywords } from '../../src/detection/cyber-keyword-classifier.js';
import { extractCves } from '../../src/detection/cve-extractor.js';
import { detectVendorsFromInventory } from '../../src/detection/vendor-detector.js';
import { monitoredVendors } from '../../src/storage/vendorInventory.js';
import type {
  ExpectedMinimumDecision,
  ExpectedSignals,
  HumanLabel,
} from '../types/cheap-filter-eval.types.js';

/**
 * The minimum acceptable filter decision is fully determined by the human label:
 * anything a human calls critical must be KEPT, relevant/weak-relevant items must
 * at least survive as MAYBE_KEEP, and irrelevant items should be DROPPED.
 */
export function deriveExpectedMinimumDecision(label: HumanLabel): ExpectedMinimumDecision {
  if (label === 'CRITICAL_RELEVANT') return 'KEEP';
  if (label === 'IRRELEVANT') return 'DROP';
  return 'MAYBE_KEEP';
}

/**
 * Returns an error message when an explicitly provided expectedMinimumDecision
 * contradicts the human label, null otherwise. Stricter-than-derived values
 * (e.g. KEEP for a RELEVANT sample) are allowed.
 */
export function checkLabelDecisionConsistency(
  label: HumanLabel,
  provided: ExpectedMinimumDecision
): string | null {
  if (label === 'IRRELEVANT' && provided !== 'DROP') {
    return `humanLabel IRRELEVANT requires expectedMinimumDecision DROP, got ${provided}`;
  }
  if (label !== 'IRRELEVANT' && provided === 'DROP') {
    return `humanLabel ${label} cannot have expectedMinimumDecision DROP`;
  }
  if (label === 'CRITICAL_RELEVANT' && provided !== 'KEEP') {
    return `humanLabel CRITICAL_RELEVANT requires expectedMinimumDecision KEEP, got ${provided}`;
  }
  return null;
}

export interface DeriveExpectedSignalsInput {
  title: string;
  rssSummary: string | null;
  rssCategories: string[];
  humanReason?: string | null;
}

/**
 * Derives expected signals by scanning the sample text (plus the free-text human
 * reason, which often names the vendor/product even when RSS metadata does not)
 * against the monitored-vendor inventory, CVE pattern, and keyword lists.
 *
 * Note: derived signals are a convenience baseline. When a failure analysis needs
 * to distinguish "alias list is missing an entry" from "signal genuinely absent",
 * a human can still assert expectedSignals explicitly in the dataset record.
 */
export function deriveExpectedSignals(input: DeriveExpectedSignalsInput): ExpectedSignals {
  const text = [input.title, input.rssSummary, ...(input.rssCategories ?? []), input.humanReason]
    .filter(Boolean)
    .join('\n');
  const keywords = detectCategorizedCyberKeywords(text);
  const cves = extractCves(text);
  const vendors = detectVendorsFromInventory(text, monitoredVendors);

  return {
    monitoredVendorPresent: vendors.vendors.length > 0,
    monitoredProductPresent: vendors.products.length > 0,
    cvePresent: cves.length > 0,
    criticalSignalPresent: keywords.critical.length > 0,
    mediumSignalPresent: keywords.medium.length > 0,
  };
}

/** Deterministic sample id from the article URL, e.g. `cf-3fa9c1d2`. */
export function deriveSampleId(url: string): string {
  return `cf-${createHash('sha1').update(url).digest('hex').slice(0, 8)}`;
}
