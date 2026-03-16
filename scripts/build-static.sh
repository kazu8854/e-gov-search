#!/bin/bash
# 静的エクスポート用ビルドスクリプト
# CDKデプロイ時に使用（S3 + CloudFront配信用）
# API routeはproductionでは不要（AppSync + REST APIを使用）

set -e

echo "📦 Static export build starting..."

# API routeを一時退避
mkdir -p /tmp/api-routes-backup
if [ -d "src/app/api" ]; then
  cp -r src/app/api /tmp/api-routes-backup/
  rm -rf src/app/api
fi

# Static export ビルド
NEXT_BUILD_MODE=export npx next build

# API routeを復元
if [ -d "/tmp/api-routes-backup/api" ]; then
  mkdir -p src/app
  cp -r /tmp/api-routes-backup/api src/app/
  rm -rf /tmp/api-routes-backup
fi

echo "✅ Static export completed → out/"
