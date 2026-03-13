#!/bin/bash
set -euo pipefail

echo "🔨 Building Next.js static export..."

# static export 時は API routes を一時退避（static exportではAPIルート非対応）
mv src/app/api src/app/_api_backup 2>/dev/null || true

STATIC_EXPORT=true npm run build || {
  # 失敗時もAPIルートを復元
  mv src/app/_api_backup src/app/api 2>/dev/null || true
  exit 1
}

# APIルートを復元
mv src/app/_api_backup src/app/api 2>/dev/null || true

echo "✅ Static export created at out/"
echo "   Size: $(du -sh out | cut -f1)"

echo ""
echo "📦 Lambda functions are at lambda/"
echo "   To deploy: cd cdk && npx cdk deploy"


