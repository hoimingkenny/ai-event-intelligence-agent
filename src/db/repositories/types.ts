import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

export type Queryable = Pool | PoolClient;

export function queryOne<T extends QueryResultRow>(
  result: QueryResult<T>,
  message: string
): T {
  const row = result.rows[0];
  if (!row) throw new Error(message);
  return row;
}
