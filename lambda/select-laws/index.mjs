/**
 * Phase 3: 関連度判定 Lambda
 * AIで検索結果から最も関連する法令を選別
 */
import { chatCompletion } from "../shared/bedrock-client.mjs";
import { sendStep } from "../shared/appsync-publish.mjs";

export async function handler(event) {
  const { searchId, query, searchResults } = event;

  // 検索結果をフラット化して重複除去
  const allLaws = new Map();
  for (const result of searchResults) {
    for (const law of result.laws || []) {
      if (!allLaws.has(law.law_id)) {
        allLaws.set(law.law_id, law);
      }
    }
  }

  const lawList = Array.from(allLaws.values());

  if (lawList.length === 0) {
    await sendStep(searchId, {
      id: `step-${Date.now()}-select`, type: "analyzing",
      label: "関連法令が見つかりませんでした",
      status: "error", timestamp: Date.now(),
    });
    return { searchId, query, selectedLaws: [] };
  }

  const stepId = `step-${Date.now()}-select`;
  await sendStep(searchId, {
    id: stepId, type: "analyzing",
    label: `${lawList.length}件の法令からAIが関連度を判定中...`,
    status: "active", timestamp: Date.now(),
  });

  const lawListText = lawList
    .map((l, i) => `${i + 1}. ${l.law_title}（${l.law_num}）[ID: ${l.law_id}]`)
    .join("\n");

  const result = await chatCompletion({
    model: "light",
    temperature: 0,
    jsonMode: true,
    messages: [
      {
        role: "system",
        content: `以下の法令一覧から、ユーザーの質問に最も関連する法令を5件以内で選んでください。
JSON形式で回答:
{ "selectedLaws": [{ "lawId": "...", "lawTitle": "...", "reason": "選んだ理由" }] }`,
      },
      { role: "user", content: `質問: ${query}\n\n法令一覧:\n${lawListText}` },
    ],
  });

  let selectedLaws;
  try {
    selectedLaws = JSON.parse(result).selectedLaws || [];
  } catch {
    selectedLaws = lawList.slice(0, 3).map((l) => ({
      lawId: l.law_id, lawTitle: l.law_title, reason: "検索結果上位",
    }));
  }

  await sendStep(searchId, {
    id: stepId, type: "analyzing",
    label: `${lawList.length}件の法令からAIが関連度を判定中...`,
    detail: `${selectedLaws.length}件の関連法令を特定`,
    status: "done", timestamp: Date.now(),
    results: selectedLaws.map((s) => ({ lawTitle: s.lawTitle, lawId: s.lawId, relevance: s.reason })),
  });

  return { searchId, query, selectedLaws };
}
