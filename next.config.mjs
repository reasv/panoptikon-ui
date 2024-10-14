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
    const panoptikonAPI = process.env.PANOPTIKON_API_URL || "http://127.0.0.1:6342"
    console.log("panoptikonAPI=", panoptikonAPI)
    return [
      {
        source: "/api/:path*",
        destination: `${panoptikonAPI}/api/:path*`,
      },
      {
        source: "/docs",
        destination: `${panoptikonAPI}/docs`,
      },
      {
        source: "/openapi.json",
        destination: `${panoptikonAPI}/openapi.json`,
      },
    ];
  },
};

export default nextConfig;
