'use client';

import { useMemo, useState, useTransition, type FormEvent } from 'react';
import {
  findInvalidCveEntries,
  normalizeCveId,
  normalizeCveList,
  type DigestGoldFields,
} from '../../src/evaluation/digest/digest-gold-types';
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

function initialCveRows(cves: string[]): string[] {
  return cves.length > 0 ? cves : [''];
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
  const [cveRows, setCveRows] = useState<string[]>(() => initialCveRows(initial.cves));
  const [humanReason, setHumanReason] = useState(initial.humanReason ?? '');
  const [assistMessage, setAssistMessage] = useState<string | null>(null);
  const [localAssistError, setLocalAssistError] = useState<string | null>(null);
  const [cveValidationError, setCveValidationError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const vendorNames = Array.from(new Set(inventory.map((item) => item.vendor))).sort();
  const productNames = Array.from(new Set(inventory.map((item) => item.product))).sort();

  const serializedCves = useMemo(() => normalizeCveList(cveRows).join(','), [cveRows]);

  function toggleValue(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function updateCveRow(index: number, value: string) {
    setCveRows((prev) => prev.map((row, i) => (i === index ? value : row)));
    setCveValidationError(null);
  }

  function addCveRow() {
    setCveRows((prev) => [...prev, '']);
  }

  function removeCveRow(index: number) {
    setCveRows((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length > 0 ? next : [''];
    });
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
      setCveRows(initialCveRows(result.cves));
      setCveValidationError(null);
      setAssistMessage(result.reasoning);
    });
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    const invalid = findInvalidCveEntries(cveRows);
    if (invalid.length > 0) {
      event.preventDefault();
      setCveValidationError(
        `Invalid CVE id(s): ${invalid.join(', ')}. Use the format CVE-YYYY-NNNNN.`
      );
    }
  }

  return (
    <form className="digest-gold-form edit-form" action={saveDigestGoldAction} onSubmit={handleSave}>
      <input type="hidden" name="articleId" value={articleId} />
      <input type="hidden" name="relatedToMonitoredInventory" value={related ? 'true' : 'false'} />
      <input type="hidden" name="matchedVendors" value={matchedVendors.join(',')} />
      <input type="hidden" name="matchedProducts" value={matchedProducts.join(',')} />
      <input type="hidden" name="cves" value={serializedCves} />
      <input type="hidden" name="humanReason" value={humanReason} />

      <div className="field">
        <span>Related to monitored inventory?</span>
        <div className="digest-gold-radio-row" role="radiogroup" aria-label="Related to monitored inventory">
          <label className="digest-gold-radio-choice">
            <input
              type="radio"
              name="relatedChoice"
              value="true"
              checked={related}
              onChange={() => setRelated(true)}
            />
            Yes
          </label>
          <label className="digest-gold-radio-choice">
            <input
              type="radio"
              name="relatedChoice"
              value="false"
              checked={!related}
              onChange={() => {
                setRelated(false);
                setMatchedVendors([]);
                setMatchedProducts([]);
              }}
            />
            No
          </label>
        </div>
      </div>

      {related ? (
        <>
          <fieldset className="field">
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

          <fieldset className="field">
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

      <div className="field">
        <span>CVEs</span>
        <p className="meta">Format: CVE-YYYY-NNNNN (e.g. CVE-2024-12345). Leave a row empty to skip.</p>
        <ul className="digest-gold-cve-list">
          {cveRows.map((value, index) => {
            const trimmed = value.trim();
            const rowInvalid = trimmed.length > 0 && normalizeCveId(trimmed) === null;
            return (
              <li key={index} className="digest-gold-cve-row">
                <input
                  type="text"
                  value={value}
                  placeholder="CVE-2024-12345"
                  aria-invalid={rowInvalid || undefined}
                  className={rowInvalid ? 'digest-gold-cve-invalid' : undefined}
                  onChange={(event) => updateCveRow(index, event.target.value)}
                />
                <button
                  type="button"
                  className="auth-button secondary digest-gold-cve-remove"
                  aria-label={`Remove CVE row ${index + 1}`}
                  onClick={() => removeCveRow(index)}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="auth-button secondary" onClick={addCveRow}>
          Add CVE
        </button>
        {cveValidationError ? <p className="flash flash-error">{cveValidationError}</p> : null}
      </div>

      <div className="field">
        <span>Reason (optional)</span>
        <textarea
          id={`digest-gold-reason-${articleId}`}
          rows={2}
          value={humanReason}
          onChange={(event) => setHumanReason(event.target.value)}
        />
      </div>

      {assistMessage ? <p className="meta">Assist draft: {assistMessage}</p> : null}
      {assistError || localAssistError ? (
        <p className="flash flash-error">{assistError ?? localAssistError}</p>
      ) : null}
      {saveError ? <p className="flash flash-error">{saveError}</p> : null}
      {saved ? <p className="flash flash-success">Digest gold saved.</p> : null}

      <div className="form-actions">
        <button type="button" className="auth-button secondary" disabled={pending} onClick={handleAssist}>
          {pending ? 'Asking assist…' : 'Ask assist'}
        </button>
        <button className="auth-button" type="submit" disabled={pending}>
          Save gold
        </button>
      </div>
    </form>
  );
}
