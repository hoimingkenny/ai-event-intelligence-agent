import { auth } from '@/auth';

/** Server-side gate for workspace pages and future mutation routes. */
export async function requireAnalyst() {
  const session = await auth();
  if (!session?.user) {
    return { ok: false as const, reason: 'unauthenticated' as const, session: null };
  }
  if (!session.user.isAnalyst) {
    return { ok: false as const, reason: 'forbidden' as const, session };
  }
  return { ok: true as const, session };
}
