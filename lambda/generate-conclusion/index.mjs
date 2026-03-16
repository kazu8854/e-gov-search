/**
 * Phase 5: 結論生成 Lambda
 */
import { chatCompletion } from "../shared/openai-client.mjs";
import { sendConclusion, sendDone } from "../shared/appsync-publish.mjs";
import { sendStep } from "../shared/appsync-publish.mjs";

export async function handler(event) {
  const { searchId, query, articleResults } = event;

  const stepId = `step-${Date.now()}-conclude`;
  await sendStep(searchId, {
    id: stepId, type: "summarizing",
    label: "調査結果をまとめ中...",
    status: "active", timestamp: Date.now(),
  });

  const relevantLaws = (articleResults || []).filter((r) => r.articles && r.articles.length > 0);

  const lawContext = relevantLaws
    .map((law) => {
      const arts = law.articles
        .map((a) => `  ${a.title}\n  ${a.text}\n  (関連: ${a.relevance})`)
        .join("\n\n");
      return `【${law.lawTitle}】\n${arts}`;
    })
    .join("\n\n---\n\n");

  const result = await chatCompletion({
    model: "gpt-4o",
    temperature: 0.3,
    jsonMode: true,
    messages: [
      {
        role: "system",
        content: `あなたは日本法の専門家です。調査した法令情報をもとに結論をまとめてください。
JSON形式:
{
  "summary": "質問に対する総合的な回答（マークダウン形式、500〜1000文字）",
  "keyPoints": ["重要ポイント1", ...],
  "relevantLaws": [{ "lawTitle": "法令名", "lawId": "ID", "articles": [{ "number": "条番号", "title": "タイトル", "text": "条文抜粋", "relevance": "関連性" }] }]
}
注意: 法的助言ではなく情報提供であることを明記。`,
      },
      { role: "user", content: `質問: ${query}\n\n調査した法令情報:\n${lawContext}` },
    ],
  });

  let conclusion;
  try {
    conclusion = JSON.parse(result);
  } catch {
    conclusion = { summary: "結論の生成に失敗しました。", keyPoints: [], relevantLaws };
  }

  await sendStep(searchId, {
    id: stepId, type: "summarizing",
    label: "調査結果をまとめ中...",
    status: "done", timestamp: Date.now(),
  });

  await sendConclusion(searchId, conclusion);
  await sendDone(searchId);

  return { searchId, conclusion };
}
