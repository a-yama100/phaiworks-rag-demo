import type { NextConfig } from "next";

// 'unsafe-eval' と ws: は開発サーバー（React の不具合の表示・HMR）だけで使う。本番では入れない。
const isDev = process.env.NODE_ENV !== "production";

// 外部から読み込むものは無い（フォントは next/font で自前配信、fetch はすべて同じ origin）ので 'self' だけにする。
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (isDev ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'" + (isDev ? " ws: wss:" : ""),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// /api/py/* is the Python backend in api/index.py.
//
// This rewrite is load-bearing and its absence is not obvious: without it Next.js owns
// every path under /api and answers /api/py/health with its own 404 page, so the
// function looks like it failed to deploy when in fact it was never reached. In
// production the request is routed to the serverless function, which receives the
// original path — which is why the FastAPI routes carry the /api/py prefix and are
// identical in both environments. In development the same path goes to uvicorn on 8000.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/py/:path*",
        destination:
          process.env.NODE_ENV === "development"
            ? "http://127.0.0.1:8000/api/py/:path*"
            : "/api/",
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
