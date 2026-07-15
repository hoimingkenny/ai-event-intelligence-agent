'use client';

import type { FormEvent } from 'react';
import { createFeedAction } from '../app/workspace/config/feeds/actions';
import styles from './FeedConfig.module.css';

interface FeedCreateFormProps {
  activeFeedCount: number;
  error?: string;
}

export function FeedCreateForm({ activeFeedCount, error }: FeedCreateFormProps) {
  function warnIfNoActiveFeeds(event: FormEvent<HTMLFormElement>) {
    if (activeFeedCount > 0) return;
    const formData = new FormData(event.currentTarget);
    if (formData.get('isActive') === 'false') {
      const proceed = window.confirm(
        'Warning: saving this feed as inactive would leave 0 active feeds. The server will reject this change. Continue?'
      );
      if (!proceed) event.preventDefault();
    }
  }

  return (
    <form action={createFeedAction} onSubmit={warnIfNoActiveFeeds} className="edit-form">
      <div className="field-row">
        <label className="field">
          <span>Source name</span>
          <input name="sourceName" required />
        </label>
        <label className="field">
          <span>Feed URL</span>
          <input name="feedUrl" type="url" inputMode="url" required />
        </label>
      </div>
      <div className={styles.formMeta}>
        <label className="field">
          <span>Trust level</span>
          <select name="trustLevel" defaultValue="medium">
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <label className="field">
          <span>Active</span>
          <select name="isActive" defaultValue="true">
            <option value="true">yes</option>
            <option value="false">no</option>
          </select>
        </label>
        <div className={styles.readonly}>
          <span>Source type</span>
          <strong>rss</strong>
        </div>
      </div>
      {error ? <p className={styles.formError}>{error}</p> : null}
      <div className="form-actions">
        <button className="auth-button" type="submit">
          Add feed
        </button>
      </div>
    </form>
  );
}
