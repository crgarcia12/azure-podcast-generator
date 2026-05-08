import type { NextConfig } from "next";

const rawBasePath = process.env.BASE_PATH?.trim() ?? '';
const basePath = rawBasePath && rawBasePath !== '/' ? rawBasePath.replace(/\/$/, '') : '';

const apiTarget =
  process.env.INTERNAL_API_URL?.trim().replace(/\/$/, '') ||
  'http://127.0.0.1:5001';

const nextConfig: NextConfig = {
  output: 'standalone',
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiTarget}/api/:path*` },
      { source: '/health', destination: `${apiTarget}/health` },
    ];
  },
};

export default nextConfig;
