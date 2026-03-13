/**
 * OpenAI クライアント（Secrets Manager連携）
 */

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

let cachedApiKey = null;

async function getApiKey() {
  if (cachedApiKey) return cachedApiKey;

  if (process.env.OPENAI_API_KEY) {
    cachedApiKey = process.env.OPENAI_API_KEY;
    return cachedApiKey;
  }

  const secretArn = process.env.OPENAI_SECRET_ARN;
  if (!secretArn) throw new Error("OPENAI_SECRET_ARN is not set");

  const client = new SecretsManagerClient({});
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  cachedApiKey = res.SecretString;
  return cachedApiKey;
}

/**
 * OpenAI Chat Completion を実行
 */
export async function chatCompletion({ model = "gpt-4o-mini", temperature = 0, messages, jsonMode = false }) {
  const apiKey = await getApiKey();

  const body = {
    model,
    temperature,
    messages,
  };
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}
