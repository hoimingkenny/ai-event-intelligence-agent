import type pg from 'pg';
import { logInfo } from '../utils/logger.js';
import { runScheduledMaintenance } from './scheduled-maintenance.js';
import type { MaintenanceAdapterSet } from './cases.js';

/**
 * Internal scheduler: a self-rescheduling loop that runs the CVE enrichment maintenance
 * tick every `intervalMs` (default 60 minutes — KEV and EPSS only need a daily cadence,
 * but NVD's incremental window benefits from shorter cycles). Uses setTimeout (not
 * setInterval) so a tick that overruns its interval delays the next one rather than
 * stacking it; the advisory lock is the second line of defence across replicas.
 */
export interface MaintenanceSchedulerHandle {
  stop: () => Promise<void>;
}

export interface MaintenanceSchedulerOptions {
  intervalMs: number;
  adapters?: Partial<MaintenanceAdapterSet>;
  runOnStart?: boolean;
  now?: () => Date;
  nvdSafetyBufferMs?: number;
}

export function startCveMaintenanceScheduler(
  pool: pg.Pool,
  options: MaintenanceSchedulerOptions
): MaintenanceSchedulerHandle {
  const { intervalMs, runOnStart = true, ...runOptions } = options;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let inFlight: Promise<unknown> = Promise.resolve();

  const tick = async (): Promise<void> => {
    if (stopped) return;
    inFlight = runScheduledMaintenance(pool, runOptions);
    await inFlight;
    if (!stopped) {
      timer = setTimeout(() => void tick(), intervalMs);
    }
  };

  logInfo({ intervalMs, runOnStart }, 'cve_maintenance_scheduler_started');
  if (runOnStart) {
    void tick();
  } else {
    timer = setTimeout(() => void tick(), intervalMs);
  }

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
      logInfo({}, 'cve_maintenance_scheduler_stopped');
    },
  };
}