/**
 * 検索開始 Lambda
 * REST API POST /search → searchId生成 → Step Functions 起動 → searchIdを返却
 */

import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { randomUUID } from "crypto";

const sfn = new SFNClient({});
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN;

export const handler = async (event) => {
  const body = JSON.parse(event.body || "{}");
  const query = typeof body.query === "string" ? body.query.trim() : "";

  if (!query || query.length > 500) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Invalid query (1-500 chars)" }),
    };
  }

  // サニタイズ
  const sanitizedQuery = query.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").substring(0, 500);

  // searchId 生成（クライアントがこのIDでAppSyncチャネルをsubscribeする）
  const searchId = randomUUID();
  const executionName = `search-${searchId.substring(0, 8)}-${Date.now()}`;

  await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      name: executionName,
      input: JSON.stringify({
        searchId,
        query: sanitizedQuery,
      }),
    })
  );

  console.log(`Started execution: ${executionName}, searchId: ${searchId}`);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ searchId }),
  };
};
