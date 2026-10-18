/** AI Advisor response shapes (backend/app/api/routes/advisor.py, services/advisor/*). */

export type AdvisorCapabilities = {
  mode: "llm" | "deterministic" | (string & {});
  model: string | null;
  examples: string[];
  tools: { name: string; description: string }[];
  guarantees: string[];
};

export type KeyFigure = {
  label: string;
  value: number | string | null;
  display: string;
  source_ref: string | null;
  verified?: boolean;
};

export type Verification = {
  all_numbers_traced: boolean;
  checked_numbers: number;
  unverified_key_figures: (string | KeyFigure)[];
  unverified_numbers_in_text: (string | number)[];
  method: string;
};

export type AdvisorAnswer = {
  answer: string;
  key_figures: KeyFigure[];
  evidence: { source_ref: string; summary: string }[];
  assumptions: string[];
  limitations: string[];
  confidence: "high" | "medium" | "low" | (string & {});
  confidence_reason: string;
  follow_up_questions: string[];
  verification?: Verification | null;
  mode?: string;
  notice?: string | null;
  model?: string | null;
  data_end?: string | null;
  is_synthetic?: boolean;
};

export type ToolCall = {
  ref: string;
  name: string;
  input: unknown;
  status: "ok" | "denied" | "error" | (string & {});
  error: string | null;
  duration_ms: number | null;
  output: unknown;
};

export type AdvisorMessage = {
  id: number | string;
  role: "user" | "assistant" | (string & {});
  content: string;
  answer: AdvisorAnswer | null;
  mode: string | null;
  tool_calls: ToolCall[] | null;
  created_at: string | null;
};

export type AskResponse = { conversation_id: string; message: AdvisorMessage };

export type ConversationSummary = { id: string; title: string; updated_at: string };

export type Conversation = { id: string; title: string; messages: AdvisorMessage[] };
