/**
 * AppSync Event API パブリッシュユーティリティ
 * 
 * Lambda から AppSync Event API の HTTP endpoint にイベントをパブリッシュする。
 * IAM認証（SigV4）でAppSync Event APIに接続。
 * 
 * ws-notify.mjs（API Gateway Management API版）の代替。
 * DynamoDB接続管理テーブルも不要。
 */

import { Sha256 } from "@aws-crypto/sha256-js";
import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { defaultProvider } from "@aws-sdk/credential-provider-node";

const APPSYNC_HTTP_ENDPOINT = process.env.APPSYNC_HTTP_ENDPOINT; // https://xxx.appsync-api.region.amazonaws.com/event
const REGION = process.env.AWS_REGION || "ap-northeast-1";

/**
 * AppSync Event API にイベントをパブリッシュ
 * @param {string} channel - チャネルパス (e.g. "/search/abc123")
 * @param {Array} events - イベント配列（各要素はJSON文字列化されたオブジェクト）
 */
async function publishToChannel(channel, events) {
  if (!APPSYNC_HTTP_ENDPOINT) {
    console.warn("APPSYNC_HTTP_ENDPOINT is not set, skipping publish");
    return;
  }

  const url = new URL(APPSYNC_HTTP_ENDPOINT);

  const body = JSON.stringify({
    channel,
    events: events.map((e) => (typeof e === "string" ? e : JSON.stringify(e))),
  });

  const request = new HttpRequest({
    method: "POST",
    hostname: url.hostname,
    path: url.pathname,
    headers: {
      "Content-Type": "application/json",
      host: url.hostname,
    },
    body,
  });

  // SigV4署名
  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region: REGION,
    service: "appsync",
    sha256: Sha256,
  });

  const signedRequest = await signer.sign(request);

  const res = await fetch(APPSYNC_HTTP_ENDPOINT, {
    method: "POST",
    headers: signedRequest.headers,
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`AppSync publish error: ${res.status} ${errText}`);
    // 致命的でないので例外は投げない（クライアント切断の可能性あり）
  }
}

/**
 * searchIdに対してイベントを送信
 */
export async function sendEvent(searchId, event, data) {
  const channel = `/search/${searchId}`;
  const payload = { event, data, timestamp: Date.now() };
  await publishToChannel(channel, [payload]);
}

/**
 * ステップイベントを送信
 */
export async function sendStep(searchId, step) {
  return sendEvent(searchId, "step", step);
}

/**
 * 結論イベントを送信
 */
export async function sendConclusion(searchId, conclusion) {
  return sendEvent(searchId, "conclusion", conclusion);
}

/**
 * エラーイベントを送信
 */
export async function sendError(searchId, message) {
  return sendEvent(searchId, "error", { message });
}

/**
 * 完了イベントを送信
 */
export async function sendDone(searchId) {
  return sendEvent(searchId, "done", {});
}
