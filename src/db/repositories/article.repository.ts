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
  cleanText: string | null;
  extractionStatus: string;
  extractionMethod: string | null;
  extractionError: string | null;
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
  clean_text: string | null;
  extraction_status: string;
  extraction_method: string | null;
  extraction_error: string | null;
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
        RETURNING id, feed_id, source_name, title, canonical_url, url_hash, title_hash, rss_summary,
          clean_text, extraction_status, extraction_method, extraction_error, processing_status
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
        SELECT id, feed_id, source_name, title, canonical_url, url_hash, title_hash, rss_summary,
          clean_text, extraction_status, extraction_method, extraction_error, processing_status
        FROM articles
        WHERE canonical_url = $1
      `,
      [canonicalUrl]
    );

    return result.rows[0] ? mapArticle(result.rows[0]) : null;
  }

  async listByProcessingStatus(status: string, limit = 50): Promise<ArticleRecord[]> {
    const result = await this.db.query<ArticleRow>(
      `
        SELECT id, feed_id, source_name, title, canonical_url, url_hash, title_hash, rss_summary,
          clean_text, extraction_status, extraction_method, extraction_error, processing_status
        FROM articles
        WHERE processing_status = $1
        ORDER BY fetched_at ASC, id ASC
        LIMIT $2
      `,
      [status, limit]
    );

    return result.rows.map(mapArticle);
  }

  async updateProcessingStatus(
    articleId: string,
    status: string,
    error: string | null = null
  ): Promise<void> {
    await this.db.query(
      `
        UPDATE articles
        SET processing_status = $2,
          processing_error = $3,
          last_processed_at = now(),
          updated_at = now()
        WHERE id = $1
      `,
      [articleId, status, error]
    );
  }

  async saveExtractionResult(input: {
    articleId: string;
    cleanText: string | null;
    rawHtml?: string | null;
    contentHash?: string | null;
    extractionStatus: string;
    extractionMethod: string;
    extractionError?: string | null;
    processingStatus: string;
    contentQualityScore?: number | null;
  }): Promise<void> {
    await this.db.query(
      `
        UPDATE articles
        SET raw_html = $2,
          clean_text = $3,
          content_hash = $4,
          extraction_status = $5,
          extraction_method = $6,
          extraction_error = $7,
          extracted_at = now(),
          processing_status = $8,
          content_quality_score = $9,
          last_processed_at = now(),
          updated_at = now()
        WHERE id = $1
      `,
      [
        input.articleId,
        input.rawHtml ?? null,
        input.cleanText,
        input.contentHash ?? null,
        input.extractionStatus,
        input.extractionMethod,
        input.extractionError ?? null,
        input.processingStatus,
        input.contentQualityScore ?? null,
      ]
    );
  }

  async saveEmbedding(articleId: string, vector: number[]): Promise<void> {
    await this.db.query(
      `
        UPDATE articles
        SET embedding = $2::vector,
          processing_status = 'EMBEDDED',
          last_processed_at = now(),
          updated_at = now()
        WHERE id = $1
      `,
      [articleId, vectorToSqlLiteral(vector)]
    );
  }

  async findSimilarArticles(
    vector: number[],
    options: { limit?: number; daysBack?: number; excludeArticleId?: string } = {}
  ): Promise<Array<ArticleRecord & { distance: number }>> {
    const result = await this.db.query<ArticleRow & { distance: string }>(
      `
        SELECT id, feed_id, source_name, title, canonical_url, url_hash, title_hash, rss_summary,
          clean_text, extraction_status, extraction_method, extraction_error, processing_status,
          embedding <=> $1::vector AS distance
        FROM articles
        WHERE embedding IS NOT NULL
          AND published_at > now() - make_interval(days => $2)
          AND ($3::BIGINT IS NULL OR id <> $3)
        ORDER BY embedding <=> $1::vector
        LIMIT $4
      `,
      [
        vectorToSqlLiteral(vector),
        options.daysBack ?? 14,
        options.excludeArticleId ?? null,
        options.limit ?? 10,
      ]
    );

    return result.rows.map((row) => ({
      ...mapArticle(row),
      distance: Number(row.distance),
    }));
  }
}

export function vectorToSqlLiteral(vector: number[]): string {
  return `[${vector.map((value) => Number(value).toString()).join(',')}]`;
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
    cleanText: row.clean_text,
    extractionStatus: row.extraction_status,
    extractionMethod: row.extraction_method,
    extractionError: row.extraction_error,
    processingStatus: row.processing_status,
  };
}
