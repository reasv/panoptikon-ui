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
    const inferenceAPI = process.env.INFERENCE_API_URL || panoptikonAPI
    const restrictedMode = process.env.RESTRICTED_MODE === "true"
    if (!restrictedMode) {
      return [
        {
          source: "/api/inference/:path*",
          destination: `${inferenceAPI}/api/inference/:path*`,
        },
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
    }
    return [
      {
        source: "/docs",
        destination: `${panoptikonAPI}/docs`,
      },
      {
        source: "/openapi.json",
        destination: `${panoptikonAPI}/openapi.json`,
      },
      {
        source: "/api/search/:path*",
        destination: `${panoptikonAPI}/api/search/:path*`,
      },
      {
        source: "/api/items/:path*",
        destination: `${panoptikonAPI}/api/items/:path*`,
      },
      {
        source: "/api/bookmarks/:path*",
        destination: `${panoptikonAPI}/api/bookmarks/:path*`,
      },
      {
        source: "/api/db",
        destination: `${panoptikonAPI}/api/db`,
      },
      {
        source: "/api/inference/:path*",
        destination: `${inferenceAPI}/api/inference/:path*`,
      },
    ]
  },
};

export default nextConfig;
