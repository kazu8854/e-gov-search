/**
 * WebSocket "search" メッセージハンドラー
 * Step Functions ステートマシンを開始して、探索ワークフローをキックオフ
 */

import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

const sfn = new SFNClient({});
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN;

export const handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const body = JSON.parse(event.body || "{}");
  const query = typeof body.query === "string" ? body.query.trim() : "";

  if (!query || query.length > 500) {
    return { statusCode: 400, body: "Invalid query" };
  }

  // サニタイズ
  const sanitizedQuery = query.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").substring(0, 500);

  const executionName = `search-${connectionId.substring(0, 8)}-${Date.now()}`;

  await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      name: executionName,
      input: JSON.stringify({
        connectionId,
        query: sanitizedQuery,
      }),
    })
  );

  console.log(`Started execution: ${executionName} for ${connectionId}`);
  return { statusCode: 200, body: "Search started" };
};
