import { NextRequest } from "next/server";
import { runSearch } from "@/lib/search-engine";
import { checkRateLimit, getClientIP } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

// /api/search: 1分間に5回まで（OpenAI APIコスト保護）
const SEARCH_RATE_LIMIT = { windowMs: 60_000, maxRequests: 5 };

export async function POST(req: NextRequest) {
  // レート制限チェック
  const clientIP = getClientIP(req);
  const rateResult = checkRateLimit(`search:${clientIP}`, SEARCH_RATE_LIMIT);
  if (!rateResult.allowed) {
    return new Response(
      JSON.stringify({ error: "リクエストが多すぎます。しばらくしてからお試しください。" }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil((rateResult.resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  const body = await req.json();
  const query = typeof body?.query === "string" ? body.query.trim() : "";

  if (!query) {
    return new Response(JSON.stringify({ error: "query is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (query.length > 500) {
    return new Response(
      JSON.stringify({ error: "質問は500文字以内で入力してください" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY is not configured" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      try {
        await runSearch(query, emit);
        emit("done", {});
      } catch (e) {
        console.error("Search error:", e);
        emit("error", {
          message: "探索中にエラーが発生しました。しばらくしてからお試しください。",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
