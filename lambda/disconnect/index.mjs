/**
 * WebSocket $disconnect ハンドラー
 * DynamoDBから接続情報を削除
 */

import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";

const ddb = new DynamoDBClient({});
const TABLE_NAME = process.env.CONNECTIONS_TABLE;

export const handler = async (event) => {
  const connectionId = event.requestContext.connectionId;

  await ddb.send(
    new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: { connectionId: { S: connectionId } },
    })
  );

  console.log(`Disconnected: ${connectionId}`);
  return { statusCode: 200, body: "Disconnected" };
};
