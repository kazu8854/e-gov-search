/**
 * Phase 2: 法令検索 Lambda（並列実行される）
 */
import { searchLawsByName, searchLawsByKeyword } from "../shared/egov-api.mjs";
import { sendStep } from "../shared/appsync-publish.mjs";

export async function handler(event) {
  const { searchId, keyword, searchType } = event;

  const stepId = `step-${Date.now()}-search-${Math.random().toString(36).slice(2, 6)}`;
  await sendStep(searchId, {
    id: stepId, type: "searching",
    label: `「${keyword}」で法令を検索中...`,
    status: "active", timestamp: Date.now(),
  });

  try {
    const laws = searchType === "keyword"
      ? await searchLawsByKeyword(keyword, 5)
      : await searchLawsByName(keyword, 10);

    await sendStep(searchId, {
      id: stepId, type: "searching",
      label: `「${keyword}」で法令を検索中...`,
      detail: `${laws.length}件の法令がヒット`,
      status: "done", timestamp: Date.now(),
      results: laws.slice(0, 5).map((l) => ({ lawTitle: l.law_title, lawId: l.law_id })),
    });

    return { keyword, laws: laws.slice(0, 5) };
  } catch (e) {
    console.error("Search error:", e);
    await sendStep(searchId, {
      id: stepId, type: "searching",
      label: `「${keyword}」で法令を検索中...`,
      detail: "検索中にエラーが発生しました",
      status: "error", timestamp: Date.now(),
    });
    return { keyword, laws: [] };
  }
}
