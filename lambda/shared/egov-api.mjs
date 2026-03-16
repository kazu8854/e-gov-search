/**
 * e-Gov 法令API v2 クライアント（Lambda用ESM版）
 * JSON形式のレスポンスに対応
 */

const BASE_URL = "https://laws.e-gov.go.jp/api/2";

/**
 * 法令名キーワード検索
 */
export async function searchLawsByName(keyword, limit = 20) {
  const params = new URLSearchParams({ law_title: keyword, limit: String(limit) });
  const res = await fetch(`${BASE_URL}/laws?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`e-Gov API error: ${res.status}`);
  const data = await res.json();
  return (data.laws || []).map((entry) => ({
    law_id: entry.law_info.law_id,
    law_num: entry.law_info.law_num,
    law_title: entry.revision_info.law_title,
    law_type: entry.law_info.law_type,
  }));
}

/**
 * 法令本文キーワード横断検索
 */
export async function searchLawsByKeyword(keyword, limit = 10) {
  const params = new URLSearchParams({ keyword, limit: String(limit) });
  const res = await fetch(`${BASE_URL}/laws?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.laws || []).map((entry) => ({
    law_id: entry.law_info.law_id,
    law_num: entry.law_info.law_num,
    law_title: entry.revision_info.law_title,
    law_type: entry.law_info.law_type,
  }));
}

/**
 * 法令全文取得（JSON）
 */
export async function getLawData(lawId) {
  const res = await fetch(`${BASE_URL}/law_data/${lawId}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`e-Gov API error for ${lawId}: ${res.status}`);
  return res.json();
}

/**
 * 法令全文テキスト取得
 */
export async function getLawContent(lawId) {
  const data = await getLawData(lawId);
  const title = data.revision_info.law_title;
  const tree = data.law_full_text;

  const articles = extractArticlesFromTree(tree);
  let result = `# ${title}\n\n`;
  for (const art of articles) {
    result += `${art.title}${art.caption ? `（${art.caption}）` : ""}\n${art.text}\n\n`;
  }

  if (result.length > 8000) {
    result = result.substring(0, 8000) + "\n\n...（以下省略）";
  }
  return result;
}

/**
 * 特定条文を取得
 */
export async function getArticle(lawId, articleNum) {
  const data = await getLawData(lawId);
  const tree = data.law_full_text;
  const articles = extractArticlesFromTree(tree);

  const normalizedNum = normalizeArticleNum(articleNum);
  for (const art of articles) {
    if (normalizeArticleNum(art.num) === normalizedNum) {
      return {
        title: `${art.title}${art.caption ? `（${art.caption}）` : ""}`,
        text: art.text,
      };
    }
  }
  return null;
}

/**
 * 法令の目次取得
 */
export async function getLawToc(lawId) {
  const data = await getLawData(lawId);
  const tree = data.law_full_text;
  return extractTocFromTree(tree);
}

// --- JSONツリー解析ヘルパー ---

function extractArticlesFromTree(node) {
  if (typeof node === "string") return [];
  const articles = [];

  if (node.tag === "Article") {
    const num = node.attr?.Num || "";
    let title = "";
    let caption = "";
    const sentences = [];

    for (const child of node.children || []) {
      if (typeof child === "string") continue;
      if (child.tag === "ArticleTitle") title = collectText(child);
      else if (child.tag === "ArticleCaption") {
        caption = collectText(child).replace(/^（/, "").replace(/）$/, "");
      } else if (child.tag === "Paragraph") {
        const paraText = collectSentences(child);
        if (paraText) sentences.push(paraText);
      }
    }

    articles.push({ num, title: title || `第${num}条`, caption, text: sentences.join("\n") });
  } else {
    for (const child of node.children || []) {
      if (typeof child !== "string") articles.push(...extractArticlesFromTree(child));
    }
  }
  return articles;
}

function extractTocFromTree(node) {
  if (typeof node === "string") return "";
  const lines = [];

  if (node.tag === "TOC") {
    collectTocLines(node, lines, 0);
    return lines.join("\n");
  }

  for (const child of node.children || []) {
    if (typeof child === "string") continue;
    if (child.tag === "TOC") {
      collectTocLines(child, lines, 0);
      return lines.join("\n");
    }
    const result = extractTocFromTree(child);
    if (result) return result;
  }
  return "";
}

function collectTocLines(node, lines, depth) {
  if (typeof node === "string") return;
  const titleTags = ["ChapterTitle", "PartTitle", "SectionTitle", "SubsectionTitle", "DivisionTitle", "SupplProvisionLabel"];

  for (const child of node.children || []) {
    if (typeof child === "string") continue;
    if (titleTags.includes(child.tag)) {
      const text = collectText(child).trim();
      if (text) lines.push(`${"  ".repeat(depth)}${text}`);
    }
    collectTocLines(child, lines, child.tag.startsWith("TOC") ? depth + 1 : depth);
  }
}

function collectText(node) {
  if (typeof node === "string") return node;
  return (node.children || []).map((c) => collectText(c)).join("");
}

function collectSentences(node) {
  if (typeof node === "string") return node;
  const parts = [];

  if (node.tag === "Sentence") return collectText(node);
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

function findChild(node, tag) {
  for (const child of node.children || []) {
    if (typeof child !== "string" && child.tag === tag) return child;
  }
  return null;
}

function normalizeArticleNum(num) {
  return num
    .replace(/^第/, "").replace(/条.*$/, "")
    .replace(/の/g, "_").replace(/ー/g, "_").replace(/-/g, "_")
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .trim();
}
