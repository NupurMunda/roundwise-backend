# roundwise-backend

Read-only REST API over the interview knowledge base. Hono + TypeScript. Runs locally on `node:sqlite` and deploys to Cloudflare Workers + D1 by swapping only the storage adapter.

## Run

```
npm install
npm run dev        # watch mode
npm start          # http://127.0.0.1:8787/v1
npm test
```

| Env | Default | |
|---|---|---|
| `KB_DB_PATH` | `C:\Project\kb\data\kb.db` | SQLite file, opened read-only |
| `ALLOWED_ORIGIN` | `http://localhost:5173` | the only CORS origin |

Tests run against `fixtures/sample.db` (fake rows, same schema).

## Endpoints

All `GET`, under `/v1`. Success is `{data, meta}`, errors are `{error:{code,message}}`. Unknown query params return 400. Lists take `page` (default 1) and `limit` (default 20, capped at 50).

| Path | |
|---|---|
| `/health` | liveness |
| `/companies?q=` | companies with counts per category (`dsa`, `hld`, `ai`, `behavioral`) |
| `/companies/:slug` | profile, category counts, values, sources |
| `/companies/:slug/dsa?time_window=&difficulty=&topic=` | sorted by frequency, desc |
| `/companies/:slug/hld` | questions with approved solution links |
| `/companies/:slug/ai` | AI questions |
| `/companies/:slug/behavioral` | values and topics |
| `/resources/:id` | one resource; the only route that returns `content_md` |
| `/sources` | credits and licenses |

`time_window` is `30d`, `3m`, `6m` (default), `6m+` or `all`. Send `6m+` URL-encoded as `6m%2B`. If the window (after filters) has fewer than 5 rows, the response falls back to `all` and sets `meta.fallback: true` and `meta.time_window: "all"`.

## Rules applied in every query

- `sources.display_mode = 'hidden'` rows never appear, including in counts.
- `link` sources return title, url, topics, difficulty and company links, with `content_md` null. `full` sources return `content_md` from `/resources/:id` only.
- Categories: `leetcode` is `dsa`; `hld` and `system-design` are `hld`; `ai`; `behavioral` comes from values and topics. `readme` rows are never listed.
- A company appears if it has a visible resource or a visible profile.
- Only approved `question_solutions` are returned.

## Deploy to Cloudflare

1. `npx wrangler d1 create roundwise`, then put the id in `wrangler.toml`.
2. `npm run export:d1` writes `dist/d1-import.sql` (hidden sources skipped, `content_md` only for `full` sources, plus a `company_stats` table so requests never count).
3. `npx wrangler d1 execute roundwise --remote --file dist/d1-import.sql`
4. Set `ALLOWED_ORIGIN` in `wrangler.toml`, then `npm run deploy`.

Rate limiting is 60 requests/min per IP: in memory locally, the Workers rate-limit binding (`RATE_LIMITER`) in production.

## Layout

`src/app.ts` routes · `src/store/queries.ts` the SQL, shared by both adapters · `src/store/sqlite.ts` and `src/store/d1.ts` thin adapters · `src/rate-limit.ts` · `src/server.ts` and `src/worker.ts` entries. The local adapter builds `company_stats` as a temp table, so the database file is never written.

## Traffic and usage

- **Request log**: every request writes one JSON line, `{"event":"request","method":"GET","route":"/v1/companies/:slug/dsa","status":200,"ms":12}`. It holds the route pattern, status and time only; no IPs, keys or query values. Observability is on in `wrangler.toml`, so view it in the Cloudflare dashboard under **Workers & Pages → roundwise-backend → Logs**, or live with `npx wrangler tail roundwise-backend --format pretty`.
- **Request, error and CPU graphs**: the same page, under **Metrics**. A rise in 503s means D1 is failing (for example the daily free limit).
- **D1 cost**: `npm run usage` lists the ten queries that read the most rows today. The free plan allows 5,000,000 rows read and 100,000 rows written per day, so check this after any query change.
- **Per-visitor limits**: the Netlify proxy forwards each visitor's IP as `x-client-ip`, so the 60 requests/minute limit is per visitor, not per proxy.

### Usage events

`GET /v1/ping?kind=view|query|error&page=&company=&category=&status=` writes one line, `{"event":"track","kind":"query","company":"google","category":"dsa","visitor":"a1b2c3d4e5f6"}`. The visitor is the first 12 hex characters of SHA-256(address + UTC date + secret), so it counts distinct visitors per day, changes daily and cannot be reversed. The address itself is never logged. Params are validated strictly (fixed lists, slug pattern), the response is `no-store`, and the route needs the API key like the others.

In the Cloudflare logs query builder: count by `kind` and `company` (most-queried companies), count by `category` (round types), unique `visitor` per day (visitors), count by `status` where `kind=error` (failure types).
