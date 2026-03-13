/**
 * e-Gov 法令API v2 クライアント（Lambda用ESM版）
 */

const BASE_URL = "https://laws.e-gov.go.jp/api/2";

/**
 * 法令名キーワード検索
 */
export async function searchLawsByName(keyword, limit = 20) {
  const params = new URLSearchParams({ keyword, limit: String(limit) });
  const res = await fetch(`${BASE_URL}/laws?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`e-Gov API error: ${res.status}`);
  const data = await res.json();
  return data.laws || [];
}

/**
 * 法令本文キーワード横断検索
 */
export async function searchLawsByKeyword(keyword, limit = 10) {
  const params = new URLSearchParams({ keyword, limit: String(limit) });
  const res = await fetch(`${BASE_URL}/keyword?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.hits || [];
}

/**
 * 法令全文取得（XML）
 */
export async function getLawFullText(lawId) {
  const res = await fetch(`${BASE_URL}/laws/${lawId}`, {
    headers: { Accept: "application/xml" },
  });
  if (!res.ok) throw new Error(`e-Gov API error for ${lawId}: ${res.status}`);
  return res.text();
}

/**
 * 法令全文テキスト取得
 */
export async function getLawContent(lawId) {
  const xml = await getLawFullText(lawId);
  return extractTextFromXml(xml);
}

/**
 * 特定条文を取得
 */
export async function getArticle(lawId, articleNum) {
  const xml = await getLawFullText(lawId);
  return extractArticleFromXml(xml, articleNum);
}

/**
 * 法令の目次取得
 */
export async function getLawToc(lawId) {
  const xml = await getLawFullText(lawId);
  return extractTocFromXml(xml);
}

// --- XML パーサー ---

function stripTags(html) {
  return html.replace(/<[^>]+>/g, "").trim();
}

function extractTextFromXml(xml) {
  const titleMatch = xml.match(/<LawTitle[^>]*>([^<]+)<\/LawTitle>/);
  const lawTitle = titleMatch ? titleMatch[1] : "";

  const articles = [];
  const articleRegex = /<Article\s[^>]*Num="([^"]*)"[^>]*>([\s\S]*?)<\/Article>/g;
  let match;
  while ((match = articleRegex.exec(xml)) !== null) {
    const content = match[2];
    const captionM = content.match(/<ArticleCaption[^>]*>([\s\S]*?)<\/ArticleCaption>/);
    const titleM = content.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/);
    const caption = captionM ? stripTags(captionM[1]) : "";
    const artTitle = titleM ? stripTags(titleM[1]) : `第${match[1]}条`;

    const sentences = [];
    const sentenceRegex = /<Sentence[^>]*>([\s\S]*?)<\/Sentence>/g;
    let sm;
    while ((sm = sentenceRegex.exec(content)) !== null) {
      sentences.push(stripTags(sm[1]).trim());
    }

    const text = sentences.join("");
    if (text) {
      articles.push(`${artTitle}${caption ? `（${caption}）` : ""}\n${text}`);
    }
  }

  let result = `# ${lawTitle}\n\n${articles.join("\n\n")}`;
  if (result.length > 8000) {
    result = result.substring(0, 8000) + "\n\n...（以下省略）";
  }
  return result;
}

function extractArticleFromXml(xml, articleNum) {
  const normalizedNum = articleNum
    .replace(/^第/, "").replace(/条.*$/, "")
    .replace(/の/g, "_")
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));

  const articleRegex = /<Article\s[^>]*Num="([^"]*)"[^>]*>([\s\S]*?)<\/Article>/g;
  let match;
  while ((match = articleRegex.exec(xml)) !== null) {
    const num = match[1];
    if (num === normalizedNum || num === articleNum || `${num}` === `${normalizedNum}`) {
      const content = match[2];
      const titleM = content.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/);
      const captionM = content.match(/<ArticleCaption[^>]*>([\s\S]*?)<\/ArticleCaption>/);

      const sentences = [];
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

function extractTocFromXml(xml) {
  const tocLines = [];
  const parts = [
    { tag: "Part", prefix: "編" },
    { tag: "Chapter", prefix: "章" },
    { tag: "Section", prefix: "節" },
  ];

  for (const { tag } of parts) {
    const regex = new RegExp(`<${tag}Title[^>]*>([\\s\\S]*?)<\\/${tag}Title>`, "g");
    let m;
    while ((m = regex.exec(xml)) !== null) {
      const title = stripTags(m[1]).trim();
      if (title) {
        const indent = tag === "Part" ? "" : tag === "Chapter" ? "  " : "    ";
        tocLines.push(`${indent}${title}`);
      }
    }
  }

  if (tocLines.length === 0) {
    const captionRegex = /<ArticleCaption[^>]*>([\s\S]*?)<\/ArticleCaption>/g;
    let m;
    while ((m = captionRegex.exec(xml)) !== null) {
      const cap = stripTags(m[1]).trim();
      if (cap) tocLines.push(`  ${cap}`);
    }
  }

  return tocLines.join("\n");
}
