import { describe, expect, it } from 'vitest';
import { groupEntitiesByType } from '../web/lib/group-entities.js';

describe('groupEntitiesByType', () => {
  it('groups values under each entity type in first-seen order', () => {
    expect(
      groupEntitiesByType([
        { entityType: 'attack_type', entityValue: 'exploited' },
        { entityType: 'cve', entityValue: 'CVE-2026-1' },
        { entityType: 'attack_type', entityValue: 'rce' },
        { entityType: 'cve', entityValue: 'CVE-2026-2', confidence: 0.9 },
      ])
    ).toEqual([
      { entityType: 'attack_type', values: ['exploited', 'rce'] },
      { entityType: 'cve', values: ['CVE-2026-1', 'CVE-2026-2 · 90%'] },
    ]);
  });
});
