#!/bin/bash
set -euo pipefail

echo "🔨 Building Next.js standalone..."
npm run build

echo "📦 Packaging for Lambda..."
rm -rf .lambda-package
mkdir -p .lambda-package

# standalone 出力をコピー
cp -r .next/standalone/. .lambda-package/
cp -r .next/static .lambda-package/.next/static

# Lambda ハンドラーをコピー
cp server-handler.js .lambda-package/

# public ディレクトリがあればコピー
if [ -d "public" ]; then
  cp -r public .lambda-package/public
fi

echo "✅ Lambda package created at .lambda-package/"
echo "   Size: $(du -sh .lambda-package | cut -f1)"
