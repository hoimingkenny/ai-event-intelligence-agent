export class MetricsCollector {
  private readonly counters = new Map<string, number>();

  increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.counters.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}

export const metrics = new MetricsCollector();

export function recordStageResult(
  stageName: string,
  result: object,
  collector: MetricsCollector = metrics
): void {
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      collector.increment(`${stageName}_${key}_total`, value);
    }
  }
}
