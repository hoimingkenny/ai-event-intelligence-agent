import { NextResponse } from 'next/server';
import { getArticlePeek } from '../../../../../../../src/events/event-editorial';
import { getDb } from '../../../../../../lib/db';
import { requireAnalyst } from '../../../../../../lib/require-analyst';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.reason === 'unauthenticated' ? 'Unauthenticated' : 'Forbidden' },
      { status: gate.reason === 'unauthenticated' ? 401 : 403 }
    );
  }

  const { id } = await context.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid article id' }, { status: 400 });
  }

  const peek = await getArticlePeek(getDb(), id);
  if (!peek) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(peek);
}
