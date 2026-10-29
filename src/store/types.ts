export type ApiCategory = 'dsa' | 'hld' | 'ai' | 'behavioral';
export type Counts = Record<ApiCategory, number>;
export type TimeWindow = '30d' | '3m' | '6m' | '6m+' | 'all';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Page<T> {
  items: T[];
  total: number;
}

export interface Paging {
  limit: number;
  offset: number;
}

export interface CompanyRef {
  id: number;
  name: string;
  slug: string;
  counts: Counts;
}

export interface CompanySummary {
  name: string;
  slug: string;
  counts: Counts;
}

export interface Profile {
  summary: string;
  rounds: unknown[];
  other_steps: string[];
  confidence: 'high' | 'medium' | 'low';
  level: string | null;
  notes: string | null;
  source_urls: string[];
  last_reviewed: string;
}

export interface Value {
  name: string;
  blurb: string | null;
  official_source_url: string | null;
}

export interface Topic {
  slug: string;
  name: string;
  question_types: string | null;
  typical_round: string | null;
}

export interface SourceCredit {
  name: string;
  repo_url: string;
  license: string;
  author: string | null;
  license_text: string | null;
  notice_text: string | null;
  adapted: boolean;
  adaptation_note: string | null;
}

export interface CompanyDetail {
  name: string;
  slug: string;
  profile: Profile | null;
  categories: Counts;
  values: Value[];
  sources: { name: string; repo_url: string; license: string }[];
}

export interface DsaItem {
  id: number;
  title: string;
  url: string | null;
  difficulty: Difficulty | null;
  topics: string[];
  frequency: number | null;
}

export interface Solution {
  title: string;
  url: string;
  confidence: string;
  source: string;
}

export interface ListItem {
  id: number;
  title: string;
  url: string | null;
  difficulty: string | null;
  topics: string[];
}

export interface HldItem extends ListItem {
  url: null;
  solutions: Solution[];
}

export interface ResourceDetail extends ListItem {
  category: ApiCategory;
  content_md: string | null;
  source: { name: string; license: string };
  companies: { name: string; slug: string }[];
  solutions: Solution[];
}

export interface DsaQuery extends Paging {
  timeWindow: TimeWindow;
  difficulty?: Difficulty;
  topic?: string;
}

export interface DataStore {
  listCompanies(q: string | undefined, paging: Paging): Promise<Page<CompanySummary>>;
  findCompany(slug: string): Promise<CompanyRef | null>;
  getCompany(company: CompanyRef): Promise<CompanyDetail>;
  listDsa(companyId: number, query: DsaQuery): Promise<Page<DsaItem>>;
  listHld(companyId: number, paging: Paging): Promise<Page<HldItem>>;
  listAi(companyId: number, paging: Paging): Promise<Page<ListItem>>;
  getBehavioral(companyId: number): Promise<{ values: Value[]; topics: Topic[] }>;
  getResource(id: number): Promise<ResourceDetail | null>;
  listSources(): Promise<SourceCredit[]>;
}
