import { embedOne } from '../config/embeddings.js';

export interface EmbeddingClient {
  embedDocument(text: string): Promise<number[]>;
}

export class MiniMaxEmbeddingClient implements EmbeddingClient {
  async embedDocument(text: string): Promise<number[]> {
    return embedOne(text, 'db');
  }
}

export function buildArticleEmbeddingText(input: {
  title?: string | null;
  cleanText?: string | null;
  rssSummary?: string | null;
}): string {
  return [input.title, input.rssSummary, input.cleanText].filter(Boolean).join('\n').slice(0, 12000);
}

export function buildEventEmbeddingText(input: {
  eventTitle?: string | null;
  eventSummary?: string | null;
  severity?: string | null;
  urgency?: string | null;
  affectedVendors?: string[];
  affectedProducts?: string[];
  cves?: string[];
  attackTypes?: string[];
}): string {
  const sections = [
    input.eventTitle,
    input.eventSummary,
    input.severity ? `Severity: ${input.severity}` : null,
    input.urgency ? `Urgency: ${input.urgency}` : null,
    input.affectedVendors?.length ? `Vendors: ${input.affectedVendors.join(', ')}` : null,
    input.affectedProducts?.length ? `Products: ${input.affectedProducts.join(', ')}` : null,
    input.cves?.length ? `CVEs: ${input.cves.join(', ')}` : null,
    input.attackTypes?.length ? `Attack types: ${input.attackTypes.join(', ')}` : null,
  ];

  return sections.filter(Boolean).join('\n').slice(0, 12000);
}
