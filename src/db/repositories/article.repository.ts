import type { Queryable } from './types.js';

export interface ArticleRecord {
  id: string;
  feedId: string | null;
  sourceName: string | null;
  title: string | null;
  canonicalUrl: string | null;
  urlHash: string | null;
  titleHash: string | null;
  rssSummary: string | null;
  processingStatus: string;
}

export interface ArticleMetadataInput {
  feedId?: string | null;
  sourceName?: string | null;
  title?: string | null;
  canonicalUrl: string;
  urlHash?: string | null;
  titleHash?: string | null;
  rssSummary?: string | null;
  publishedAt?: Date | null;
}

export interface ArticleUpsertResult {
  article: ArticleRecord;
  created: boolean;
}

interface ArticleRow {
  id: string;
  feed_id: string | null;
  source_name: string | null;
  title: string | null;
  canonical_url: string | null;
  url_hash: string | null;
  title_hash: string | null;
  rss_summary: string | null;
  processing_status: string;
}

export class ArticleRepository {
  constructor(private readonly db: Queryable) {}

  async insertDiscoveredArticle(input: ArticleMetadataInput): Promise<ArticleUpsertResult> {
    const inserted = await this.db.query<ArticleRow>(
      `
        INSERT INTO articles (
          feed_id,
          source_name,
          title,
          canonical_url,
          url_hash,
          title_hash,
          rss_summary,
          published_at,
          processing_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NEW')
        ON CONFLICT (canonical_url) DO NOTHING
        RETURNING id, feed_id, source_name, title, canonical_url, url_hash, title_hash, rss_summary, processing_status
      `,
      [
        input.feedId ?? null,
        input.sourceName ?? null,
        input.title ?? null,
        input.canonicalUrl,
        input.urlHash ?? null,
        input.titleHash ?? null,
        input.rssSummary ?? null,
        input.publishedAt ?? null,
      ]
    );

    if (inserted.rows[0]) {
      return { article: mapArticle(inserted.rows[0]), created: true };
    }

    const existing = await this.findByCanonicalUrl(input.canonicalUrl);
    if (!existing) {
      throw new Error(`Article conflict not found for canonical URL: ${input.canonicalUrl}`);
    }

    return { article: existing, created: false };
  }

  async findByCanonicalUrl(canonicalUrl: string): Promise<ArticleRecord | null> {
    const result = await this.db.query<ArticleRow>(
      `
        SELECT id, feed_id, source_name, title, canonical_url, url_hash, title_hash, rss_summary, processing_status
        FROM articles
        WHERE canonical_url = $1
      `,
      [canonicalUrl]
    );

    return result.rows[0] ? mapArticle(result.rows[0]) : null;
  }
}

function mapArticle(row: ArticleRow): ArticleRecord {
  return {
    id: row.id,
    feedId: row.feed_id,
    sourceName: row.source_name,
    title: row.title,
    canonicalUrl: row.canonical_url,
    urlHash: row.url_hash,
    titleHash: row.title_hash,
    rssSummary: row.rss_summary,
    processingStatus: row.processing_status,
  };
}
