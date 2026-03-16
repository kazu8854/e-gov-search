# 法令探索AI - e-Gov法令検索

自然言語で質問すると、AIが [e-Gov法令API v2](https://laws.e-gov.go.jp/) を使って関連法令を多段階で探索し、試行プロセスをリアルタイムに可視化するWebアプリケーションです。

![法令探索AI](https://img.shields.io/badge/Next.js-15-black?style=flat&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38bdf8?style=flat&logo=tailwindcss)
![AWS](https://img.shields.io/badge/AWS-CDK-orange?style=flat&logo=amazonaws)

## 特徴

- 🔍 **自然言語検索** — 「残業代未払いの場合どうなる？」のように普通の日本語で質問
- 🧠 **AI多段階探索** — GPT-4oがクエリを分析し、関連法令を芋づる式に探索
- 📡 **リアルタイム可視化** — AppSync Event API（WebSocket）で探索プロセスをストリーミング表示
- 📋 **結論レポート** — 関連法令・条文を整理し、重要ポイントとともに提示
- 🔗 **e-Gov連携** — 各法令からe-Govの原文ページへのリンク付き
- ⚡ **サーバーレス** — AWS CDKで完全サーバーレス構成をワンコマンドデプロイ

## アーキテクチャ

```
ブラウザ
  ├── POST /search → API Gateway REST → Lambda(start-search) → Step Functions 起動
  └── WebSocket subscribe → AppSync Event API ← Lambda(各Phase)がpublish
                                                    │
                              ┌──────────────────────┘
                              │
                    Step Functions ワークフロー
                    ┌─────────────────────────────┐
                    │ Phase 1: クエリ分析 (AI)     │
                    │ Phase 2: 法令検索 (並列×5)   │
                    │ Phase 3: 関連度判定 (AI)     │
                    │ Phase 4: 条文深掘り (並列×3) │
                    │ Phase 5: 結論生成 (AI)       │
                    └─────────────────────────────┘
```

### AppSync Event API の利点（旧 WebSocket API Gateway版との比較）

| 項目 | 旧構成（WebSocket API GW） | 新構成（AppSync Event API） |
|------|--------------------------|---------------------------|
| 接続管理 | Lambda + DynamoDB が必要 | **不要**（AppSyncが自動管理） |
| Lambda数 | 7個 | **5個**（connect/disconnect不要） |
| DynamoDB | 接続テーブルが必要 | **不要** |
| イベント配信 | API GW Management API呼び出し | **HTTP POSTでチャネルにpublish** |
| スケーラビリティ | 自前で管理 | **数百万接続まで自動スケール** |
| コスト | $1.00/100万メッセージ | **$0.08/100万イベント** |

## セットアップ

### 前提条件

- Node.js 18+
- AWS CLI + CDK CLI（`npm install -g aws-cdk`）
- OpenAI API キー

### ローカル開発（SSEモード）

AppSyncなしでもローカル開発できます（SSEフォールバック）：

```bash
git clone https://github.com/kazu8854/e-gov-search.git
cd e-gov-search
npm install
cp .env.example .env.local
# .env.local に OPENAI_API_KEY を設定
npm run dev
```

### AWSデプロイ

```bash
# 1. フロントエンド静的ビルド
npm run build:export

# 2. CDKデプロイ
cd cdk
npm install
cdk deploy

# 3. デプロイ出力からAppSync/REST API設定を取得
#    → .env.local に設定してフロントをリビルド
```

デプロイ後の出力例：
```
AppSyncHttpEndpoint = https://xxx.appsync-api.ap-northeast-1.amazonaws.com
AppSyncRealtimeEndpoint = wss://xxx.appsync-realtime-api.ap-northeast-1.amazonaws.com
RestApiURL = https://xxx.execute-api.ap-northeast-1.amazonaws.com/prod/
OpenAISecretArn = arn:aws:secretsmanager:ap-northeast-1:xxx:secret:e-gov-search/openai-api-key-xxx
```

⚠️ **重要**: Secrets ManagerにOpenAI APIキーを手動設定してください：
```bash
aws secretsmanager put-secret-value \
  --secret-id e-gov-search/openai-api-key \
  --secret-string "sk-your-api-key-here"
```

## 技術スタック

| 技術 | 用途 |
|------|------|
| [Next.js 15](https://nextjs.org/) (App Router) | フレームワーク |
| [TypeScript](https://www.typescriptlang.org/) | 型安全 |
| [Tailwind CSS v4](https://tailwindcss.com/) | スタイリング |
| [OpenAI API](https://platform.openai.com/) (GPT-4o) | AI探索エンジン |
| [e-Gov法令API v2](https://laws.e-gov.go.jp/apidoc/) | 法令データ |
| [AWS AppSync Event API](https://docs.aws.amazon.com/appsync/latest/eventapi/) | リアルタイムWebSocket |
| [AWS Step Functions](https://aws.amazon.com/step-functions/) | 探索ワークフロー |
| [AWS Lambda](https://aws.amazon.com/lambda/) | サーバーレス関数 |
| [AWS CDK](https://aws.amazon.com/cdk/) | IaC |
| [Lucide React](https://lucide.dev/) | アイコン |

## e-Gov法令MCP サーバー

本アプリはe-Gov法令API v2を直接利用していますが、MCP（Model Context Protocol）サーバーとしても公開されているものがあり、Claude Desktop等と連携可能です：

- [kuro6061/e-gov-mcp](https://github.com/kuro6061/e-gov-mcp) — 23ツール、最も多機能
- [nekogohanoishi/law-jp-mcp](https://github.com/nekogohanoishi/law-jp-mcp) — LLM最適化、Vercel対応
- [takurot/egov-law-mcp](https://github.com/takurot/egov-law-mcp) — シンプル、PyPI公開済み

## プロジェクト構成

```
e-gov-search/
├── src/                          # Next.js フロントエンド
│   ├── app/
│   │   ├── api/search/route.ts   # SSEフォールバック（ローカル開発用）
│   │   ├── api/egov/route.ts     # e-Gov APIプロキシ
│   │   └── page.tsx              # メインページ
│   ├── components/
│   │   ├── SearchInput.tsx       # 検索入力UI
│   │   ├── SearchProcess.tsx     # 探索プロセス可視化
│   │   └── Conclusion.tsx        # 結論表示
│   └── lib/
│       ├── egov-api.ts           # e-Gov法令APIクライアント
│       ├── search-engine.ts      # AI探索エンジン（SSE用）
│       └── use-search.ts         # React Hook（AppSync WS + SSEフォールバック）
├── lambda/                       # AWS Lambda関数
│   ├── start-search/             # REST API → Step Functions起動
│   ├── analyze-query/            # Phase 1: クエリ分析
│   ├── search-laws/              # Phase 2: 法令検索
│   ├── select-laws/              # Phase 3: 関連度判定
│   ├── read-articles/            # Phase 4: 条文深掘り
│   ├── generate-conclusion/      # Phase 5: 結論生成
│   └── shared/
│       ├── appsync-publish.mjs   # AppSync Event HTTPパブリッシュ
│       ├── egov-api.mjs          # e-Gov APIクライアント（Lambda用）
│       └── openai-client.mjs     # OpenAIクライアント
├── cdk/                          # AWS CDK（IaC）
│   └── lib/e-gov-search-stack.ts # AppSync + Step Functions + Lambda
└── scripts/
    └── build-static.sh           # 静的エクスポート用ビルド
```

## ライセンス

MIT

