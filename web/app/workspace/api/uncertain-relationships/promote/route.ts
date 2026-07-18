import { NextResponse } from 'next/server';
import { promoteUncertainRelationship } from '../../../../../../src/cve/review';
import { getDb } from '../../../../../lib/db';
import { requireAnalyst } from '../../../../../lib/require-analyst';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.reason },
      { status: gate.reason === 'unauthenticated' ? 401 : 403 }
    );
  }

  let body: { articleId?: string; cveId?: string; reason?: string | null } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (!body.articleId || !body.cveId) {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const actor = gate.session.user.githubLogin || gate.session.user.name || 'analyst';
  const outcome = await promoteUncertainRelationship(getDb(), {
    articleId: body.articleId,
    cveId: body.cveId,
    actor,
    reason: body.reason ?? null,
  });

  if (!outcome.ok) {
    return NextResponse.json({ ok: false, error: outcome.reason ?? 'unknown' }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    caseId: outcome.caseId ?? null,
    caseArticleId: outcome.caseArticleId ?? null,
  });
}
