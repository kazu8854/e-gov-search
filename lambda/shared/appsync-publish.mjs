/**
 * AppSync Event API パブリッシュユーティリティ
 * Lambda から AppSync Event API にイベントをパブリッシュする（IAM認証/SigV4）
 */

import { Sha256 } from "@aws-crypto/sha256-js";
import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { defaultProvider } from "@aws-sdk/credential-provider-node";

const APPSYNC_HTTP_ENDPOINT = process.env.APPSYNC_HTTP_ENDPOINT;
const REGION = process.env.AWS_REGION || "ap-northeast-1";

/**
 * AppSync Event API にイベントをパブリッシュ
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
  }
}

export async function sendStep(searchId, step) {
  const channel = `/search/${searchId}`;
  await publishToChannel(channel, [{ event: "step", data: step, timestamp: Date.now() }]);
}

export async function sendConclusion(searchId, conclusion) {
  const channel = `/search/${searchId}`;
  await publishToChannel(channel, [{ event: "conclusion", data: conclusion, timestamp: Date.now() }]);
}

export async function sendError(searchId, message) {
  const channel = `/search/${searchId}`;
  await publishToChannel(channel, [{ event: "error", data: { message }, timestamp: Date.now() }]);
}

export async function sendDone(searchId) {
  const channel = `/search/${searchId}`;
  await publishToChannel(channel, [{ event: "done", data: {}, timestamp: Date.now() }]);
}
