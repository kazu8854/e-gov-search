/**
 * Phase 4: 条文深掘り Lambda（法令ごとに並列実行）
 */
import { getLawContent, getArticle, getLawToc } from "../shared/egov-api.mjs";
import { chatCompletion } from "../shared/openai-client.mjs";
import { sendStep } from "../shared/appsync-publish.mjs";

export async function handler(event) {
  const { searchId, query, law } = event;

  const readStepId = `step-${Date.now()}-read-${Math.random().toString(36).slice(2, 6)}`;
  await sendStep(searchId, {
    id: readStepId, type: "reading",
    label: `${law.lawTitle}の目次・構造を確認中...`,
    status: "active", timestamp: Date.now(),
  });

  try {
    const toc = await getLawToc(law.lawId);
    await sendStep(searchId, {
      id: readStepId, type: "reading",
      label: `${law.lawTitle}の目次・構造を確認中...`,
      detail: toc ? `構造:\n${toc.substring(0, 300)}` : "目次情報なし",
      status: "done", timestamp: Date.now(),
    });

    // 法令内容を取得してAIに関連条文を特定させる
    const articleStepId = `step-${Date.now()}-articles-${Math.random().toString(36).slice(2, 6)}`;
    await sendStep(searchId, {
      id: articleStepId, type: "reading",
      label: `${law.lawTitle}から関連条文を探索中...`,
      status: "active", timestamp: Date.now(),
    });

    const lawContent = await getLawContent(law.lawId);

    const result = await chatCompletion({
      model: "gpt-4o-mini",
      temperature: 0,
      jsonMode: true,
      messages: [
        {
          role: "system",
          content: `法令の内容から、ユーザーの質問に関連する条文番号を特定してください。
JSON形式で回答: { "articles": [{ "number": "条番号（数字のみ）", "reason": "関連する理由" }] }
最大5件まで。`,
        },
        { role: "user", content: `質問: ${query}\n\n法令: ${law.lawTitle}\n\n内容（抜粋）:\n${lawContent.substring(0, 4000)}` },
      ],
    });

    let articleNums;
    try {
      articleNums = JSON.parse(result).articles || [];
    } catch {
      articleNums = [];
    }

    const articles = [];
    for (const artNum of articleNums.slice(0, 5)) {
      const art = await getArticle(law.lawId, artNum.number);
      if (art) {
        articles.push({
          number: artNum.number,
          title: art.title,
          text: art.text.substring(0, 500),
          relevance: artNum.reason,
        });
      }
    }

    await sendStep(searchId, {
      id: articleStepId, type: "reading",
      label: `${law.lawTitle}から関連条文を探索中...`,
      detail: `${articles.length}件の関連条文を取得`,
      status: "done", timestamp: Date.now(),
      results: articles.map((a) => ({
        lawTitle: law.lawTitle,
        articleNumber: a.number,
        excerpt: a.text.substring(0, 100) + "...",
        relevance: a.relevance,
      })),
    });

    return {
      lawTitle: law.lawTitle,
      lawId: law.lawId,
      articles,
    };
  } catch (e) {
    console.error("Read articles error:", e);
    await sendStep(searchId, {
      id: readStepId, type: "reading",
      label: `${law.lawTitle}の目次・構造を確認中...`,
      detail: "取得エラー",
      status: "error", timestamp: Date.now(),
    });
    return { lawTitle: law.lawTitle, lawId: law.lawId, articles: [] };
  }
}
