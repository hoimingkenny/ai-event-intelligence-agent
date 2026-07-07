import type {
  CheapFilterEvaluationResult,
  FailureBucket,
  SuggestedFix,
} from '../types/cheap-filter-eval.types.js';

export function inferFailureBucket(result: Pick<CheapFilterEvaluationResult, 'sample' | 'decision' | 'score' | 'blockingReasons' | 'matchedSignals'>): FailureBucket {
  if (result.matchedSignals.negativeKeywords.length > 0 || result.blockingReasons.includes('cheap_filter_negative_business_context')) {
    return 'negative_keyword_overpowered';
  }
  if (result.sample.expectedSignals.monitoredProductPresent && result.matchedSignals.products.length === 0) {
    return 'missing_product_alias';
  }
  if (result.sample.expectedSignals.monitoredVendorPresent && result.matchedSignals.vendors.length === 0) {
    return 'missing_vendor_alias';
  }
  if (result.sample.expectedSignals.criticalSignalPresent && result.matchedSignals.criticalCyberKeywords.length === 0) {
    return 'missing_critical_phrase';
  }
  if (result.sample.expectedSignals.mediumSignalPresent && result.matchedSignals.mediumCyberKeywords.length === 0) {
    return 'missing_keyword';
  }
  if ((result.sample.rssSummary?.trim().length ?? 0) < 40) {
    return 'rss_summary_too_short';
  }
  if (result.sample.sourceTier !== result.matchedSignals.sourceTier) {
    return 'source_metadata_missing';
  }
  if (result.score > 0 && result.score < 15) {
    return 'threshold_too_high';
  }
  if (result.decision === 'DROP' && result.sample.humanReason.toLowerCase().includes('body')) {
    return 'signal_only_in_body';
  }
  return 'unknown';
}

export function suggestFix(bucket: FailureBucket, result: Pick<CheapFilterEvaluationResult, 'sample' | 'score' | 'blockingReasons'>): SuggestedFix {
  if (bucket === 'missing_product_alias') return 'add_missing_product_alias';
  if (bucket === 'missing_vendor_alias') return 'add_missing_vendor_alias';
  if (bucket === 'negative_keyword_overpowered') return 'reduce_negative_keyword_penalty';
  if (bucket === 'missing_critical_phrase') return 'move_phrase_to_critical_keyword_list';
  if (bucket === 'threshold_too_high' || (result.sample.sourceTier === 'security_media' && result.score < 15)) {
    return 'increase_security_media_boost_or_lower_maybe_threshold';
  }
  if (bucket === 'rss_summary_too_short' || bucket === 'signal_only_in_body') {
    return 'consider_source_tier_boost_or_shadow_sampling';
  }
  return 'manual_review_required';
}
