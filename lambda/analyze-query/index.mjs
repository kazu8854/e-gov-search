/**
 * Phase 1: クエリ分析 Lambda
 * 自然言語の質問からキーワードを抽出する
 */
import { chatCompletion } from "../shared/bedrock-client.mjs";
import { sendStep } from "../shared/appsync-publish.mjs";

export async function handler(event) {
  const { searchId, query } = event;

  const stepId = `step-${Date.now()}-analyze`;
  await sendStep(searchId, {
    id: stepId, type: "thinking", label: "質問を分析中...", detail: query, status: "active", timestamp: Date.now(),
  });

  const result = await chatCompletion({
    model: "light",
    temperature: 0,
    jsonMode: true,
    messages: [
      {
        role: "system",
        content: `あなたは日本法の専門家です。ユーザーの質問を分析し、e-Gov法令APIで検索するためのキーワードを抽出してください。
JSON形式で回答:
{
  "keywords": ["法令名検索用キーワード（法律名や法分野名）"],
  "searchTerms": ["条文内容検索用キーワード（具体的な法律用語）"],
  "legalAreas": ["関連する法分野"]
}`,
      },
      { role: "user", content: query.substring(0, 500) },
    ],
  });

  let analysis;
  try {
    analysis = JSON.parse(result);
  } catch {
    analysis = { keywords: [query], searchTerms: [query], legalAreas: ["一般"] };
  }

  await sendStep(searchId, {
    id: stepId, type: "thinking",
    label: "質問を分析中...",
    detail: `キーワード: ${analysis.keywords.join(", ")}\n関連法分野: ${analysis.legalAreas.join(", ")}`,
    status: "done", timestamp: Date.now(),
  });

  return { searchId, query, analysis };
}
