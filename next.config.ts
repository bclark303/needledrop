import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // music-metadata dynamically loads format parsers and reads files outside the app tree.
  // Keep it as a normal server dependency so Next's standalone tracer packages it intact.
  serverExternalPackages: ['music-metadata'],
};

export default nextConfig;
