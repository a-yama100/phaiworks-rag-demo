// Shape of the backend's /ask response. Kept in one file so the proxy, the page and the
// trace panel cannot drift apart in what they think a match looks like.

export type Match = {
  biomarker: string;
  category: string;
  source: string;
  dense_score: number | null;
  dense_rank: number | null;
  sparse_rank: number | null;
  fused_score: number;
  retrievers: string[];
  answer: string;
};

export type TraceStep = {
  node: "retrieve" | "grade" | "rewrite" | "generate" | "refuse";
  ms: number;
  [key: string]: unknown;
};

export type Cost = {
  input_tokens: number;
  output_tokens: number;
  embedding_tokens_approx: number;
  chat_model: string;
  embed_model: string;
  usd_total: number;
  usd_per_1k_queries: number;
};

export type AskResponse = {
  question: string;
  category: string | null;
  refused: boolean;
  refusal_reason: string;
  answer: string;
  citations: string[];
  uncovered: string;
  matches: Match[];
  queries: string[];
  trace: TraceStep[];
  timing: { total_ms: number };
  cost: Cost;
};

export type EvalMode = {
  mode: string;
  top_k: number;
  in_scope_cases: number;
  out_of_scope_cases: number;
  top1: number;
  mrr: number;
  refusal_accuracy: number;
  median_latency_ms: number;
  by_tag: Record<string, { n: number; passed: number; accuracy: number }>;
  failures: {
    id: string;
    tag: string;
    question: string;
    expect: string | null;
    got: string[];
    best_dense_score: number;
  }[];
} & Record<string, unknown>;

export type EvalResults = {
  generated_at: string;
  config: { embed_model: string; index: string; top_k: number; min_score: number };
  gold_set_size: number;
  modes: { dense: EvalMode; hybrid: EvalMode };
  delta: Record<string, number>;
  threshold_sweep?: {
    threshold: number;
    answered_correctly: number;
    correctly_refused: number;
    combined: number;
  }[];
  generation?: Record<string, number | string>;
};
