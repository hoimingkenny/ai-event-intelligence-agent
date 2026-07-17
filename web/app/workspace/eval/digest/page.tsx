import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DigestEvalNav } from '../../../../components/DigestEvalNav';
import { SiteHeader } from '../../../../components/SiteHeader';
import { WorkspaceNav } from '../../../../components/WorkspaceNav';
import { getDb } from '../../../../lib/db';
import { formatWhen } from '../../../../lib/format';
import { requireAnalyst } from '../../../../lib/require-analyst';
import { getDigestEvalQueue } from '../../../../../src/workspace/workspace-digest-eval-read';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Digest eval · Workspace',
};

export default async function DigestEvalQueuePage() {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated'
        ? '/login?callbackUrl=/workspace/eval/digest'
        : '/auth/denied'
    );
  }

  const queue = await getDigestEvalQueue(getDb());

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <p className="page-kicker">Analyst workspace</p>
        <h1 className="page-title">Digest eval</h1>
        <p className="page-lede">
          Label ~{queue.targetCount} articles with digest gold for prompt quality scoring. Progress:{' '}
          <strong>
            {queue.labeledCount} / {queue.targetCount}
          </strong>
          {queue.labeledCount < 40 ? (
            <span className="meta"> · Soft gates activate at 40 labels</span>
          ) : null}
        </p>

        <WorkspaceNav active="digest-eval" />
        <DigestEvalNav active="queue" />

        <div className="detail-panel" style={{ marginTop: '1rem' }}>
          <h2 className="page-kicker">To label ({queue.candidates.length})</h2>
          {queue.candidates.length === 0 ? (
            <p className="meta">No DIGESTED articles without gold right now.</p>
          ) : (
            <ul className="triage-grid">
              {queue.candidates.map((article) => (
                <li key={article.id}>
                  <time
                    className="triage-mono"
                    dateTime={
                      article.publishedAt ? new Date(article.publishedAt).toISOString() : undefined
                    }
                  >
                    {formatWhen(article.publishedAt)}
                  </time>
                  <div className="triage-title-row">
                    <Link className="triage-title" href={`/workspace/articles/${article.id}`}>
                      <span className="triage-mono">#{article.id}</span>{' '}
                      {article.title || article.canonicalUrl || 'Untitled article'}
                    </Link>
                    {article.digestRelated === true ? (
                      <span className="chip">digest: related</span>
                    ) : article.digestRelated === false ? (
                      <span className="chip">digest: unrelated</span>
                    ) : (
                      <span className="chip">digest: —</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h2 className="page-kicker" style={{ marginTop: '1.5rem' }}>
            Labeled ({queue.labeled.length})
          </h2>
          {queue.labeled.length === 0 ? (
            <p className="meta">No digest gold labels yet.</p>
          ) : (
            <ul className="triage-grid">
              {queue.labeled.map((article) => (
                <li key={article.id}>
                  <time
                    className="triage-mono"
                    dateTime={new Date(article.labeledAt).toISOString()}
                  >
                    {formatWhen(article.labeledAt)}
                  </time>
                  <div className="triage-title-row">
                    <Link className="triage-title" href={`/workspace/articles/${article.id}`}>
                      <span className="triage-mono">#{article.id}</span>{' '}
                      {article.title || article.canonicalUrl || 'Untitled article'}
                    </Link>
                    <span className="chip">
                      gold: {article.relatedToMonitoredInventory ? 'related' : 'unrelated'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
