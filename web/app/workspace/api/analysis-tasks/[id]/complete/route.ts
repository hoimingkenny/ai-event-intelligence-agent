import { NextResponse } from 'next/server';
import { applyAnalysisTaskAction } from '../../../../../../../src/workspace/analysis-task-actions';
import { getDb } from '../../../../../../lib/db';
import { requireAnalyst } from '../../../../../../lib/require-analyst';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.reason },
      { status: gate.reason === 'unauthenticated' ? 401 : 403 }
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: 'missing_task_id' }, { status: 400 });
  }

  let payload: { result?: Record<string, unknown> } = {};
  try {
    payload = (await request.json()) as { result?: Record<string, unknown> };
  } catch {
    payload = {};
  }

  const outcome = await applyAnalysisTaskAction(getDb(), {
    taskId: id,
    action: 'complete',
    result: payload.result,
  });

  if (!outcome.ok) {
    return NextResponse.json({ ok: false, error: outcome.reason ?? 'unknown' }, { status: 400 });
  }

  return NextResponse.json({ ok: true, task: outcome.task });
}