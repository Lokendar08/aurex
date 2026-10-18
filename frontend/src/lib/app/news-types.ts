/** Market news shapes (backend/app/services/news.py article_out, GET /news/sources). */

export type ReportedFacts = { text: string | null; method: string | null; label: string | null };

export type AiInterpretation = { text: string; model: string | null; generated_at: string | null; label: string };

export type NewsArticle = {
  id: string;
  title: string;
  url: string | null;
  source_name: string | null;
  published_at: string | null;
  entity_keys: string[] | null;
  is_official_announcement: boolean;
  verified: boolean;
  reported_facts: ReportedFacts | null;
  ai_interpretation: AiInterpretation | null;
  duplicate_of: string | null;
  duplicate_count: number;
};

export type NewsResponse = { total: number; limit: number; offset: number; articles: NewsArticle[] };

export type NewsSource = {
  id: string;
  name: string;
  type: string;
  url: string | null;
  companies: string[] | null;
  active: boolean;
  verified_working: boolean | null;
  last_fetched_at: string | null;
  last_status: string | null;
  notes: string | null;
};

export type NewsSourcesResponse = { fetch_enabled: boolean; sources: NewsSource[] };
