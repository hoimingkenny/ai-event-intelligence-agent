'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface CveCaseReviewArticleActionProps {
  caseId: string;
  articleId: string;
  currentState: 'mentioned' | 'automated_relevant' | 'human_confirmed' | 'human_rejected' | 'human_uncertain';
}

export function CveCaseReviewArticleAction({ caseId, articleId, currentState }: CveCaseReviewArticleActionProps) {
  const router = useRouter();
  const [verdict, setVerdict] = useState<'human_confirmed' | 'human_rejected' | 'human_uncertain'>(
    currentState === 'human_confirmed' || currentState === 'human_rejected' || currentState === 'human_uncertain'
      ? currentState
      : 'human_confirmed'
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/workspace/api/cases/${caseId}/verdict`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ articleId, verdict }),
      });
      const payload = await res.json().catch(() => ({ ok: false, error: 'invalid_response' }));
      if (!res.ok || !payload.ok) {
        setError(payload.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="form-row">
      <fieldset>
        <legend className="muted">Verdict</legend>
        <label>
          <input
            type="radio"
            name={`verdict-${articleId}`}
            value="human_confirmed"
            checked={verdict === 'human_confirmed'}
            onChange={() => setVerdict('human_confirmed')}
          />
          relevant
        </label>
        <label>
          <input
            type="radio"
            name={`verdict-${articleId}`}
            value="human_rejected"
            checked={verdict === 'human_rejected'}
            onChange={() => setVerdict('human_rejected')}
          />
          not relevant
        </label>
        <label>
          <input
            type="radio"
            name={`verdict-${articleId}`}
            value="human_uncertain"
            checked={verdict === 'human_uncertain'}
            onChange={() => setVerdict('human_uncertain')}
          />
          uncertain
        </label>
      </fieldset>
      <button type="button" onClick={submit} disabled={pending}>
        {pending ? 'Saving…' : 'Save verdict'}
      </button>
      {error ? <p className="form-error">Error: {error}</p> : null}
    </div>
  );
}

export interface CveCaseApproveActionProps {
  caseId: string;
  approved: boolean;
}

export function CveCaseApproveAction({ caseId, approved }: CveCaseApproveActionProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(approved ? 'Case is approved.' : null);

  async function approve() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/workspace/api/cases/${caseId}/approve`, { method: 'POST' });
      const payload = await res.json().catch(() => ({ ok: false, error: 'invalid_response' }));
      if (!res.ok || !payload.ok) {
        setError(payload.error ?? `HTTP ${res.status}`);
        if (payload.blockedBy && payload.blockedBy.length > 0) {
          setError(`Blocked: ${payload.blockedBy.map((b: { reason: string }) => b.reason).join(', ')}`);
        }
        return;
      }
      setMessage('Approved.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="form-actions">
      <button type="button" onClick={approve} disabled={pending || approved}>
        {approved ? 'Approved' : 'Approve case'}
      </button>
      {message ? <p className="muted">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
