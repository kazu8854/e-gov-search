/**
 * WebSocket $connect ハンドラー
 * 接続情報をDynamoDBに保存
 */

import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const ddb = new DynamoDBClient({});
const TABLE_NAME = process.env.CONNECTIONS_TABLE;

export const handler = async (event) => {
  const connectionId = event.requestContext.connectionId;

  await ddb.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        connectionId: { S: connectionId },
        connectedAt: { N: String(Date.now()) },
        ttl: { N: String(Math.floor(Date.now() / 1000) + 7200) }, // 2時間後に自動削除
      },
    })
  );

  console.log(`Connected: ${connectionId}`);
  return { statusCode: 200, body: "Connected" };
};
