import { createStore, type Row } from './queries';
import { StoreUnavailableError, type DataStore } from './types';

export interface D1Like {
  prepare(sql: string): { bind(...values: unknown[]): { all(): Promise<{ results: Row[] }> } };
}

export function d1Store(db: D1Like): DataStore {
  return createStore(async (sql, params) => {
    try {
      return (await db.prepare(sql).bind(...params).all()).results;
    } catch (cause) {
      throw new StoreUnavailableError('database unavailable', { cause });
    }
  });
}
