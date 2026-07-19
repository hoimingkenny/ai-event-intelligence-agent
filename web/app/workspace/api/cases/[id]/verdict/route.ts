import { NextResponse } from 'next/server';
import { recordHumanVerdict } from '../../../../../../../src/cve/review';
import { getDb } from '../../../../../../lib/db';
import { requireAnalyst } from '../../../../../../lib/require-analyst';

export const dynamic = 'force-dynamic';

const VALID_VERDICTS = new Set(['human_confirmed', 'human_rejected', 'human_uncertain']);

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

  let body: { articleId?: string; verdict?: string; reason?: string | null } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (!body.articleId || !body.verdict || !VALID_VERDICTS.has(body.verdict)) {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const actor = gate.session.user.githubLogin || gate.session.user.name || 'analyst';
  const outcome = await recordHumanVerdict(getDb(), {
    caseId,
    articleId: body.articleId,
    verdict: body.verdict as 'human_confirmed' | 'human_rejected' | 'human_uncertain',
    actor,
    reason: body.reason ?? null,
  });

  if (!outcome.ok) {
    return NextResponse.json({ ok: false, error: outcome.reason ?? 'unknown' }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    fromState: outcome.fromState,
    toState: outcome.toState,
    caseArticleId: outcome.caseArticleId,
    autoRevertedCaseId: outcome.autoRevertedCaseId ?? null,
  });
}
