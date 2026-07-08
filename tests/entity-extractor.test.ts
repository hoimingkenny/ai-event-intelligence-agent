import { describe, expect, it } from 'vitest';
import { extractArticleEntities } from '../src/detection/entity-extractor.js';
import { extractIocs } from '../src/detection/ioc-extractor.js';

describe('extractIocs', () => {
  it('extracts IPs, domains, and hashes', () => {
    const iocs = extractIocs(
      'Callback to evil.example.com from 192.168.1.5 with hash d41d8cd98f00b204e9800998ecf8427e.'
    );

    expect(iocs.ips).toContain('192.168.1.5');
    expect(iocs.domains).toContain('evil.example.com');
    expect(iocs.hashes).toContain('d41d8cd98f00b204e9800998ecf8427e');
  });
});

describe('extractArticleEntities', () => {
  it('extracts vendor, product, CVE, IOC, and attack indicator entities', () => {
    const entities = extractArticleEntities('article-1', {
      title: 'Zscaler Internet Access CVE-2026-12345 vulnerability exploited from 203.0.113.4.',
    });

    expect(entities).toContainEqual(
      expect.objectContaining({ entityType: 'vendor', entityValue: 'Zscaler' })
    );
    expect(entities).toContainEqual(
      expect.objectContaining({ entityType: 'product', entityValue: 'Zscaler Internet Access' })
    );
    expect(entities).toContainEqual(
      expect.objectContaining({ entityType: 'cve', entityValue: 'CVE-2026-12345' })
    );
    expect(entities).toContainEqual(
      expect.objectContaining({ entityType: 'ioc_ip', entityValue: '203.0.113.4' })
    );
    expect(entities).toContainEqual(
      expect.objectContaining({ entityType: 'attack_type', entityValue: 'exploit' })
    );
  });
});
