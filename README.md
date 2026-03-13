# 法令探索AI - e-Gov法令検索

自然言語で質問すると、AIが [e-Gov法令API v2](https://laws.e-gov.go.jp/) を使って関連法令を多段階で探索し、試行プロセスをリアルタイムに可視化するWebアプリケーションです。

![法令探索AI](https://img.shields.io/badge/Next.js-15-black?style=flat&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38bdf8?style=flat&logo=tailwindcss)

## 特徴

- 🔍 **自然言語検索** — 「残業代未払いの場合どうなる？」のように普通の日本語で質問
- 🧠 **AI多段階探索** — GPT-4oがクエリを分析し、関連法令を芋づる式に探索
- 📡 **リアルタイム可視化** — Server-Sent Events（SSE）で探索プロセスをストリーミング表示
  - キーワード抽出 → 法令検索 → 条文読み取り → 参照先追跡 → 結論まとめ
- 📋 **結論レポート** — 関連法令・条文を整理し、重要ポイントとともに提示
- 🔗 **e-Gov連携** — 各法令からe-Govの原文ページへのリンク付き

## 動作の流れ

```
ユーザー入力: 「残業代未払いについて」
    ↓
🧠 AI分析: キーワード「労働基準法」「賃金」を抽出
    ↓
🔍 法令検索: e-Gov APIで「労働基準法」を検索
    ↓
📖 条文読取: 第37条（時間外労働の割増賃金）を特定
    ↓
🔗 参照追跡: 労働基準法施行規則も確認
    ↓
📋 結論まとめ: 関連条文と解説を整理して提示
```

## セットアップ

### 前提条件

- Node.js 18+
- OpenAI API キー

### インストール

```bash
git clone https://github.com/kazu8854/e-gov-search.git
cd e-gov-search
npm install
```

### 環境変数

```bash
cp .env.example .env.local
```

`.env.local` を編集して OpenAI API キーを設定：

```
OPENAI_API_KEY=sk-your-api-key-here
```

### 開発サーバー起動

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) でアクセス。

## 技術スタック

| 技術 | 用途 |
|------|------|
| [Next.js 15](https://nextjs.org/) (App Router) | フレームワーク |
| [TypeScript](https://www.typescriptlang.org/) | 型安全 |
| [Tailwind CSS v4](https://tailwindcss.com/) | スタイリング |
| [OpenAI API](https://platform.openai.com/) (GPT-4o) | AI探索エンジン |
| [e-Gov法令API v2](https://laws.e-gov.go.jp/apidoc/) | 法令データ |
| [Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) | リアルタイムストリーミング |
| [Lucide React](https://lucide.dev/) | アイコン |

## e-Gov法令MCP サーバー

本アプリはe-Gov法令API v2を直接利用していますが、MCP（Model Context Protocol）サーバーとしても公開されているものがあり、Claude Desktop等のAIツールと連携可能です：

- [kuro6061/e-gov-mcp](https://github.com/kuro6061/e-gov-mcp) — 23ツール、最も多機能（Python/uvx）
- [nekogohanoishi/law-jp-mcp](https://github.com/nekogohanoishi/law-jp-mcp) — LLM最適化、Vercel対応（TypeScript/npx）
- [takurot/egov-law-mcp](https://github.com/takurot/egov-law-mcp) — シンプル、PyPI公開済み（Python/uvx）

## プロジェクト構成

```
src/
├── app/
│   ├── api/
│   │   ├── search/route.ts    # SSEストリーミングAPI
│   │   └── egov/route.ts      # e-Gov APIプロキシ
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx               # メインページ
├── components/
│   ├── SearchInput.tsx        # 検索入力UI
│   ├── SearchProcess.tsx      # 探索プロセス可視化
│   └── Conclusion.tsx         # 結論表示
├── lib/
│   ├── egov-api.ts            # e-Gov法令APIクライアント
│   ├── search-engine.ts       # AI探索エンジン
│   └── use-search.ts          # React Hook（SSE受信）
└── types/
    └── index.ts               # 型定義
```

## AWSサーバレスデプロイ（イベントドリブン構成）

完全サーバレス＋イベントドリブンなAWS構成をCDKで構築できます。

### アーキテクチャ

```
ブラウザ（静的HTML/JS）
  ↕ WebSocket
API Gateway WebSocket API
  ↕
Lambda（接続管理）→ DynamoDB（接続情報）
  ↓
Step Functions（探索オーケストレーション）
  ├── Phase 1: クエリ分析 Lambda（OpenAI）
  ├── Phase 2: 法令検索 Lambda × N（Map並列、e-Gov API）
  ├── Phase 3: 関連度判定 Lambda（OpenAI）
  ├── Phase 4: 条文深掘り Lambda × N（Map並列、e-Gov API + OpenAI）
  └── Phase 5: 結論生成 Lambda（OpenAI GPT-4o）
  ↓ 各ステップ完了時
Lambda → API Gateway Management API → ブラウザにリアルタイム通知
```

### AWSリソース一覧

| リソース | 用途 |
|----------|------|
| **API Gateway WebSocket** | ブラウザとの双方向リアルタイム通信 |
| **Step Functions** | 探索フローのオーケストレーション（可視化） |
| **Lambda × 7** | 接続管理(2) + 探索開始(1) + 各Phase(5) |
| **DynamoDB** | WebSocket接続情報管理（TTL付き） |
| **CloudFront + S3** | 静的フロントエンド配信 |
| **Secrets Manager** | OpenAI APIキー管理 |

### イベントドリブンの利点

1. **各ステップが独立したLambda** → 個別にスケール・リトライ可能
2. **Step Functionsで可視化** → AWSコンソールでワークフロー進行が見える
3. **Map状態で並列検索** → 複数キーワードを同時に検索して高速化
4. **フロントエンドは完全静的** → S3+CloudFrontのみ、サーバー不要
5. **WebSocketでリアルタイム配信** → Lambda完了ごとに即座にブラウザへプッシュ

### デプロイ手順

```bash
# 1. AWS CLI設定済み、Node.js 18+
aws configure

# 2. パッケージング & デプロイ
npm run cdk:deploy

# 3. OpenAI APIキーを設定
aws secretsmanager put-secret-value \
  --secret-id e-gov-search/openai-api-key \
  --secret-string "sk-your-openai-api-key"

# 4. WebSocket URLをフロントに設定（出力されたURLを環境変数に）
# NEXT_PUBLIC_WEBSOCKET_URL=wss://xxx.execute-api.ap-northeast-1.amazonaws.com/prod
```

### 削除

```bash
npm run cdk:destroy
```

## プロジェクト構成

```
src/                            # Next.js フロントエンド
├── app/
│   ├── api/search/route.ts     # SSEフォールバック（ローカル開発用）
│   ├── api/egov/route.ts       # e-Gov APIプロキシ（ローカル開発用）
│   └── page.tsx                # メインページ
├── components/                 # UI コンポーネント
├── lib/
│   ├── use-search.ts           # WebSocket + SSEフォールバック Hook
│   ├── egov-api.ts             # e-Gov API クライアント
│   └── search-engine.ts        # AI探索エンジン（ローカル用）
└── types/                      # 型定義

lambda/                         # AWS Lambda 関数群
├── shared/                     # 共有ユーティリティ（Layer）
│   ├── egov-api.mjs            # e-Gov API クライアント
│   ├── openai-client.mjs       # OpenAI API クライアント
│   └── ws-notify.mjs           # WebSocket通知
├── connect/                    # WebSocket接続
├── disconnect/                 # WebSocket切断
├── start-search/               # 検索開始→Step Functions起動
├── analyze-query/              # Phase 1: クエリ分析
├── search-laws/                # Phase 2: 法令検索（並列）
├── select-laws/                # Phase 3: 関連度判定
├── read-articles/              # Phase 4: 条文深掘り（並列）
└── generate-conclusion/        # Phase 5: 結論生成

cdk/                            # AWS CDK
├── lib/e-gov-search-stack.ts   # メインスタック
└── bin/app.ts                  # エントリポイント
```

## ライセンス

MIT

## 謝辞

- [e-Gov 法令API v2](https://laws.e-gov.go.jp/apidoc/) — デジタル庁
- [OpenAI](https://openai.com/)
