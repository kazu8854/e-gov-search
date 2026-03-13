import { NextRequest, NextResponse } from "next/server";
import * as egov from "@/lib/egov-api";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");
  const keyword = searchParams.get("keyword") || "";
  const lawId = searchParams.get("lawId") || "";

  try {
    switch (action) {
      case "search": {
        const laws = await egov.searchLawsByName(keyword, 20);
        return NextResponse.json({ laws });
      }
      case "keyword": {
        const hits = await egov.searchLawsByKeyword(keyword, 10);
        return NextResponse.json({ hits });
      }
      case "content": {
        const content = await egov.getLawContent(lawId);
        return NextResponse.json({ content });
      }
      case "toc": {
        const toc = await egov.getLawToc(lawId);
        return NextResponse.json({ toc });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "API Error" },
      { status: 500 }
    );
  }
}
