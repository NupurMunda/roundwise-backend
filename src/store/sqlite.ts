import { createRequire } from 'node:module';
import type { DatabaseSync as Database } from 'node:sqlite';
import { createStore, DERIVED_TABLES_SQL, type Row } from './queries';
import type { DataStore } from './types';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export function sqliteStore(path: string): DataStore {
  const db: Database = new DatabaseSync(path, { readOnly: true });
  db.exec(DERIVED_TABLES_SQL);
  return createStore(async (sql, params) => db.prepare(sql).all(...(params as never[])) as Row[]);
}
