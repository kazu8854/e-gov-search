/**
 * AI法令探索エンジン
 * 自然言語のクエリから多段階で法令を探索し、
 * 各ステップをSSEでストリーミング配信する
 */

import OpenAI from "openai";
import * as egov from "./egov-api";
import type { SearchStep, ConclusionData, RelevantLaw } from "@/types";

function getOpenAI(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

type EmitFn = (event: string, data: unknown) => void;

function makeStep(
  type: SearchStep["type"],
  label: string,
  detail?: string
): SearchStep {
  return {
    id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    label,
    detail,
    status: "active",
    timestamp: Date.now(),
  };
}

/**
 * メイン探索関数
 */
export async function runSearch(query: string, emit: EmitFn): Promise<void> {
  // ====== Phase 1: クエリ分析 ======
  const thinkStep = makeStep("thinking", "質問を分析中...", query);
  emit("step", thinkStep);

  const analysis = await analyzeQuery(query);
  thinkStep.status = "done";
  thinkStep.detail = `キーワード: ${analysis.keywords.join(", ")}\n関連法分野: ${analysis.legalAreas.join(", ")}`;
  emit("step", thinkStep);

  // ====== Phase 2: 法令検索 ======
  const allResults: Map<string, { law: egov.EGovLawOverview; relevance: string }> = new Map();

  for (const keyword of analysis.keywords) {
    const searchStep = makeStep(
      "searching",
      `「${keyword}」で法令を検索中...`
    );
    emit("step", searchStep);

    try {
      const laws = await egov.searchLawsByName(keyword, 10);
      searchStep.status = "done";
      searchStep.results = laws.slice(0, 5).map((l) => ({
        lawTitle: l.law_title,
        lawId: l.law_id,
      }));
      searchStep.detail = `${laws.length}件の法令がヒット`;
      emit("step", searchStep);

      // 関連度の高い法令を保存
      for (const law of laws.slice(0, 5)) {
        if (!allResults.has(law.law_id)) {
          allResults.set(law.law_id, { law, relevance: keyword });
        }
      }
    } catch (e) {
      searchStep.status = "error";
      searchStep.detail = `検索エラー: ${e instanceof Error ? e.message : "不明なエラー"}`;
      emit("step", searchStep);
    }
  }

  // キーワード横断検索も試す
  for (const keyword of analysis.searchTerms.slice(0, 3)) {
    const kwStep = makeStep(
      "searching",
      `「${keyword}」で条文内容を横断検索中...`
    );
    emit("step", kwStep);

    try {
      const hits = await egov.searchLawsByKeyword(keyword, 5);
      if (hits.length > 0) {
        kwStep.status = "done";
        kwStep.results = hits.map((h) => ({
          lawTitle: h.law_title,
          lawId: h.law_id,
          excerpt: h.text_snippet,
        }));
        kwStep.detail = `${hits.length}件の条文がヒット`;
        emit("step", kwStep);

        for (const hit of hits) {
          if (!allResults.has(hit.law_id)) {
            // 概要情報を作成
            allResults.set(hit.law_id, {
              law: {
                law_id: hit.law_id,
                law_title: hit.law_title,
                law_num: hit.law_num,
                law_type: hit.law_type,
                promulgate_date: "",
              },
              relevance: keyword,
            });
          }
        }
      } else {
        kwStep.status = "done";
        kwStep.detail = "該当なし";
        emit("step", kwStep);
      }
    } catch {
      kwStep.status = "done";
      kwStep.detail = "横断検索は利用できませんでした";
      emit("step", kwStep);
    }
  }

  if (allResults.size === 0) {
    emit("error", { message: "関連する法令が見つかりませんでした。別のキーワードでお試しください。" });
    return;
  }

  // ====== Phase 3: AIで関連度の高い法令を選別 ======
  const filterStep = makeStep(
    "analyzing",
    `${allResults.size}件の法令からAIが関連度を判定中...`
  );
  emit("step", filterStep);

  const lawList = Array.from(allResults.values());
  const selectedLaws = await selectRelevantLaws(query, lawList);
  filterStep.status = "done";
  filterStep.detail = `${selectedLaws.length}件の関連法令を特定`;
  filterStep.results = selectedLaws.map((s) => ({
    lawTitle: s.lawTitle,
    lawId: s.lawId,
    relevance: s.reason,
  }));
  emit("step", filterStep);

  // ====== Phase 4: 各法令の関連条文を深掘り ======
  const relevantLaws: RelevantLaw[] = [];

  for (const selected of selectedLaws.slice(0, 5)) {
    const readStep = makeStep(
      "reading",
      `${selected.lawTitle}の目次・構造を確認中...`
    );
    emit("step", readStep);

    try {
      // 目次取得
      const toc = await egov.getLawToc(selected.lawId);
      readStep.detail = toc ? `構造:\n${toc.substring(0, 300)}` : "目次情報なし";
      readStep.status = "done";
      emit("step", readStep);

      // AIに関連条文番号を特定させる
      const articleStep = makeStep(
        "reading",
        `${selected.lawTitle}から関連条文を探索中...`
      );
      emit("step", articleStep);

      const lawContent = await egov.getLawContent(selected.lawId);
      const articleNums = await identifyRelevantArticles(
        query,
        selected.lawTitle,
        lawContent
      );

      const articles: RelevantLaw["articles"] = [];
      for (const artNum of articleNums.slice(0, 5)) {
        const art = await egov.getArticle(selected.lawId, artNum.number);
        if (art) {
          articles.push({
            number: artNum.number,
            title: art.title,
            text: art.text.substring(0, 500),
            relevance: artNum.reason,
          });
        }
      }

      articleStep.status = "done";
      articleStep.detail = `${articles.length}件の関連条文を取得`;
      articleStep.results = articles.map((a) => ({
        lawTitle: selected.lawTitle,
        articleNumber: a.number,
        excerpt: a.text.substring(0, 100) + "...",
        relevance: a.relevance,
      }));
      emit("step", articleStep);

      if (articles.length > 0) {
        relevantLaws.push({
          lawTitle: selected.lawTitle,
          lawId: selected.lawId,
          articles,
        });
      }

      // ====== Phase 4.5: 参照先の法令も追跡 ======
      const refTexts = articles
        .map((a) => a.text)
        .join(" ");
      const references = extractLawReferences(refTexts);
      if (references.length > 0) {
        const followStep = makeStep(
          "following",
          `${selected.lawTitle}の条文から参照されている法令を追跡中...`,
          `参照先: ${references.join(", ")}`
        );
        emit("step", followStep);

        for (const ref of references.slice(0, 2)) {
          try {
            const refLaws = await egov.searchLawsByName(ref, 3);
            if (refLaws.length > 0) {
              const refLaw = refLaws[0];
              followStep.results = followStep.results || [];
              followStep.results.push({
                lawTitle: refLaw.law_title,
                lawId: refLaw.law_id,
              });
            }
          } catch {
            // 参照先が見つからない場合はスキップ
          }
        }

        followStep.status = "done";
        emit("step", followStep);
      }
    } catch (e) {
      readStep.status = "error";
      readStep.detail = `取得エラー: ${e instanceof Error ? e.message : "不明"}`;
      emit("step", readStep);
    }
  }

  // ====== Phase 5: 結論まとめ ======
  const summaryStep = makeStep("summarizing", "調査結果をまとめ中...");
  emit("step", summaryStep);

  const conclusion = await generateConclusion(query, relevantLaws);
  summaryStep.status = "done";
  emit("step", summaryStep);

  emit("conclusion", conclusion);
}

// ====== AI ヘルパー関数 ======

interface QueryAnalysis {
  keywords: string[];      // 法令名検索用キーワード
  searchTerms: string[];   // 横断検索用キーワード
  legalAreas: string[];    // 関連法分野
}

async function analyzeQuery(query: string): Promise<QueryAnalysis> {
  const res = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `あなたは日本法の専門家です。ユーザーの質問を分析し、e-Gov法令APIで検索するためのキーワードを抽出してください。

JSON形式で回答:
{
  "keywords": ["法令名検索用キーワード（法律名や法分野名）", ...],
  "searchTerms": ["条文内容検索用キーワード（具体的な法律用語）", ...],
  "legalAreas": ["関連する法分野", ...]
}

例: 「残業代未払いについて」→
{
  "keywords": ["労働基準法", "労働契約法", "賃金"],
  "searchTerms": ["時間外労働", "割増賃金", "残業手当"],
  "legalAreas": ["労働法", "賃金規制"]
}`,
      },
      { role: "user", content: query },
    ],
  });

  try {
    return JSON.parse(res.choices[0].message.content || "{}") as QueryAnalysis;
  } catch {
    return {
      keywords: [query],
      searchTerms: [query],
      legalAreas: ["一般"],
    };
  }
}

interface SelectedLaw {
  lawId: string;
  lawTitle: string;
  reason: string;
}

async function selectRelevantLaws(
  query: string,
  laws: { law: egov.EGovLawOverview; relevance: string }[]
): Promise<SelectedLaw[]> {
  const lawListText = laws
    .map(
      (l, i) =>
        `${i + 1}. ${l.law.law_title}（${l.law.law_num}）[ID: ${l.law.law_id}]`
    )
    .join("\n");

  const res = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `以下の法令一覧から、ユーザーの質問に最も関連する法令を5件以内で選んでください。

JSON形式で回答:
{
  "selectedLaws": [
    { "lawId": "...", "lawTitle": "...", "reason": "選んだ理由" }
  ]
}`,
      },
      {
        role: "user",
        content: `質問: ${query}\n\n法令一覧:\n${lawListText}`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(res.choices[0].message.content || "{}");
    return parsed.selectedLaws || [];
  } catch {
    return laws.slice(0, 3).map((l) => ({
      lawId: l.law.law_id,
      lawTitle: l.law.law_title,
      reason: "検索結果上位",
    }));
  }
}

interface ArticleRef {
  number: string;
  reason: string;
}

async function identifyRelevantArticles(
  query: string,
  lawTitle: string,
  lawContent: string
): Promise<ArticleRef[]> {
  const res = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `あなたは日本法の専門家です。法令の内容から、ユーザーの質問に関連する条文番号を特定してください。

JSON形式で回答:
{
  "articles": [
    { "number": "条番号（数字のみ、例: 709）", "reason": "関連する理由" }
  ]
}

最大5件まで選んでください。`,
      },
      {
        role: "user",
        content: `質問: ${query}\n\n法令: ${lawTitle}\n\n内容（抜粋）:\n${lawContent.substring(0, 4000)}`,
      },
    ],
  });

  try {
    const parsed = JSON.parse(res.choices[0].message.content || "{}");
    return parsed.articles || [];
  } catch {
    return [];
  }
}

function extractLawReferences(text: string): string[] {
  const refs: Set<string> = new Set();
  // 「〇〇法」パターンを抽出
  const lawNameRegex = /(?:同法|[^\s、。（）「」]{2,10}(?:法|令|規則|条例))/g;
  let match;
  while ((match = lawNameRegex.exec(text)) !== null) {
    const name = match[0];
    if (name !== "同法" && name.length >= 3 && name.length <= 20) {
      refs.add(name);
    }
  }
  return Array.from(refs).slice(0, 5);
}

async function generateConclusion(
  query: string,
  relevantLaws: RelevantLaw[]
): Promise<ConclusionData> {
  const lawContext = relevantLaws
    .map((law) => {
      const articles = law.articles
        .map(
          (a) => `  ${a.title}\n  ${a.text}\n  (関連: ${a.relevance})`
        )
        .join("\n\n");
      return `【${law.lawTitle}】\n${articles}`;
    })
    .join("\n\n---\n\n");

  const res = await getOpenAI().chat.completions.create({
    model: "gpt-4o",
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `あなたは日本法の専門家です。ユーザーの質問に対して、調査した法令情報をもとに結論をまとめてください。

以下のJSON形式で回答:
{
  "summary": "質問に対する総合的な回答（マークダウン形式、500〜1000文字程度）",
  "keyPoints": ["重要なポイント1", "重要なポイント2", ...],
  "relevantLaws": [
    {
      "lawTitle": "法令名",
      "lawId": "法令ID",
      "articles": [
        {
          "number": "条番号",
          "title": "条文タイトル",
          "text": "条文抜粋",
          "relevance": "この質問との関連性"
        }
      ]
    }
  ]
}

注意:
- 条文の正確な引用を心がけてください
- 法的助言ではなく情報提供であることを明記してください
- 不明確な点がある場合は正直にその旨を記載してください`,
      },
      {
        role: "user",
        content: `質問: ${query}\n\n調査した法令情報:\n${lawContext}`,
      },
    ],
  });

  try {
    return JSON.parse(res.choices[0].message.content || "{}") as ConclusionData;
  } catch {
    return {
      summary: "結論の生成に失敗しました。",
      keyPoints: [],
      relevantLaws: relevantLaws,
    };
  }
}
