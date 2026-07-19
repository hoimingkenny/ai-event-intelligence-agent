import { AnalysisTaskRepository, type AnalysisTaskRecord } from '../db/repositories/analysis-task.repository.js';
import type { Queryable } from '../db/repositories/types.js';

export type AnalysisTaskAction = 'retry' | 'complete';

export interface AnalysisTaskActionResult {
  ok: boolean;
  task: AnalysisTaskRecord | null;
  reason?:
    | 'task_not_found'
    | 'task_not_needs_attention'
    | 'invalid_payload'
    | 'complete_requires_result';
}

export interface AnalysisTaskActionInput {
  taskId: string;
  action: AnalysisTaskAction;
  result?: Record<string, unknown>;
}

export async function applyAnalysisTaskAction(
  db: Queryable,
  input: AnalysisTaskActionInput
): Promise<AnalysisTaskActionResult> {
  const repo = new AnalysisTaskRepository(db);
  const task = await repo.findById(input.taskId);
  if (!task) {
    return { ok: false, task: null, reason: 'task_not_found' };
  }
  if (task.status !== 'needs_attention') {
    return { ok: false, task, reason: 'task_not_needs_attention' };
  }

  if (input.action === 'retry') {
    await repo.retry(task.id);
    return { ok: true, task: await repo.findById(task.id) };
  }

  if (!input.result || typeof input.result !== 'object') {
    return { ok: false, task, reason: 'invalid_payload' };
  }

  await repo.completeManually(task.id, input.result);
  return { ok: true, task: await repo.findById(task.id) };
}