import type pg from 'pg';
import { logInfo } from '../utils/logger.js';
import { runScheduledPipeline } from './scheduled-run.js';
import type { PipelineRunOptions } from './runner.js';

/**
 * Internal scheduler: a self-rescheduling loop that runs the pipeline every
 * `intervalMs`. Uses setTimeout (not setInterval) so the next tick is measured
 * from the *end* of the previous run — a run that overruns the interval delays
 * the next tick rather than overlapping it (the advisory lock is the second
 * line of defence, especially across replicas).
 *
 * Returns a stop() for graceful shutdown; the in-flight run is awaited before
 * the loop ends so SIGTERM never kills a run mid-flight.
 */
export interface SchedulerHandle {
  stop: () => Promise<void>;
}

export function startPipelineScheduler(
  pool: pg.Pool,
  options: PipelineRunOptions & { intervalMs: number; runOnStart?: boolean }
): SchedulerHandle {
  const { intervalMs, runOnStart = true, ...runOptions } = options;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let inFlight: Promise<unknown> = Promise.resolve();

  const tick = async (): Promise<void> => {
    if (stopped) return;
    inFlight = runScheduledPipeline(pool, runOptions);
    await inFlight;
    if (!stopped) {
      timer = setTimeout(() => void tick(), intervalMs);
    }
  };

  logInfo({ intervalMs, runOnStart }, 'pipeline_scheduler_started');
  if (runOnStart) {
    void tick();
  } else {
    timer = setTimeout(() => void tick(), intervalMs);
  }

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight; // let any in-flight run finish
      logInfo({}, 'pipeline_scheduler_stopped');
    },
  };
}
