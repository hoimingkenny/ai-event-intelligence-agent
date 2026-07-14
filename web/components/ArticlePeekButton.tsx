'use client';

import Link from 'next/link';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { useCallback, useEffect, useId, useState, useTransition } from 'react';
import type { ArticlePeek } from '../../src/events/event-editorial';

type Props = {
  articleId: string;
  articleTitle: string;
};

function formatSignalList(values: string[]): string {
  return values.length > 0 ? values.join(', ') : '—';
}

export function ArticlePeekButton({ articleId, articleTitle }: Props) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState<ArticlePeek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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

      {open ? (
        <div className="article-peek-root" role="presentation">
          <button type="button" className="article-peek-backdrop" aria-label="Close peek" onClick={close} />
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
              <button type="button" className="article-peek-close" onClick={close} aria-label="Close">
                <X size={18} weight="bold" aria-hidden />
              </button>
            </header>

            <div className="article-peek-body">
              {pending && !peek && !error ? <p className="meta">Loading…</p> : null}
              {error ? <p className="meta">{error}</p> : null}

              {peek ? (
                <>
                  <p className="meta">
                    {peek.sourceName || 'Unknown source'}
                    {peek.bodySource === 'cleanText'
                      ? ' · extracted text'
                      : peek.bodySource === 'rssSummary'
                        ? ' · RSS summary'
                        : ''}
                    {peek.truncated ? ' · truncated' : ''}
                  </p>

                  <h3 className="article-peek-section">Excerpt</h3>
                  {peek.excerpt ? (
                    <pre className="workspace-article-body">{peek.excerpt}</pre>
                  ) : (
                    <p className="meta">No excerpt available.</p>
                  )}
                  <p className="meta" style={{ marginTop: '0.5rem' }}>
                    <Link href={peek.workspaceArticlePath} onClick={close}>
                      Open full Workspace article
                    </Link>
                  </p>

                  <h3 className="article-peek-section">Filter signals</h3>
                  <dl className="kv-grid">
                    <div>
                      <dt>Vendors</dt>
                      <dd>{formatSignalList(peek.filterSignals.vendors)}</dd>
                    </div>
                    <div>
                      <dt>Products</dt>
                      <dd>{formatSignalList(peek.filterSignals.products)}</dd>
                    </div>
                    <div>
                      <dt>CVEs</dt>
                      <dd>{formatSignalList(peek.filterSignals.cves)}</dd>
                    </div>
                    <div>
                      <dt>Critical keywords</dt>
                      <dd>{formatSignalList(peek.filterSignals.criticalKeywords)}</dd>
                    </div>
                  </dl>

                  <h3 className="article-peek-section">Extracted entities</h3>
                  {peek.extractedEntities.length === 0 ? (
                    <p className="meta">No entities detected.</p>
                  ) : (
                    <ul className="workspace-entity-list">
                      {peek.extractedEntities.map((entity) => (
                        <li
                          key={`${entity.entityType}:${entity.entityValue}:${entity.role ?? ''}`}
                          className="workspace-entity-item"
                        >
                          <span className="workspace-entity-type">{entity.entityType}</span>
                          <span className="workspace-entity-value">
                            {entity.entityValue}
                            {entity.role ? ` (${entity.role})` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <h3 className="article-peek-section">LLM digest</h3>
                  {peek.llmDigest ? (
                    <pre className="workspace-article-body">{peek.llmDigest}</pre>
                  ) : (
                    <p className="meta">{peek.llmEmptyReason || 'No LLM classification yet.'}</p>
                  )}
                </>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
