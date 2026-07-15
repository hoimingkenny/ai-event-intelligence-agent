import { redirect } from 'next/navigation';
import { listWorkspaceFeeds } from '../../../../../src/workspace/workspace-config';
import { FeedActiveForm } from '../../../../components/FeedActiveForm';
import { FeedCreateForm } from '../../../../components/FeedCreateForm';
import styles from '../../../../components/FeedConfig.module.css';
import { ConfigApplyNote, ConfigNav } from '../../../../components/ConfigNav';
import { SiteHeader } from '../../../../components/SiteHeader';
import { WorkspaceNav } from '../../../../components/WorkspaceNav';
import { getDb } from '../../../../lib/db';
import { formatWhen } from '../../../../lib/format';
import { requireAnalyst } from '../../../../lib/require-analyst';
import { updateFeedAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Feeds · Config · Workspace',
};

type PageProps = {
  searchParams: Promise<{
    created?: string;
    updated?: string;
    activated?: string;
    deactivated?: string;
    error?: string;
    feed?: string;
  }>;
};

const ERROR_MESSAGES: Record<string, string> = {
  duplicate_url: 'A feed with this URL already exists. Enter a unique feed URL.',
  last_active_feed: 'At least one feed must remain active. Reactivate or add another active feed first.',
  feed_not_found: 'That feed no longer exists. Refresh and try again.',
  invalid_input: 'Check the source name, URL, and trust level, then try again.',
};

export default async function WorkspaceConfigFeedsPage({ searchParams }: PageProps) {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated' ? '/login?callbackUrl=/workspace/config/feeds' : '/auth/denied'
    );
  }

  const [feeds, notices] = await Promise.all([listWorkspaceFeeds(getDb()), searchParams]);
  const activeFeedCount = feeds.filter((feed) => feed.isActive).length;
  const formError = notices.error ? ERROR_MESSAGES[notices.error] ?? 'The feed could not be saved.' : undefined;

  return (
    <>
      <SiteHeader active="workspace" />
      <main className="page">
        <p className="page-kicker">Workspace Config</p>
        <h1 className="page-title">Feeds</h1>
        <p className="page-lede">
          Add and maintain RSS sources. Changes persist immediately and affect the next pipeline run.
        </p>

        <WorkspaceNav active="config" />
        <ConfigNav active="feeds" />
        <ConfigApplyNote />

        {notices.created ? <p className="flash">Feed added.</p> : null}
        {notices.updated ? <p className="flash">Feed details saved.</p> : null}
        {notices.activated ? <p className="flash">Feed reactivated.</p> : null}
        {notices.deactivated ? <p className="flash">Feed deactivated.</p> : null}
        {notices.error === 'last_active_feed' ? <p className={styles.errorFlash}>{formError}</p> : null}
        {activeFeedCount === 0 ? (
          <p className={styles.zeroBanner}>
            Warning: there are 0 active feeds. Add or reactivate a feed before the next ingest run.
          </p>
        ) : null}

        <section className={`workspace-section ${styles.addSection}`}>
          <h2 className="section-title">Add feed</h2>
          <p className="meta">Workspace-created sources are RSS only. Saving does not start ingest.</p>
          <div className="detail-panel">
            <FeedCreateForm
              activeFeedCount={activeFeedCount}
              error={notices.feed === 'new' ? formError : undefined}
            />
          </div>
        </section>

        <section className="workspace-section">
          <div className="workspace-toolbar">
            <div>
              <h2 className="section-title">Configured feeds</h2>
              <p className="meta">
                {activeFeedCount} active of {feeds.length} configured
              </p>
            </div>
          </div>

          {feeds.length === 0 ? (
            <div className="empty-state">
              <h2>No feeds yet</h2>
              <p>Add an active RSS feed above to begin configuring ingestion.</p>
            </div>
          ) : (
            <div className={styles.list}>
              {feeds.map((feed) => (
                <article
                  key={feed.id}
                  className={`${styles.card}${feed.isActive ? '' : ` ${styles.inactive}`}`}
                >
                  <form action={updateFeedAction} className="edit-form">
                    <input type="hidden" name="feedId" value={feed.id} />
                    <div className="field-row">
                      <label className="field">
                        <span>Source name</span>
                        <input name="sourceName" defaultValue={feed.sourceName} required />
                      </label>
                      <label className="field">
                        <span>Feed URL</span>
                        <input
                          name="feedUrl"
                          type="url"
                          inputMode="url"
                          defaultValue={feed.feedUrl}
                          required
                        />
                      </label>
                    </div>
                    <div className={styles.formMeta}>
                      <label className="field">
                        <span>Trust level</span>
                        <select name="trustLevel" defaultValue={feed.trustLevel}>
                          <option value="low">low</option>
                          <option value="medium">medium</option>
                          <option value="high">high</option>
                        </select>
                      </label>
                      <div className={styles.readonly}>
                        <span>ID</span>
                        <strong>{feed.id}</strong>
                      </div>
                      <div className={styles.readonly}>
                        <span>Source type</span>
                        <strong>{feed.sourceType ?? '—'}</strong>
                      </div>
                      <div className={styles.readonly}>
                        <span>Last fetched</span>
                        <strong>{formatWhen(feed.lastFetchedAt)}</strong>
                      </div>
                    </div>
                    {notices.feed === feed.id && notices.error !== 'last_active_feed' ? (
                      <p className={styles.formError}>{formError}</p>
                    ) : null}
                    <div className="form-actions">
                      <button className="auth-button" type="submit">
                        Save details
                      </button>
                      <span
                        className={`${styles.status}${feed.isActive ? ` ${styles.statusActive}` : ''}`}
                      >
                        {feed.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </form>
                  <FeedActiveForm
                    feedId={feed.id}
                    sourceName={feed.sourceName}
                    isActive={feed.isActive}
                    isLastActive={feed.isActive && activeFeedCount === 1}
                  />
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
