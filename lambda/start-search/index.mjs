/**
 * REST API → Step Functions 開始 Lambda
 */
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { randomUUID } from "crypto";

const sfnClient = new SFNClient({});
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN;

export async function handler(event) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    const body = JSON.parse(event.body || "{}");
    const query = typeof body.query === "string" ? body.query.trim() : "";

    if (!query || query.length > 500) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "有効な質問を入力してください（500文字以内）" }),
      };
    }

    const searchId = randomUUID();

    await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        name: `search-${searchId}`,
        input: JSON.stringify({ searchId, query }),
      })
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ searchId }),
    };
  } catch (e) {
    console.error("Start search error:", e);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "検索の開始に失敗しました" }),
    };
  }
}
