import type {
  ApiCategory, CompanyDetail, CompanyRef, Counts, DataStore, DsaItem, HldItem, ListItem, Profile, ResourceDetail, Solution, Topic, Value,
} from './types';

export type Row = Record<string, unknown>;
export type Run = (sql: string, params: unknown[]) => Promise<Row[]>;

const VISIBLE = "s.display_mode IN ('full','link')";

const CATEGORIES: Record<Exclude<ApiCategory, 'behavioral'>, string[]> = {
  dsa: ['leetcode'],
  hld: ['hld', 'system-design'],
  ai: ['ai'],
};
const inList = (values: string[]) => values.map((v) => `'${v}'`).join(',');
const SERVED_CATEGORIES = inList(Object.values(CATEGORIES).flat());

const apiCategory = (db: string): ApiCategory =>
  (Object.entries(CATEGORIES).find(([, dbCats]) => dbCats.includes(db))?.[0] ?? 'ai') as ApiCategory;

// One row per company; the only place visibility is turned into counts.
export const STATS_SELECT = `
WITH vr AS (
  SELECT r.id, r.category FROM resources r JOIN sources s ON s.id = r.source_id
  WHERE ${VISIBLE} AND r.category IN (${SERVED_CATEGORIES})
)
SELECT c.id AS company_id,
  COUNT(DISTINCT CASE WHEN vr.category IN (${inList(CATEGORIES.dsa)}) THEN vr.id END) AS dsa,
  COUNT(DISTINCT CASE WHEN vr.category IN (${inList(CATEGORIES.hld)}) THEN vr.id END) AS hld,
  COUNT(DISTINCT CASE WHEN vr.category IN (${inList(CATEGORIES.ai)}) THEN vr.id END) AS ai,
  (SELECT COUNT(*) FROM company_values cv JOIN sources s ON s.id = cv.source_id WHERE cv.company_id = c.id AND ${VISIBLE}) AS behavioral,
  EXISTS (SELECT 1 FROM company_profiles cp JOIN sources s ON s.id = cp.source_id WHERE cp.company_id = c.id AND ${VISIBLE}) AS has_profile
FROM companies c
LEFT JOIN company_resources cr ON cr.company_id = c.id
LEFT JOIN vr ON vr.id = cr.resource_id
GROUP BY c.id`;

export const STATS_DDL = `CREATE TABLE company_stats (
  company_id INTEGER PRIMARY KEY REFERENCES companies(id),
  dsa INTEGER NOT NULL, hld INTEGER NOT NULL, ai INTEGER NOT NULL, behavioral INTEGER NOT NULL, has_profile INTEGER NOT NULL
)`;

const COMPANY_COLUMNS = 'c.id, c.name, c.slug, st.dsa, st.hld, st.ai, st.behavioral';
const COMPANY_FROM = 'FROM companies c JOIN company_stats st ON st.company_id = c.id';
const COMPANY_SHOWN = '(st.dsa + st.hld + st.ai > 0 OR st.has_profile = 1)';

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v == null ? null : String(v));
const topics = (v: unknown): string[] => JSON.parse(String(v ?? '[]'));
const counts = (r: Row): Counts => ({ dsa: num(r.dsa), hld: num(r.hld), ai: num(r.ai), behavioral: num(r.behavioral) });

const publicUrl = (v: unknown) => (typeof v === 'string' && v !== '' && !v.startsWith('local:') ? v : null);
const publicRepoUrl = (v: unknown) => publicUrl(v) ?? 'unknown';

const listItem = (r: Row): ListItem => ({
  id: num(r.id), title: String(r.title), url: publicUrl(r.url), difficulty: str(r.difficulty), topics: topics(r.topics),
});
const solution = (r: Row): Solution => ({ title: String(r.title), url: String(r.url), confidence: String(r.confidence), source: String(r.source) });

export function createStore(run: Run): DataStore {
  const one = async (sql: string, params: unknown[] = []) => (await run(sql, params))[0];
  const total = async (sql: string, params: unknown[]) => num((await one(sql, params))?.n);

  const values = async (companyId: number): Promise<Value[]> =>
    (await run(
      `SELECT cv.name, cv.my_blurb AS blurb, cv.official_source_url FROM company_values cv JOIN sources s ON s.id = cv.source_id
       WHERE cv.company_id = ? AND ${VISIBLE} ORDER BY cv.id`, [companyId],
    )).map((r) => ({ name: String(r.name), blurb: str(r.blurb), official_source_url: str(r.official_source_url) }));

  const categoryPage = async (companyId: number, category: ApiCategory, limit: number, offset: number) => {
    const where = `FROM company_resources cr JOIN resources r ON r.id = cr.resource_id JOIN sources s ON s.id = r.source_id
      WHERE cr.company_id = ? AND r.category IN (${inList(CATEGORIES[category as keyof typeof CATEGORIES])}) AND ${VISIBLE}`;
    const rows = await run(
      `SELECT r.id, r.title, r.url, r.level AS difficulty, r.topics ${where} GROUP BY r.id ORDER BY r.id LIMIT ? OFFSET ?`,
      [companyId, limit, offset],
    );
    return { items: rows.map(listItem), total: await total(`SELECT COUNT(DISTINCT r.id) AS n ${where}`, [companyId]) };
  };

  return {
    async listCompanies(q, { limit, offset }) {
      const where = `${COMPANY_SHOWN} AND (? IS NULL OR instr(lower(c.name), lower(?)) > 0)`;
      const params = [q ?? null, q ?? null];
      const rows = await run(`SELECT ${COMPANY_COLUMNS} ${COMPANY_FROM} WHERE ${where} ORDER BY c.name LIMIT ? OFFSET ?`, [...params, limit, offset]);
      return {
        items: rows.map((r) => ({ name: String(r.name), slug: String(r.slug), counts: counts(r) })),
        total: await total(`SELECT COUNT(*) AS n ${COMPANY_FROM} WHERE ${where}`, params),
      };
    },

    async findCompany(slug) {
      const r = await one(`SELECT ${COMPANY_COLUMNS} ${COMPANY_FROM} WHERE c.slug = ? AND ${COMPANY_SHOWN}`, [slug]);
      return r ? { id: num(r.id), name: String(r.name), slug: String(r.slug), counts: counts(r) } : null;
    },

    async getCompany(company: CompanyRef): Promise<CompanyDetail> {
      const p = await one(
        `SELECT cp.summary, cp.rounds_json, cp.source_urls, cp.confidence, cp.level, cp.notes, cp.last_reviewed
         FROM company_profiles cp JOIN sources s ON s.id = cp.source_id WHERE cp.company_id = ? AND ${VISIBLE}`, [company.id],
      );
      let profile: Profile | null = null;
      if (p) {
        const rounds = JSON.parse(String(p.rounds_json));
        profile = {
          summary: String(p.summary), rounds: rounds.rounds ?? [], other_steps: rounds.other_steps ?? [],
          confidence: p.confidence as Profile['confidence'], level: str(p.level), notes: str(p.notes),
          source_urls: JSON.parse(String(p.source_urls)), last_reviewed: String(p.last_reviewed),
        };
      }
      const sources = await run(
        `SELECT s.name, s.repo_url, s.license FROM sources s WHERE ${VISIBLE} AND (
           EXISTS (SELECT 1 FROM company_resources cr JOIN resources r ON r.id = cr.resource_id
                   WHERE cr.company_id = ? AND r.source_id = s.id AND r.category IN (${SERVED_CATEGORIES}))
           OR EXISTS (SELECT 1 FROM company_profiles cp WHERE cp.company_id = ? AND cp.source_id = s.id)
           OR EXISTS (SELECT 1 FROM company_values cv WHERE cv.company_id = ? AND cv.source_id = s.id)
         ) ORDER BY s.id`, [company.id, company.id, company.id],
      );
      return {
        name: company.name, slug: company.slug, profile, categories: company.counts, values: await values(company.id),
        sources: sources.map((s) => ({ name: String(s.name), repo_url: publicRepoUrl(s.repo_url), license: String(s.license) })),
      };
    },

    async listDsa(companyId, { timeWindow, difficulty, topic, limit, offset }) {
      const where = `FROM company_resources cr JOIN resources r ON r.id = cr.resource_id JOIN sources s ON s.id = r.source_id
        WHERE cr.company_id = ? AND cr."window" = ? AND r.category IN (${inList(CATEGORIES.dsa)}) AND ${VISIBLE}
          AND (? IS NULL OR r.level = ?)
          AND (? IS NULL OR EXISTS (SELECT 1 FROM json_each(r.topics) j WHERE j.value = ?))`;
      const params = [companyId, timeWindow, difficulty ?? null, difficulty ?? null, topic ?? null, topic ?? null];
      const rows = await run(
        `SELECT r.id, r.title, r.url, r.level AS difficulty, r.topics, cr.frequency ${where}
         ORDER BY cr.frequency DESC, r.id LIMIT ? OFFSET ?`, [...params, limit, offset],
      );
      return {
        items: rows.map((r): DsaItem => ({ ...listItem(r), difficulty: listItem(r).difficulty as DsaItem['difficulty'], frequency: r.frequency == null ? null : num(r.frequency) })),
        total: await total(`SELECT COUNT(*) AS n ${where}`, params),
      };
    },

    async listHld(companyId, { limit, offset }) {
      const page = await categoryPage(companyId, 'hld', limit, offset);
      const rows = await run(
        `SELECT qs.question_id, qs.title, qs.url, qs.confidence, s.name AS source FROM question_solutions qs JOIN sources s ON s.id = qs.source_id
         WHERE qs.approved = 1 AND ${VISIBLE}
           AND EXISTS (SELECT 1 FROM company_resources cr WHERE cr.company_id = ? AND cr.resource_id = qs.question_id)
         ORDER BY qs.id`, [companyId],
      );
      const byQuestion = new Map<number, Solution[]>();
      for (const r of rows) byQuestion.set(num(r.question_id), [...(byQuestion.get(num(r.question_id)) ?? []), solution(r)]);
      return { total: page.total, items: page.items.map((i): HldItem => ({ ...i, url: null, solutions: byQuestion.get(i.id) ?? [] })) };
    },

    listAi: (companyId, { limit, offset }) => categoryPage(companyId, 'ai', limit, offset),

    async getBehavioral(companyId) {
      const topicRows = await run(
        `SELECT bt.slug, bt.name, bt.question_types, bt.typical_round FROM behavioral_topics bt JOIN sources s ON s.id = bt.source_id
         WHERE ${VISIBLE} ORDER BY bt.rowid`, [],
      );
      const topics: Topic[] = topicRows.map((r) => ({
        slug: String(r.slug), name: String(r.name), question_types: str(r.question_types), typical_round: str(r.typical_round),
      }));
      return { values: await values(companyId), topics };
    },

    async getResource(id) {
      const r = await one(
        `SELECT r.id, r.title, r.category, r.url, r.level AS difficulty, r.topics, s.name AS source, s.license,
                CASE WHEN s.display_mode = 'full' THEN r.content_md END AS content_md
         FROM resources r JOIN sources s ON s.id = r.source_id
         WHERE r.id = ? AND r.category IN (${SERVED_CATEGORIES}) AND ${VISIBLE}`, [id],
      );
      if (!r) return null;
      const companies = await run(
        `SELECT DISTINCT c.name, c.slug FROM company_resources cr JOIN companies c ON c.id = cr.company_id WHERE cr.resource_id = ? ORDER BY c.name`, [id],
      );
      const solutions = await run(
        `SELECT qs.title, qs.url, qs.confidence, s.name AS source FROM question_solutions qs JOIN sources s ON s.id = qs.source_id
         WHERE qs.question_id = ? AND qs.approved = 1 AND ${VISIBLE} ORDER BY qs.id`, [id],
      );
      return {
        ...listItem(r), category: apiCategory(String(r.category)), content_md: str(r.content_md),
        source: { name: String(r.source), license: String(r.license) },
        companies: companies.map((c) => ({ name: String(c.name), slug: String(c.slug) })),
        solutions: solutions.map(solution),
      } satisfies ResourceDetail;
    },

    async listSources() {
      const rows = await run(
        `SELECT s.name, s.repo_url, s.license, s.author, s.license_text, s.notice_text, s.adapted, s.adaptation_note
         FROM sources s WHERE ${VISIBLE} ORDER BY s.id`, [],
      );
      return rows.map((r) => ({
        name: String(r.name), repo_url: publicRepoUrl(r.repo_url), license: String(r.license), author: str(r.author),
        license_text: str(r.license_text), notice_text: str(r.notice_text), adapted: num(r.adapted) === 1, adaptation_note: str(r.adaptation_note),
      }));
    },
  };
}
