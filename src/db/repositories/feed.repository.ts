import type { Queryable } from './types.js';

export interface FeedRecord {
  id: string;
  sourceName: string;
  feedUrl: string;
  sourceType: string | null;
  trustLevel: string;
  isActive: boolean;
  lastFetchedAt: Date | null;
}

export interface UpsertFeedInput {
  sourceName: string;
  feedUrl: string;
  sourceType?: string | null;
  trustLevel?: string;
  isActive?: boolean;
}

interface FeedRow {
  id: string;
  source_name: string;
  feed_url: string;
  source_type: string | null;
  trust_level: string;
  is_active: boolean;
  last_fetched_at: Date | null;
}

export class FeedRepository {
  constructor(private readonly db: Queryable) {}

  async upsertFeed(input: UpsertFeedInput): Promise<FeedRecord> {
    const result = await this.db.query<FeedRow>(
      `
        INSERT INTO feeds (source_name, feed_url, source_type, trust_level, is_active, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (feed_url)
        DO UPDATE SET
          source_name = EXCLUDED.source_name,
          source_type = EXCLUDED.source_type,
          trust_level = EXCLUDED.trust_level,
          is_active = EXCLUDED.is_active,
          updated_at = now()
        RETURNING id, source_name, feed_url, source_type, trust_level, is_active, last_fetched_at
      `,
      [
        input.sourceName,
        input.feedUrl,
        input.sourceType ?? null,
        input.trustLevel ?? 'medium',
        input.isActive ?? true,
      ]
    );

    return mapFeed(result.rows[0]);
  }

  async listActiveFeeds(): Promise<FeedRecord[]> {
    const result = await this.db.query<FeedRow>(
      `
        SELECT id, source_name, feed_url, source_type, trust_level, is_active, last_fetched_at
        FROM feeds
        WHERE is_active = true
        ORDER BY source_name ASC, feed_url ASC
      `
    );

    return result.rows.map(mapFeed);
  }

  async listAllFeeds(): Promise<FeedRecord[]> {
    const result = await this.db.query<FeedRow>(
      `
        SELECT id, source_name, feed_url, source_type, trust_level, is_active, last_fetched_at
        FROM feeds
        ORDER BY source_name ASC, feed_url ASC
      `
    );

    return result.rows.map(mapFeed);
  }

  async updateLastFetchedAt(feedId: string, fetchedAt: Date = new Date()): Promise<void> {
    await this.db.query('UPDATE feeds SET last_fetched_at = $2, updated_at = now() WHERE id = $1', [
      feedId,
      fetchedAt,
    ]);
  }
}

function mapFeed(row: FeedRow): FeedRecord {
  return {
    id: row.id,
    sourceName: row.source_name,
    feedUrl: row.feed_url,
    sourceType: row.source_type,
    trustLevel: row.trust_level,
    isActive: row.is_active,
    lastFetchedAt: row.last_fetched_at,
  };
}
