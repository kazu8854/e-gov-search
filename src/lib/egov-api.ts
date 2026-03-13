/**
 * e-Gov 法令API v2 クライアント
 * https://laws.e-gov.go.jp/api/2/swagger-ui
 */

const BASE_URL = "https://laws.e-gov.go.jp/api/2";

export interface EGovLawOverview {
  law_id: string;
  law_num: string;
  law_title: string;
  law_type: number;
  promulgate_date: string;
  amendment_id?: string;
  amendment_promulgate_date?: string;
}

export interface EGovKeywordHit {
  law_id: string;
  law_title: string;
  law_num: string;
  law_type: number;
  article_info: string;
  text_snippet: string;
}

export interface EGovLawData {
  law_info: {
    law_id: string;
    law_num: string;
    law_title: string;
    law_type: number;
  };
  law_full_text?: string;
  toc?: TocItem[];
  articles?: ArticleData[];
}

export interface TocItem {
  title: string;
  article_range?: string;
  children?: TocItem[];
}

export interface ArticleData {
  article_num: string;
  article_title: string;
  article_caption: string;
  article_text: string;
}

/**
 * 法令名キーワード検索
 */
export async function searchLawsByName(keyword: string, limit = 20): Promise<EGovLawOverview[]> {
  const params = new URLSearchParams({ keyword, limit: String(limit) });
  const res = await fetch(`${BASE_URL}/laws?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`e-Gov API error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.laws || [];
}

/**
 * 法令本文のキーワード検索（横断検索）
 */
export async function searchLawsByKeyword(keyword: string, limit = 10): Promise<EGovKeywordHit[]> {
  const params = new URLSearchParams({ keyword, limit: String(limit) });
  const res = await fetch(`${BASE_URL}/keyword?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    // キーワード検索がない場合はフォールバック
    console.warn("keyword endpoint not available, using law name search");
    return [];
  }
  const data = await res.json();
  return data.hits || [];
}

/**
 * 法令全文取得（XML形式）
 */
export async function getLawFullText(lawId: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/laws/${lawId}`, {
    headers: { Accept: "application/xml" },
  });
  if (!res.ok) {
    throw new Error(`e-Gov API error for law ${lawId}: ${res.status}`);
  }
  return res.text();
}

/**
 * 法令全文取得（テキスト変換済み）
 */
export async function getLawContent(lawId: string): Promise<string> {
  const xml = await getLawFullText(lawId);
  return extractTextFromXml(xml);
}

/**
 * 特定の条文を抽出
 */
export async function getArticle(
  lawId: string,
  articleNum: string
): Promise<{ title: string; text: string } | null> {
  const xml = await getLawFullText(lawId);
  return extractArticleFromXml(xml, articleNum);
}

/**
 * 法令の目次（構造）を取得
 */
export async function getLawToc(lawId: string): Promise<string> {
  const xml = await getLawFullText(lawId);
  return extractTocFromXml(xml);
}

/**
 * XMLからテキストを抽出（簡易パーサー）
 */
function extractTextFromXml(xml: string): string {
  // LawTitle
  const titleMatch = xml.match(/<LawTitle[^>]*>([^<]+)<\/LawTitle>/);
  const lawTitle = titleMatch ? titleMatch[1] : "";

  // 条文を抽出
  const articles: string[] = [];
  const articleRegex =
    /<Article\s[^>]*Num="([^"]*)"[^>]*>([\s\S]*?)<\/Article>/g;
  let match;
  while ((match = articleRegex.exec(xml)) !== null) {
    const articleNum = match[1];
    const articleContent = match[2];

    // ArticleTitle / ArticleCaption
    const captionMatch = articleContent.match(
      /<ArticleCaption[^>]*>([\s\S]*?)<\/ArticleCaption>/
    );
    const titleM = articleContent.match(
      /<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/
    );

    const caption = captionMatch ? stripTags(captionMatch[1]) : "";
    const artTitle = titleM ? stripTags(titleM[1]) : `第${articleNum}条`;

    // Paragraph / Sentence
    const sentences: string[] = [];
    const sentenceRegex =
      /<Sentence[^>]*>([\s\S]*?)<\/Sentence>/g;
    let sm;
    while ((sm = sentenceRegex.exec(articleContent)) !== null) {
      sentences.push(stripTags(sm[1]).trim());
    }

    const text = sentences.join("");
    if (text) {
      articles.push(
        `${artTitle}${caption ? `（${caption}）` : ""}\n${text}`
      );
    }
  }

  // 5000文字以上はトリミング
  let result = `# ${lawTitle}\n\n${articles.join("\n\n")}`;
  if (result.length > 8000) {
    result = result.substring(0, 8000) + "\n\n...（以下省略）";
  }
  return result;
}

/**
 * XMLから特定条文を抽出
 */
function extractArticleFromXml(
  xml: string,
  articleNum: string
): { title: string; text: string } | null {
  // 条番号の正規化
  const normalizedNum = articleNum
    .replace(/^第/, "")
    .replace(/条.*$/, "")
    .replace(/の/g, "_")
    .replace(/[０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    );

  const articleRegex =
    /<Article\s[^>]*Num="([^"]*)"[^>]*>([\s\S]*?)<\/Article>/g;
  let match;
  while ((match = articleRegex.exec(xml)) !== null) {
    const num = match[1];
    if (num === normalizedNum || num === articleNum || `${num}` === `${normalizedNum}`) {
      const content = match[2];
      const titleM = content.match(
        /<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/
      );
      const captionM = content.match(
        /<ArticleCaption[^>]*>([\s\S]*?)<\/ArticleCaption>/
      );

      const sentences: string[] = [];
      const sentenceRegex = /<Sentence[^>]*>([\s\S]*?)<\/Sentence>/g;
      let sm;
      while ((sm = sentenceRegex.exec(content)) !== null) {
        sentences.push(stripTags(sm[1]).trim());
      }

      const title = titleM ? stripTags(titleM[1]) : `第${articleNum}条`;
      const caption = captionM ? stripTags(captionM[1]) : "";

      return {
        title: `${title}${caption ? `（${caption}）` : ""}`,
        text: sentences.join(""),
      };
    }
  }
  return null;
}

/**
 * XMLから目次を抽出
 */
function extractTocFromXml(xml: string): string {
  const tocLines: string[] = [];

  // Part / Chapter / Section
  const parts = [
    { tag: "Part", prefix: "編" },
    { tag: "Chapter", prefix: "章" },
    { tag: "Section", prefix: "節" },
  ];

  for (const { tag, prefix } of parts) {
    const regex = new RegExp(
      `<${tag}Title[^>]*>([\\s\\S]*?)<\\/${tag}Title>`,
      "g"
    );
    let m;
    while ((m = regex.exec(xml)) !== null) {
      const title = stripTags(m[1]).trim();
      if (title) {
        const indent = tag === "Part" ? "" : tag === "Chapter" ? "  " : "    ";
        tocLines.push(`${indent}${title}`);
      }
    }
  }

  // ArticleCaptionを使ったTOC
  if (tocLines.length === 0) {
    const captionRegex =
      /<ArticleCaption[^>]*>([\s\S]*?)<\/ArticleCaption>/g;
    let m;
    while ((m = captionRegex.exec(xml)) !== null) {
      const cap = stripTags(m[1]).trim();
      if (cap) tocLines.push(`  ${cap}`);
    }
  }

  return tocLines.join("\n");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}
