import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { memoryRateLimiter } from '../src/rate-limit';
import { d1Store } from '../src/store/d1';
import { createStore, DERIVED_TABLES_SQL, type Row } from '../src/store/queries';
import { sqliteStore } from '../src/store/sqlite';

const fixture = new URL('../fixtures/sample.db', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const config = { allowedOrigin: 'http://localhost:5173', rateLimiter: memoryRateLimiter(1_000_000), clientIp: () => '203.0.113.7' };
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

describe('database failures', () => {
  const failing = (message: string) => ({
    prepare: () => ({ bind: () => ({ all: async () => { throw new Error(message); } }) }),
  });

  it('returns 503 with Retry-After and no internals when D1 fails', async () => {
    const app = createApp(d1Store(failing('D1_ERROR: daily rows read limit exceeded')), config);
    for (const path of ['/companies', '/companies/acme', '/graph', '/sources', '/resources/3']) {
      const res = await app.request(`/v1${path}`);
      expect(res.status, path).toBe(503);
      expect(res.headers.get('Retry-After')).toBe('300');
      expect(res.headers.get('Cache-Control')).toBeNull();
      const text = await res.text();
      expect(JSON.parse(text).error.code).toBe('temporarily_unavailable');
      expect(text).not.toMatch(/D1_ERROR|limit exceeded/);
    }
  });

  it('keeps /health up and 404s unaffected when D1 fails', async () => {
    const app = createApp(d1Store(failing('boom')), config);
    expect((await app.request('/v1/health')).status).toBe(200);
    expect((await app.request('/v1/nothing')).status).toBe(404);
  });

  it('still reports unexpected bugs as 500', async () => {
    const buggy = { ...sqliteStore(fixture), listSources: async () => { throw new Error('bug'); } };
    const res = await createApp(buggy, config).request('/v1/sources');
    expect(res.status).toBe(500);
    expect((await res.json() as any).error.code).toBe('internal');
  });
});

// D1's free plan allows 5M rows read per day, so no request may scan a big table.
describe('query plans', () => {
  it('never scan the large tables', async () => {
    const db = new DatabaseSync(fixture, { readOnly: true });
    db.exec(DERIVED_TABLES_SQL);
    const seen: { sql: string; params: unknown[] }[] = [];
    const store = createStore(async (sql, params) => {
      seen.push({ sql, params });
      return db.prepare(sql).all(...(params as never[])) as Row[];
    });

    const paging = { limit: 20, offset: 0 };
    await store.listCompanies(undefined, paging);
    await store.listCompanies('ac', paging);
    const company = (await store.findCompany('acme'))!;
    await store.getCompany(company);
    for (const query of [{}, { difficulty: 'hard' as const }, { topic: 'Array' }]) {
      await store.listDsa(company.id, { timeWindow: '6m', ...paging, ...query });
    }
    await store.listHld(company.id, paging);
    await store.listAi(company.id, paging);
    await store.getBehavioral(company.id);
    await store.getResource(3);
    await store.getResource(11);
    await store.listSources();
    await store.getGraph(60);

    const bigTables = /^SCAN (cr|r|company_resources|resources)\b/; // 37k and 4k rows; every other table has under 600
    const scans: string[] = [];
    for (const { sql, params } of seen) {
      for (const row of db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[])) as { detail: string }[]) {
        if (bigTables.test(row.detail)) scans.push(`${row.detail}  <-  ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
    expect(scans).toEqual([]);
    expect(seen.length).toBeGreaterThan(15);
  });
});
