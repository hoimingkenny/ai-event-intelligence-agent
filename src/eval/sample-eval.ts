import type { SecurityEvent } from '../types/domain.js';

interface EvalResult {
  precisionProxy: number;
  duplicateLeakageProxy: number;
  highSeverityCount: number;
}

export function evaluateEvents(events: SecurityEvent[]): EvalResult {
  const useful = events.filter((e) => e.vendors.length > 0 && e.eventType !== 'irrelevant').length;
  const duplicateLike = events.length - new Set(events.map((e) => e.canonicalTitle)).size;
  const highSeverityCount = events.filter((e) => ['high', 'critical'].includes(e.severity)).length;

  return {
    precisionProxy: events.length === 0 ? 0 : useful / events.length,
    duplicateLeakageProxy: events.length === 0 ? 0 : duplicateLike / events.length,
    highSeverityCount,
  };
}

console.log('Sample evaluator loaded. Use this against stored event outputs in later iterations.');
