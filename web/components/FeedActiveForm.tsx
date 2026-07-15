'use client';

import type { FormEvent } from 'react';
import { setFeedActiveAction } from '../app/workspace/config/feeds/actions';
import styles from './FeedConfig.module.css';

interface FeedActiveFormProps {
  feedId: string;
  sourceName: string;
  isActive: boolean;
  isLastActive: boolean;
}

export function FeedActiveForm({
  feedId,
  sourceName,
  isActive,
  isLastActive,
}: FeedActiveFormProps) {
  function confirmChange(event: FormEvent<HTMLFormElement>) {
    const message = isActive
      ? isLastActive
        ? `Warning: deactivating ${sourceName} would leave 0 active feeds. The server will reject this change. Continue?`
        : `Deactivate ${sourceName}? It will be skipped on the next ingest run.`
      : `Reactivate ${sourceName}? It will be included on the next ingest run.`;
    if (!window.confirm(message)) event.preventDefault();
  }

  return (
    <form action={setFeedActiveAction} onSubmit={confirmChange} className={styles.activeForm}>
      <input type="hidden" name="feedId" value={feedId} />
      <input type="hidden" name="isActive" value={String(!isActive)} />
      <button className="auth-button secondary" type="submit">
        {isActive ? 'Deactivate' : 'Reactivate'}
      </button>
      {isActive && isLastActive ? (
        <span className={styles.zeroWarning}>Warning: this would leave 0 active feeds.</span>
      ) : null}
    </form>
  );
}
