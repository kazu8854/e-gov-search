import type { NextConfig } from "next";

const isStaticExport = process.env.NEXT_BUILD_MODE === "export";

const nextConfig: NextConfig = {
  // 静的エクスポート: CDKデプロイ用（S3 + CloudFront）
  // ローカル開発時は NEXT_BUILD_MODE を設定しないので output は undefined（Server Mode）
  ...(isStaticExport ? { output: "export" } : {}),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self'",
              "connect-src 'self' https://laws.e-gov.go.jp https://*.amazonaws.com wss://*.amazonaws.com https://*.appsync-api.*.amazonaws.com wss://*.appsync-realtime-api.*.amazonaws.com",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
