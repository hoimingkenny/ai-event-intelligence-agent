'use client';

import Link from 'next/link';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { useCallback, useEffect, useId, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import type { ArticlePeek } from '../../src/events/event-editorial';

type Props = {
  articleId: string;
  articleTitle: string;
};

export function ArticlePeekButton({ articleId, articleTitle }: Props) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [peek, setPeek] = useState<ArticlePeek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setMounted(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  function openPeek() {
    setOpen(true);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/workspace/api/articles/${articleId}/peek`);
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setPeek(null);
          setError(body?.error || `Failed to load peek (${response.status})`);
          return;
        }
        const data = (await response.json()) as ArticlePeek;
        setPeek(data);
      } catch {
        setPeek(null);
        setError('Failed to load Article peek.');
      }
    });
  }

  const drawer =
    open && mounted
      ? createPortal(
          <div className="article-peek-root" role="presentation">
            <button
              type="button"
              className="article-peek-backdrop"
              aria-label="Close peek"
              onClick={close}
            />
            <aside
              className="article-peek-drawer"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <header className="article-peek-header">
                <div>
                  <p className="page-kicker" style={{ marginBottom: '0.25rem' }}>
                    Article peek
                  </p>
                  <h2 id={titleId} className="article-peek-title">
                    {peek?.title || articleTitle}
                  </h2>
                </div>
                <button
                  type="button"
                  className="article-peek-close"
                  onClick={close}
                  aria-label="Close"
                >
                  <X size={18} weight="bold" aria-hidden />
                </button>
              </header>

              <div className="article-peek-body">
                {pending && !peek && !error ? <p className="meta">Loading…</p> : null}
                {error ? <p className="meta">{error}</p> : null}

                {peek ? (
                  <>
                    <p className="meta">{peek.sourceName || 'Unknown source'}</p>
                    <p className="meta" style={{ marginTop: '0.35rem' }}>
                      <Link href={peek.workspaceArticlePath} onClick={close}>
                        Open full Workspace article
                      </Link>
                    </p>

                    <h3 className="article-peek-section">Article assessment</h3>
                    <h4 className="page-kicker" style={{ marginTop: '0.35rem', marginBottom: '0.5rem' }}>
                      AI short summary
                    </h4>
                    {peek.assessmentSummary ? (
                      peek.assessmentSummary.status === 'completed' &&
                      peek.assessmentSummary.summary ? (
                        <pre className="workspace-article-body">
                          {peek.assessmentSummary.summary}
                        </pre>
                      ) : (
                        <p className="meta">
                          Status: {peek.assessmentSummary.status} · attempts:{' '}
                          {peek.assessmentSummary.attempts}
                          {peek.assessmentSummary.lastError
                            ? ` · ${peek.assessmentSummary.lastError}`
                            : ''}
                        </p>
                      )
                    ) : (
                      <p className="meta">Not scheduled.</p>
                    )}
                  </>
                ) : null}
              </div>
            </aside>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        className="triage-icon triage-icon-peek"
        title={`Peek: ${articleTitle}`}
        aria-label={`Open Article peek for ${articleTitle}`}
        onClick={openPeek}
      >
        <MagnifyingGlass size={16} weight="duotone" aria-hidden />
      </button>
      {drawer}
    </>
  );
}
