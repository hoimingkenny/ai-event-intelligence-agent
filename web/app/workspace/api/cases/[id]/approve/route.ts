import { NextResponse } from 'next/server';
import { approveCase, checkApprovalRequirements } from '../../../../../../../src/cve/review';
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

  const { id: caseId } = await params;
  if (!caseId) {
    return NextResponse.json({ ok: false, error: 'missing_case_id' }, { status: 400 });
  }

  let body: { reason?: string | null } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const actor = gate.session.user.githubLogin || gate.session.user.name || 'analyst';
  const result = await approveCase(getDb(), { caseId, actor, reason: body.reason ?? null });
  if (!result.ok) {
    const requirements = await checkApprovalRequirements(getDb(), caseId);
    return NextResponse.json(
      {
        ok: false,
        error: result.reason,
        requirements,
        blockedBy: result.blockedBy ?? [],
      },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, case: result.caseRecord });
}
