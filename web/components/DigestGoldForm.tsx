'use client';

import { useState, useTransition } from 'react';
import type { DigestGoldFields } from '../../src/evaluation/digest/digest-gold-types';
import type { VendorProduct } from '../../src/types/domain';
import {
  proposeDigestGoldAssistAction,
  saveDigestGoldAction,
} from '../app/workspace/articles/[id]/digest-gold-actions';

export interface DigestGoldFormProps {
  articleId: string;
  inventory: VendorProduct[];
  initial: DigestGoldFields;
  assistError?: string;
  saveError?: string;
  saved?: boolean;
}

function formatCveInput(cves: string[]): string {
  return cves.join('\n');
}

export function DigestGoldForm({
  articleId,
  inventory,
  initial,
  assistError,
  saveError,
  saved,
}: DigestGoldFormProps) {
  const [related, setRelated] = useState(initial.relatedToMonitoredInventory);
  const [matchedVendors, setMatchedVendors] = useState<string[]>(initial.matchedVendors);
  const [matchedProducts, setMatchedProducts] = useState<string[]>(initial.matchedProducts);
  const [cves, setCves] = useState(formatCveInput(initial.cves));
  const [humanReason, setHumanReason] = useState(initial.humanReason ?? '');
  const [assistMessage, setAssistMessage] = useState<string | null>(null);
  const [localAssistError, setLocalAssistError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const vendorNames = Array.from(new Set(inventory.map((item) => item.vendor))).sort();
  const productNames = Array.from(new Set(inventory.map((item) => item.product))).sort();

  function toggleValue(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function handleAssist() {
    setLocalAssistError(null);
    setAssistMessage(null);
    startTransition(async () => {
      const result = await proposeDigestGoldAssistAction(articleId);
      if ('error' in result) {
        setLocalAssistError(result.error);
        return;
      }
      setRelated(result.relatedToMonitoredInventory);
      setMatchedVendors(result.matchedVendors);
      setMatchedProducts(result.matchedProducts);
      setCves(formatCveInput(result.cves));
      setAssistMessage(result.reasoning);
    });
  }

  return (
    <div className="digest-gold-form">
      <fieldset className="field">
        <legend>Related to monitored inventory?</legend>
        <label>
          <input
            type="radio"
            name="relatedToMonitoredInventory"
            value="true"
            checked={related}
            onChange={() => setRelated(true)}
          />{' '}
          Yes
        </label>
        <label style={{ marginLeft: '1rem' }}>
          <input
            type="radio"
            name="relatedToMonitoredInventory"
            value="false"
            checked={!related}
            onChange={() => {
              setRelated(false);
              setMatchedVendors([]);
              setMatchedProducts([]);
            }}
          />{' '}
          No
        </label>
      </fieldset>

      {related ? (
        <>
          <fieldset className="field" style={{ marginTop: '0.75rem' }}>
            <legend>Matched vendors</legend>
            {vendorNames.map((vendor) => (
              <label key={vendor} className="digest-gold-check">
                <input
                  type="checkbox"
                  checked={matchedVendors.includes(vendor)}
                  onChange={() => setMatchedVendors((prev) => toggleValue(prev, vendor))}
                />{' '}
                {vendor}
              </label>
            ))}
          </fieldset>

          <fieldset className="field" style={{ marginTop: '0.75rem' }}>
            <legend>Matched products</legend>
            {productNames.map((product) => (
              <label key={product} className="digest-gold-check">
                <input
                  type="checkbox"
                  checked={matchedProducts.includes(product)}
                  onChange={() => setMatchedProducts((prev) => toggleValue(prev, product))}
                />{' '}
                {product}
              </label>
            ))}
          </fieldset>
        </>
      ) : null}

      <label className="field" style={{ marginTop: '0.75rem', display: 'block' }}>
        <span>CVEs (one per line or comma-separated)</span>
        <textarea
          name="cves"
          rows={3}
          value={cves}
          onChange={(event) => setCves(event.target.value)}
        />
      </label>

      <label className="field" style={{ marginTop: '0.75rem', display: 'block' }}>
        <span>Reason (optional)</span>
        <textarea
          name="humanReason"
          rows={2}
          value={humanReason}
          onChange={(event) => setHumanReason(event.target.value)}
        />
      </label>

      {assistMessage ? (
        <p className="meta" style={{ marginTop: '0.75rem' }}>
          Assist draft: {assistMessage}
        </p>
      ) : null}
      {assistError || localAssistError ? (
        <p className="flash flash-error">{assistError ?? localAssistError}</p>
      ) : null}
      {saveError ? <p className="flash flash-error">{saveError}</p> : null}
      {saved ? <p className="flash flash-success">Digest gold saved.</p> : null}

      <div className="form-actions" style={{ marginTop: '1rem' }}>
        <button
          type="button"
          className="auth-button secondary"
          disabled={pending}
          onClick={handleAssist}
        >
          {pending ? 'Asking assist…' : 'Ask assist'}
        </button>
        <form action={saveDigestGoldAction} style={{ display: 'inline' }}>
          <input type="hidden" name="articleId" value={articleId} />
          <input type="hidden" name="relatedToMonitoredInventory" value={related ? 'true' : 'false'} />
          <input type="hidden" name="matchedVendors" value={matchedVendors.join(',')} />
          <input type="hidden" name="matchedProducts" value={matchedProducts.join(',')} />
          <input type="hidden" name="cves" value={cves} />
          <input type="hidden" name="humanReason" value={humanReason} />
          <button className="auth-button" type="submit" disabled={pending}>
            Save gold
          </button>
        </form>
      </div>
    </div>
  );
}
