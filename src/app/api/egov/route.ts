import { NextRequest, NextResponse } from "next/server";
import * as egov from "@/lib/egov-api";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";

// /api/egov: 1分間に30回まで
const EGOV_RATE_LIMIT = { windowMs: 60_000, maxRequests: 30 };

// lawId バリデーション: e-Gov法令IDは英数字とアンダースコアのみ
const LAW_ID_PATTERN = /^[A-Za-z0-9_]+$/;
const MAX_KEYWORD_LENGTH = 200;

export async function GET(req: NextRequest) {
  // レート制限チェック
  const clientIP = getClientIP(req);
  const rateResult = checkRateLimit(`egov:${clientIP}`, EGOV_RATE_LIMIT);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: "リクエストが多すぎます。しばらくしてからお試しください。" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rateResult.resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");
  const keyword = (searchParams.get("keyword") || "").substring(0, MAX_KEYWORD_LENGTH);
  const lawId = searchParams.get("lawId") || "";

  try {
    switch (action) {
      case "search": {
        if (!keyword) {
          return NextResponse.json({ error: "keyword is required" }, { status: 400 });
        }
        const laws = await egov.searchLawsByName(keyword, 20);
        return NextResponse.json({ laws });
      }
      case "keyword": {
        if (!keyword) {
          return NextResponse.json({ error: "keyword is required" }, { status: 400 });
        }
        const hits = await egov.searchLawsByKeyword(keyword, 10);
        return NextResponse.json({ hits });
      }
      case "content": {
        if (!lawId || !LAW_ID_PATTERN.test(lawId)) {
          return NextResponse.json({ error: "Valid lawId is required" }, { status: 400 });
        }
        const content = await egov.getLawContent(lawId);
        return NextResponse.json({ content });
      }
      case "toc": {
        if (!lawId || !LAW_ID_PATTERN.test(lawId)) {
          return NextResponse.json({ error: "Valid lawId is required" }, { status: 400 });
        }
        const toc = await egov.getLawToc(lawId);
        return NextResponse.json({ toc });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    console.error("e-Gov API proxy error:", e);
    return NextResponse.json(
      { error: "法令情報の取得に失敗しました" },
      { status: 500 }
    );
  }
}
