// e-Gov法令API v2 の型定義

export interface LawSearchResult {
  lawId: string;
  lawNum: string;
  lawTitle: string;
  lawType: number;
  promulgateDate: string;
}

export interface LawSearchResponse {
  laws: LawSearchResult[];
  totalCount: number;
}

export interface KeywordSearchHit {
  lawId: string;
  lawTitle: string;
  lawNum: string;
  articleTitle: string;
  articleCaption: string;
  text: string;
}

// 探索プロセスのステップ
export type StepType =
  | "thinking"      // AI思考中
  | "searching"     // 法令検索中
  | "reading"       // 条文読み取り中
  | "following"     // 参照先追跡中
  | "analyzing"     // 分析中
  | "summarizing";  // まとめ作成中

export interface SearchStep {
  id: string;
  type: StepType;
  label: string;
  detail?: string;
  status: "active" | "done" | "error";
  timestamp: number;
  results?: StepResult[];
  children?: SearchStep[];
}

export interface StepResult {
  lawTitle: string;
  lawId?: string;
  articleNumber?: string;
  excerpt?: string;
  relevance?: string;
}

export interface SearchEvent {
  type: "step" | "result" | "conclusion" | "error";
  data: SearchStep | ConclusionData | { message: string };
}

export interface ConclusionData {
  summary: string;
  relevantLaws: RelevantLaw[];
  keyPoints: string[];
}

export interface RelevantLaw {
  lawTitle: string;
  lawId: string;
  articles: {
    number: string;
    title: string;
    text: string;
    relevance: string;
  }[];
}

// SSEイベント
export interface SSEEvent {
  event: string;
  data: string;
}
