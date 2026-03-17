/**
 * Amazon Bedrock Claude クライアント（Lambda共有ライブラリ）
 */

import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const BEDROCK_REGION = process.env.BEDROCK_REGION || "us-east-1";
const CLAUDE_MODEL_ID = process.env.CLAUDE_MODEL_ID || "anthropic.claude-sonnet-4-20250514";
const CLAUDE_LIGHT_MODEL_ID = process.env.CLAUDE_LIGHT_MODEL_ID || "anthropic.claude-haiku-4-20250514";

let client = null;

function getClient() {
  if (!client) {
    client = new BedrockRuntimeClient({ region: BEDROCK_REGION });
  }
  return client;
}

/**
 * Bedrock Claude Chat Completion を実行
 * OpenAI互換の chatCompletion インターフェースを維持
 */
export async function chatCompletion({ model = "light", temperature = 0, messages, jsonMode = false, maxTokens = 4096 }) {
  const bedrockClient = getClient();

  // model引数でモデルを選択: "heavy" → Sonnet, それ以外 → Haiku
  const modelId = model === "heavy" ? CLAUDE_MODEL_ID : CLAUDE_LIGHT_MODEL_ID;

  // OpenAI形式のmessagesからBedrock形式に変換
  let system = "";
  const bedrockMessages = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      system = msg.content;
    } else {
      bedrockMessages.push({ role: msg.role, content: msg.content });
    }
  }

  if (jsonMode) {
    system += "\n\n必ずJSON形式のみで回答してください。マークダウンのコードブロックは不要です。";
  }

  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: maxTokens,
    temperature,
    system,
    messages: bedrockMessages,
  });

  const command = new InvokeModelCommand({
    modelId,
    contentType: "application/json",
    accept: "application/json",
    body: new TextEncoder().encode(body),
  });

  const res = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(res.body));
  const text = responseBody.content?.[0]?.text ?? "{}";

  // JSONブロックを抽出（```json ... ``` 形式にも対応）
  if (jsonMode) {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    return jsonMatch ? jsonMatch[1].trim() : text;
  }

  return text;
}
