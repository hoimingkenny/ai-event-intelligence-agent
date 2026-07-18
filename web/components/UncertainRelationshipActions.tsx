'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface PromoteUncertainActionProps {
  articleId: string;
  cveId: string;
}

export function PromoteUncertainAction({ articleId, cveId }: PromoteUncertainActionProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function promote() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/workspace/api/uncertain-relationships/promote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ articleId, cveId }),
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
    <div className="form-actions">
      <button type="button" onClick={promote} disabled={pending}>
        {pending ? 'Promoting…' : 'Promote to relevant'}
      </button>
      {error ? <p className="form-error">Error: {error}</p> : null}
    </div>
  );
}
