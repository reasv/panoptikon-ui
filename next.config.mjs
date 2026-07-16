/** @type {import('next').NextConfig} */

const nextConfig = {
  // Standalone output is opt-in (BUILD_STANDALONE=true next build) because
  // `next start` refuses to run when output is "standalone", which would
  // break plain `npm start` and the panoptikon gateway's checkout mode.
  // The standalone build is consumed by the panoptikon repo's `bundled-ui`
  // cargo feature (PANOPTIKON_UI_BUNDLE). Nothing config-shaped is baked in
  // at build time anymore (rewrites are dev-only, production emits none),
  // but the bundle vendors node_modules — including sharp's prebuilt
  // platform binaries — so a standalone build only runs on the OS/arch it
  // was assembled on.
  output: process.env.BUILD_STANDALONE === "true" ? "standalone" : undefined,
  reactCompiler: true,
  images: {
    remotePatterns: [
      {
        hostname: '127.0.0.1',
      },
    ],
  },
  async rewrites() {
    // Dev-only convenience proxy so `next dev` is usable without a gateway
    // in front: /api, /docs and /openapi.json are forwarded to the backend
    // named by PANOPTIKON_API_URL. Production builds emit zero rewrites
    // unconditionally — the panoptikon gateway serves those routes itself
    // and only forwards the remaining traffic to the UI server.
    if (process.env.NODE_ENV !== "development") {
      return []
    }
    const panoptikonAPI = process.env.PANOPTIKON_API_URL || "http://127.0.0.1:6342"
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
    ]
  },
};

export default nextConfig;
