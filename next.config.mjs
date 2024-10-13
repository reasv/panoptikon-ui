/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    reactCompiler: true,
  },
  images: {
    remotePatterns: [
      {
        hostname: '127.0.0.1',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.PANOPTIKON_API_URL || "http://127.0.0.1:6342"}/api/:path*`,
      },
      {
        source: "/docs",
        destination: `${process.env.PANOPTIKON_API_URL || "http://127.0.0.1:6342"}/docs`,
      },
      {
        source: "/openapi.json",
        destination: `${process.env.PANOPTIKON_API_URL || "http://127.0.0.1:6342"}/openapi.json`,
      },
    ];
  },
};

export default nextConfig;
