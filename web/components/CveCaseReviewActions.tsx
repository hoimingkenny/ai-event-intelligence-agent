'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

type HumanVerdict = 'human_confirmed' | 'human_rejected' | 'human_uncertain';

export interface CveCaseReviewArticleActionProps {
  caseId: string;
  articleId: string;
  currentState:
    | 'mentioned'
    | 'automated_relevant'
    | 'human_confirmed'
    | 'human_rejected'
    | 'human_uncertain';
}

const VERDICTS: Array<{ value: HumanVerdict; label: string; title: string }> = [
  { value: 'human_confirmed', label: 'Confirm', title: 'Human confirmed — relevant evidence' },
  { value: 'human_rejected', label: 'Reject', title: 'Human rejected — not relevant' },
  { value: 'human_uncertain', label: 'Uncertain', title: 'Human marked uncertain' },
];

function initialVerdict(currentState: CveCaseReviewArticleActionProps['currentState']): HumanVerdict {
  if (
    currentState === 'human_confirmed' ||
    currentState === 'human_rejected' ||
    currentState === 'human_uncertain'
  ) {
    return currentState;
  }
  return 'human_confirmed';
}

export function CveCaseReviewArticleAction({
  caseId,
  articleId,
  currentState,
}: CveCaseReviewArticleActionProps) {
  const router = useRouter();
  const [verdict, setVerdict] = useState<HumanVerdict>(() => initialVerdict(currentState));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = currentState.startsWith('human_') && verdict === currentState;
  const dirty = !saved;

  useEffect(() => {
    setVerdict(initialVerdict(currentState));
  }, [currentState]);

  const SAVING_MIN_MS = 900;

  async function submit() {
    if (pending || !dirty) return;
    setPending(true);
    setError(null);
    const startedAt = Date.now();
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
      const elapsed = Date.now() - startedAt;
      const remaining = SAVING_MIN_MS - elapsed;
      if (remaining > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remaining));
      }
      setPending(false);
    }
  }

  return (
    <div className="verdict-control">
      <div className="verdict-segment" role="radiogroup" aria-label="Verdict">
        {VERDICTS.map((option) => {
          const selected = verdict === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              title={option.title}
              className={selected ? 'verdict-option selected' : 'verdict-option'}
              onClick={() => setVerdict(option.value)}
              disabled={pending}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={saved && !pending ? 'verdict-save verdict-save-done' : 'verdict-save'}
        onClick={submit}
        disabled={pending || !dirty}
      >
        {pending ? 'Saving…' : saved ? 'Saved' : 'Save'}
      </button>
      {error ? <p className="form-error">Error: {error}</p> : null}
    </div>
  );
}

export interface CveCaseApproveActionProps {
  caseId: string;
  approved: boolean;
}

type ToastTone = 'success' | 'error';

function FloatingToast({
  tone,
  message,
  onDismiss,
}: {
  tone: ToastTone;
  message: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  return createPortal(
    <div className="workspace-toast-host" aria-live="polite">
      <div
        className={`workspace-toast workspace-toast-${tone}`}
        role={tone === 'error' ? 'alert' : 'status'}
      >
        <p className="workspace-toast-message">{message}</p>
        <button
          type="button"
          className="workspace-toast-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>,
    document.body
  );
}

/** Pull a published case off the public catalogue. Next CVSS refresh may republish if still ≥ 9. */
export function CveCaseUnpublishAction({ caseId, approved }: CveCaseApproveActionProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!approved) {
    return null;
  }

  async function unpublish() {
    setPending(true);
    setToast(null);
    try {
      const res = await fetch(`/workspace/api/cases/${caseId}/unpublish`, { method: 'POST' });
      const payload = await res.json().catch(() => ({ ok: false, error: 'invalid_response' }));
      if (!res.ok || !payload.ok) {
        setToast({
          tone: 'error',
          message: payload.error ?? `Could not pull back (HTTP ${res.status}).`,
        });
        return;
      }
      setToast({
        tone: 'success',
        message: 'Pulled back from public. A later CVSS refresh may republish if score is still ≥ 9.',
      });
      router.refresh();
    } catch (err) {
      setToast({
        tone: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="case-approve-action">
        <button
          type="button"
          className="case-approve-button"
          onClick={unpublish}
          disabled={pending}
        >
          {pending ? 'Pulling back…' : 'Pull back from public'}
        </button>
      </div>
      {mounted && toast ? (
        <FloatingToast
          tone={toast.tone}
          message={toast.message}
          onDismiss={() => setToast(null)}
        />
      ) : null}
    </>
  );
}

/** @deprecated Use CveCaseUnpublishAction — cases auto-publish on CVSS ≥ 9 or KEV listed. */
export const CveCaseApproveAction = CveCaseUnpublishAction;
