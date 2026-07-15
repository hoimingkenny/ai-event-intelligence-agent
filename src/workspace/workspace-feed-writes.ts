import type { PoolClient } from 'pg';
import {
  FeedRepository,
  type FeedRecord,
} from '../db/repositories/feed.repository.js';
import type { Queryable } from '../db/repositories/types.js';

export const FEED_TRUST_LEVELS = ['low', 'medium', 'high'] as const;
export type FeedTrustLevel = (typeof FEED_TRUST_LEVELS)[number];

export type WorkspaceFeedWriteErrorCode =
  | 'duplicate_url'
  | 'last_active_feed'
  | 'feed_not_found'
  | 'invalid_input';

export class WorkspaceFeedWriteError extends Error {
  constructor(
    readonly code: WorkspaceFeedWriteErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'WorkspaceFeedWriteError';
  }
}

export interface CreateWorkspaceFeedInput {
  sourceName: string;
  feedUrl: string;
  trustLevel: FeedTrustLevel;
  isActive: boolean;
}

export interface UpdateWorkspaceFeedInput {
  sourceName: string;
  feedUrl: string;
  trustLevel: FeedTrustLevel;
}

interface ActiveFeedCountRow {
  active_count: number;
}

interface FeedActiveRow {
  is_active: boolean;
}

export async function createFeed(
  db: Queryable,
  input: CreateWorkspaceFeedInput
): Promise<FeedRecord> {
  const normalized = validateFeedFields(input);
  if (!input.isActive && (await countActiveFeeds(db)) === 0) {
    throw new WorkspaceFeedWriteError(
      'last_active_feed',
      'At least one feed must remain active.'
    );
  }

  try {
    return await new FeedRepository(db).createFeed({
      ...normalized,
      isActive: input.isActive,
    });
  } catch (error) {
    throwMappedWriteError(error);
  }
}

export async function updateFeed(
  db: Queryable,
  feedId: string,
  input: UpdateWorkspaceFeedInput
): Promise<FeedRecord> {
  const id = requireFeedId(feedId);
  const normalized = validateFeedFields(input);

  try {
    const feed = await new FeedRepository(db).updateFeed(id, normalized);
    if (!feed) {
      throw new WorkspaceFeedWriteError('feed_not_found', 'Feed not found.');
    }
    return feed;
  } catch (error) {
    throwMappedWriteError(error);
  }
}

export async function setFeedActive(
  db: Queryable,
  feedId: string,
  isActive: boolean
): Promise<FeedRecord> {
  const id = requireFeedId(feedId);
  if (isActive) {
    return setActiveState(db, id, true);
  }

  return withTransaction(db, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('workspace-config-active-feeds'))");
    const current = await getFeedActiveState(tx, id);
    if (!current) {
      throw new WorkspaceFeedWriteError('feed_not_found', 'Feed not found.');
    }
    if (current.is_active && (await countActiveFeeds(tx)) <= 1) {
      throw new WorkspaceFeedWriteError(
        'last_active_feed',
        'At least one feed must remain active.'
      );
    }
    return setActiveState(tx, id, false);
  });
}

async function setActiveState(
  db: Queryable,
  feedId: string,
  isActive: boolean
): Promise<FeedRecord> {
  const feed = await new FeedRepository(db).setFeedActive(feedId, isActive);
  if (!feed) {
    throw new WorkspaceFeedWriteError('feed_not_found', 'Feed not found.');
  }
  return feed;
}

function validateFeedFields(input: {
  sourceName: string;
  feedUrl: string;
  trustLevel: string;
}): UpdateWorkspaceFeedInput {
  const sourceName = input.sourceName.trim();
  const feedUrl = input.feedUrl.trim();
  if (!sourceName) {
    throw new WorkspaceFeedWriteError('invalid_input', 'Source name is required.');
  }
  if (!isHttpUrl(feedUrl)) {
    throw new WorkspaceFeedWriteError(
      'invalid_input',
      'Feed URL must be a valid http or https URL.'
    );
  }
  if (!isFeedTrustLevel(input.trustLevel)) {
    throw new WorkspaceFeedWriteError('invalid_input', 'Trust level must be low, medium, or high.');
  }
  return { sourceName, feedUrl, trustLevel: input.trustLevel };
}

function requireFeedId(feedId: string): string {
  const id = feedId.trim();
  if (!id) {
    throw new WorkspaceFeedWriteError('invalid_input', 'Feed id is required.');
  }
  return id;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isFeedTrustLevel(value: string): value is FeedTrustLevel {
  return FEED_TRUST_LEVELS.some((level) => level === value);
}

async function countActiveFeeds(db: Queryable): Promise<number> {
  const result = await db.query<ActiveFeedCountRow>(
    'SELECT COUNT(*)::int AS active_count FROM feeds WHERE is_active = true'
  );
  return result.rows[0]?.active_count ?? 0;
}

async function getFeedActiveState(db: Queryable, feedId: string): Promise<FeedActiveRow | null> {
  const result = await db.query<FeedActiveRow>('SELECT is_active FROM feeds WHERE id = $1', [feedId]);
  return result.rows[0] ?? null;
}

type Connectable = Queryable & { connect(): Promise<PoolClient> };

function isConnectable(db: Queryable): db is Connectable {
  return typeof (db as Connectable).connect === 'function';
}

async function withTransaction<T>(db: Queryable, work: (tx: Queryable) => Promise<T>): Promise<T> {
  if (isConnectable(db)) {
    const client = (await db.connect()) as PoolClient;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  await db.query('BEGIN');
  try {
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

function throwMappedWriteError(error: unknown): never {
  if (error instanceof WorkspaceFeedWriteError) throw error;
  if (isUniqueViolation(error)) {
    throw new WorkspaceFeedWriteError('duplicate_url', 'A feed with this URL already exists.');
  }
  throw error;
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
