/**
 * e-Gov 法令API v2 クライアント
 * https://laws.e-gov.go.jp/api/2/swagger-ui
 *
 * レスポンスはJSON形式（法令XMLをJSONツリーで表現）
 */

const BASE_URL = "https://laws.e-gov.go.jp/api/2";

// ====== API レスポンス型 ======

interface LawListResponse {
  total_count: number;
  count: number;
  next_offset: number;
  laws: LawEntry[];
}

interface LawEntry {
  law_info: {
    law_type: string;
    law_id: string;
    law_num: string;
    promulgation_date: string;
  };
  revision_info: {
    law_revision_id: string;
    law_title: string;
    law_title_kana: string;
    abbrev: string | null;
    category: string;
  };
}

interface LawDataResponse {
  law_info: {
    law_type: string;
    law_id: string;
    law_num: string;
  };
  revision_info: {
    law_title: string;
    abbrev: string | null;
    category: string;
  };
  law_full_text: JsonNode;
}

// JSON法令ツリーのノード型
interface JsonNode {
  tag: string;
  attr: Record<string, string>;
  children: (JsonNode | string)[];
}

// ====== 公開インターフェース ======

export interface EGovLawOverview {
  law_id: string;
  law_num: string;
  law_title: string;
  law_type: string;
  promulgate_date: string;
  category: string;
  abbrev: string | null;
}

// ====== API 関数 ======

/**
 * 法令名で検索（law_title パラメータ）
 */
export async function searchLawsByName(keyword: string, limit = 20): Promise<EGovLawOverview[]> {
  const params = new URLSearchParams({
    law_title: keyword,
    limit: String(limit),
  });
  const res = await fetch(`${BASE_URL}/laws?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`e-Gov API error: ${res.status} ${res.statusText}`);
  }
  const data: LawListResponse = await res.json();
  return (data.laws || []).map((entry) => ({
    law_id: entry.law_info.law_id,
    law_num: entry.law_info.law_num,
    law_title: entry.revision_info.law_title,
    law_type: entry.law_info.law_type,
    promulgate_date: entry.law_info.promulgation_date,
    category: entry.revision_info.category,
    abbrev: entry.revision_info.abbrev,
  }));
}

/**
 * キーワード検索（keyword パラメータ）
 */
export async function searchLawsByKeyword(keyword: string, limit = 10): Promise<EGovLawOverview[]> {
  const params = new URLSearchParams({
    keyword: keyword,
    limit: String(limit),
  });
  const res = await fetch(`${BASE_URL}/laws?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    console.warn("keyword search failed:", res.status);
    return [];
  }
  const data: LawListResponse = await res.json();
  return (data.laws || []).map((entry) => ({
    law_id: entry.law_info.law_id,
    law_num: entry.law_info.law_num,
    law_title: entry.revision_info.law_title,
    law_type: entry.law_info.law_type,
    promulgate_date: entry.law_info.promulgation_date,
    category: entry.revision_info.category,
    abbrev: entry.revision_info.abbrev,
  }));
}

/**
 * 法令全文取得（JSONツリー）
 */
export async function getLawData(lawId: string): Promise<LawDataResponse> {
  const res = await fetch(`${BASE_URL}/law_data/${lawId}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`e-Gov API error for law ${lawId}: ${res.status}`);
  }
  return res.json();
}

/**
 * 法令全文をテキストに変換して取得
 */
export async function getLawContent(lawId: string): Promise<string> {
  const data = await getLawData(lawId);
  const title = data.revision_info.law_title;
  const tree = data.law_full_text;

  const articles = extractArticlesFromTree(tree);
  let result = `# ${title}\n\n`;
  for (const art of articles) {
    result += `${art.title}${art.caption ? `（${art.caption}）` : ""}\n${art.text}\n\n`;
  }

  // 長い場合はトリミング
  if (result.length > 8000) {
    result = result.substring(0, 8000) + "\n\n...（以下省略）";
  }
  return result;
}

/**
 * 特定の条文を取得
 */
export async function getArticle(
  lawId: string,
  articleNum: string
): Promise<{ title: string; text: string } | null> {
  const data = await getLawData(lawId);
  const tree = data.law_full_text;
  const articles = extractArticlesFromTree(tree);

  // 条番号の正規化
  const normalizedNum = normalizeArticleNum(articleNum);

  for (const art of articles) {
    const artNorm = normalizeArticleNum(art.num);
    if (artNorm === normalizedNum) {
      return {
        title: `${art.title}${art.caption ? `（${art.caption}）` : ""}`,
        text: art.text,
      };
    }
  }
  return null;
}

/**
 * 法令の目次を取得
 */
export async function getLawToc(lawId: string): Promise<string> {
  const data = await getLawData(lawId);
  const tree = data.law_full_text;
  return extractTocFromTree(tree);
}

// ====== JSONツリー解析ヘルパー ======

interface ParsedArticle {
  num: string;
  title: string;
  caption: string;
  text: string;
}

function extractArticlesFromTree(node: JsonNode | string): ParsedArticle[] {
  if (typeof node === "string") return [];

  const articles: ParsedArticle[] = [];

  if (node.tag === "Article") {
    const num = node.attr?.Num || "";
    let title = "";
    let caption = "";
    const sentences: string[] = [];

    for (const child of node.children) {
      if (typeof child === "string") continue;
      if (child.tag === "ArticleTitle") {
        title = collectText(child);
      } else if (child.tag === "ArticleCaption") {
        caption = collectText(child).replace(/^（/, "").replace(/）$/, "");
      } else if (child.tag === "Paragraph") {
        const paraText = collectSentences(child);
        if (paraText) sentences.push(paraText);
      }
    }

    articles.push({
      num,
      title: title || `第${num}条`,
      caption,
      text: sentences.join("\n"),
    });
  } else {
    // 再帰的に探索
    for (const child of node.children || []) {
      if (typeof child !== "string") {
        articles.push(...extractArticlesFromTree(child));
      }
    }
  }

  return articles;
}

function extractTocFromTree(node: JsonNode | string): string {
  if (typeof node === "string") return "";

  const lines: string[] = [];

  if (node.tag === "TOC") {
    collectTocLines(node, lines, 0);
    return lines.join("\n");
  }

  // LawBody内のTOCを探す
  for (const child of node.children || []) {
    if (typeof child === "string") continue;
    if (child.tag === "TOC") {
      collectTocLines(child, lines, 0);
      return lines.join("\n");
    }
    // 再帰
    const result = extractTocFromTree(child);
    if (result) return result;
  }

  return "";
}

function collectTocLines(node: JsonNode | string, lines: string[], depth: number): void {
  if (typeof node === "string") return;

  const titleTags = [
    "ChapterTitle", "PartTitle", "SectionTitle", "SubsectionTitle",
    "DivisionTitle", "SupplProvisionLabel",
  ];

  for (const child of node.children || []) {
    if (typeof child === "string") continue;
    if (titleTags.includes(child.tag)) {
      const text = collectText(child).trim();
      if (text) {
        const indent = "  ".repeat(depth);
        lines.push(`${indent}${text}`);
      }
    }
    collectTocLines(child, lines, child.tag.startsWith("TOC") ? depth + 1 : depth);
  }
}

/**
 * ノードからテキストを再帰的に収集
 */
function collectText(node: JsonNode | string): string {
  if (typeof node === "string") return node;
  return (node.children || []).map((c) => collectText(c)).join("");
}

/**
 * Paragraph内のSentenceテキストを収集
 */
function collectSentences(node: JsonNode | string): string {
  if (typeof node === "string") return node;

  const parts: string[] = [];

  if (node.tag === "Sentence") {
    return collectText(node);
  }

  if (node.tag === "ParagraphNum") {
    const num = collectText(node).trim();
    if (num) parts.push(num + " ");
  }

  for (const child of node.children || []) {
    if (typeof child === "string") continue;
    if (child.tag === "Sentence" || child.tag === "ParagraphSentence") {
      parts.push(collectSentences(child));
    } else if (child.tag === "Item") {
      const itemTitle = findChild(child, "ItemTitle");
      const itemSentence = findChild(child, "ItemSentence");
      const title = itemTitle ? collectText(itemTitle) : "";
      const sent = itemSentence ? collectSentences(itemSentence) : "";
      parts.push(`\n  ${title} ${sent}`);
    } else if (child.tag === "ParagraphNum") {
      const num = collectText(child).trim();
      if (num) parts.push(num + " ");
    } else {
      const inner = collectSentences(child);
      if (inner) parts.push(inner);
    }
  }

  return parts.join("");
}

function findChild(node: JsonNode, tag: string): JsonNode | null {
  for (const child of node.children || []) {
    if (typeof child !== "string" && child.tag === tag) return child;
  }
  return null;
}

/**
 * 条番号を正規化
 */
function normalizeArticleNum(num: string): string {
  return num
    .replace(/^第/, "")
    .replace(/条.*$/, "")
    .replace(/の/g, "_")
    .replace(/ー/g, "_")
    .replace(/-/g, "_")
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .trim();
}
