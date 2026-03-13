/**
 * Lambda Function URL ハンドラー for Next.js standalone
 *
 * Next.js standalone サーバーを Lambda で実行するためのアダプター。
 * - Secrets Manager から OPENAI_API_KEY を取得
 * - レスポンスストリーミング（SSE）対応
 */

const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

let secretLoaded = false;
let server;

/**
 * 初回呼び出し時にシークレットをロードし、Next.jsサーバーを起動
 */
async function initialize() {
  if (!secretLoaded && process.env.OPENAI_SECRET_ARN) {
    try {
      const client = new SecretsManagerClient({});
      const response = await client.send(
        new GetSecretValueCommand({
          SecretId: process.env.OPENAI_SECRET_ARN,
        })
      );
      if (response.SecretString) {
        process.env.OPENAI_API_KEY = response.SecretString;
      }
      secretLoaded = true;
      console.log("OpenAI API key loaded from Secrets Manager");
    } catch (err) {
      console.error("Failed to load secret:", err.message);
    }
  }

  if (!server) {
    // Next.js standalone server のロード
    const path = require("path");
    process.env.HOSTNAME = "0.0.0.0";
    process.env.PORT = "3000";

    // Next.js standalone の server.js は HTTP サーバーを起動する
    // Lambda では直接 request handler を使う必要がある
    const NextServer = require("next/dist/server/next-server").default;
    const conf = require("./.next/required-server-files.json");

    server = new NextServer({
      hostname: "localhost",
      port: 3000,
      dir: path.join(__dirname),
      dev: false,
      customServer: true,
      conf: {
        ...conf.config,
        distDir: ".next",
      },
    });

    await server.prepare();
  }
}

/**
 * Lambda Function URL ハンドラー（レスポンスストリーミング対応）
 */
exports.handler = awslambda.streamifyResponse(
  async (event, responseStream, context) => {
    await initialize();

    const { IncomingMessage, ServerResponse } = require("http");
    const { Writable } = require("stream");

    // Lambda Function URL event → Node.js HTTP request 変換
    const headers = event.headers || {};
    const req = new IncomingMessage();
    req.method = event.requestContext?.http?.method || "GET";
    req.url = event.rawPath + (event.rawQueryString ? `?${event.rawQueryString}` : "");
    req.headers = {};

    // ヘッダーを小文字に正規化
    for (const [key, value] of Object.entries(headers)) {
      req.headers[key.toLowerCase()] = value;
    }

    // body
    if (event.body) {
      const bodyBuffer = event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : Buffer.from(event.body);
      req.push(bodyBuffer);
    }
    req.push(null);

    // HTTP Response → Lambda レスポンスストリーム 変換
    let statusCode = 200;
    let responseHeaders = {};
    let headersSent = false;

    const res = new Writable({
      write(chunk, encoding, callback) {
        if (!headersSent) {
          // メタデータをストリームの先頭に送信
          const metadata = {
            statusCode,
            headers: responseHeaders,
          };
          responseStream = awslambda.HttpResponseStream.from(
            responseStream,
            metadata
          );
          headersSent = true;
        }
        responseStream.write(chunk, encoding, callback);
      },
      final(callback) {
        if (!headersSent) {
          const metadata = {
            statusCode,
            headers: responseHeaders,
          };
          responseStream = awslambda.HttpResponseStream.from(
            responseStream,
            metadata
          );
          headersSent = true;
        }
        responseStream.end();
        callback();
      },
    });

    // ServerResponse のメソッドをエミュレート
    res.writeHead = function (code, reasonOrHeaders, maybeHeaders) {
      statusCode = code;
      const hdrs =
        typeof reasonOrHeaders === "object" ? reasonOrHeaders : maybeHeaders || {};
      for (const [key, value] of Object.entries(hdrs)) {
        responseHeaders[key] = String(value);
      }
      return res;
    };

    res.setHeader = function (key, value) {
      responseHeaders[key.toLowerCase()] = String(value);
      return res;
    };

    res.getHeader = function (key) {
      return responseHeaders[key.toLowerCase()];
    };

    res.removeHeader = function (key) {
      delete responseHeaders[key.toLowerCase()];
    };

    res.statusCode = 200;
    Object.defineProperty(res, "statusCode", {
      get() {
        return statusCode;
      },
      set(v) {
        statusCode = v;
      },
    });

    res.headersSent = false;
    Object.defineProperty(res, "headersSent", {
      get() {
        return headersSent;
      },
    });

    // Next.js にリクエストを処理させる
    const requestHandler = server.getRequestHandler();
    await requestHandler(req, res);
  }
);
