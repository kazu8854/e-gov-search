/**
 * Phase 2: 法令検索 Lambda
 * キーワードごとにe-Gov APIで法令を検索
 * Step Functions Map状態で並列実行される
 */

import { searchLawsByName, searchLawsByKeyword } from "../shared/egov-api.mjs";
import { sendStep } from "../shared/appsync-publish.mjs";

export const handler = async (event) => {
  const { searchId, keyword, searchType } = event;

  const stepId = `step-search-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // 検索開始通知
  await sendStep(searchId, {
    id: stepId,
    type: "searching",
    label: `「${keyword}」で${searchType === "keyword" ? "条文内容を横断" : "法令を"}検索中...`,
    status: "active",
    timestamp: Date.now(),
  });

  let results = [];

  try {
    if (searchType === "keyword") {
      const hits = await searchLawsByKeyword(keyword, 5);
      results = hits.map((h) => ({
        law_id: h.law_id,
        law_title: h.law_title,
        law_num: h.law_num,
        law_type: h.law_type || "",
      }));
    } else {
      const laws = await searchLawsByName(keyword, 10);
      results = laws.slice(0, 5).map((l) => ({
        law_id: l.law_id,
        law_title: l.law_title,
        law_num: l.law_num,
        law_type: l.law_type,
      }));
    }

    // 完了通知
    await sendStep(searchId, {
      id: stepId,
      type: "searching",
      label: `「${keyword}」で${searchType === "keyword" ? "横断" : "法令"}検索完了`,
      detail: `${results.length}件ヒット`,
      status: "done",
      timestamp: Date.now(),
      results: results.map((r) => ({
        lawTitle: r.law_title,
        lawId: r.law_id,
      })),
    });
  } catch (err) {
    console.error(`Search error for "${keyword}":`, err);
    await sendStep(searchId, {
      id: stepId,
      type: "searching",
      label: `「${keyword}」の検索でエラー`,
      detail: "検索中にエラーが発生しました",
      status: "error",
      timestamp: Date.now(),
    });
  }

  return { keyword, results };
};
