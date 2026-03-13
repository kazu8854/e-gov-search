/**
 * WebSocket 通知ユーティリティ
 * API Gateway Management API を使ってクライアントにイベントを送信
 */

import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";

let client = null;

function getClient() {
  if (!client) {
    const endpoint = process.env.WEBSOCKET_ENDPOINT;
    if (!endpoint) throw new Error("WEBSOCKET_ENDPOINT is not set");
    client = new ApiGatewayManagementApiClient({ endpoint });
  }
  return client;
}

/**
 * WebSocket接続にイベントを送信
 */
export async function sendEvent(connectionId, event, data) {
  const payload = JSON.stringify({ event, data, timestamp: Date.now() });

  try {
    await getClient().send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(payload),
      })
    );
  } catch (err) {
    if (err.statusCode === 410) {
      console.log(`Connection ${connectionId} is gone`);
      return false; // 接続切れ
    }
    throw err;
  }
  return true;
}

/**
 * ステップイベントを送信
 */
export async function sendStep(connectionId, step) {
  return sendEvent(connectionId, "step", step);
}

/**
 * 結論イベントを送信
 */
export async function sendConclusion(connectionId, conclusion) {
  return sendEvent(connectionId, "conclusion", conclusion);
}

/**
 * エラーイベントを送信
 */
export async function sendError(connectionId, message) {
  return sendEvent(connectionId, "error", { message });
}

/**
 * 完了イベントを送信
 */
export async function sendDone(connectionId) {
  return sendEvent(connectionId, "done", {});
}
