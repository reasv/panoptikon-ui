/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    reactCompiler: true,
  },
  // httpAgentOptions: {
  //   keepAlive: false,
  // },
  // async headers() {
  //   return [
  //     {
  //       // Apply these headers to all routes
  //       source: '/:path*',
  //       headers: [
  //         {
  //           key: 'Cross-Origin-Opener-Policy',
  //           value: 'same-origin', // You can also use 'same-origin-allow-popups' if needed
  //         },
  //         {
  //           key: 'Cross-Origin-Embedder-Policy',
  //           value: 'require-corp', // Or 'credentialless' depending on your use case
  //         },
  //       ],
  //     },
  //   ]
  // },
  images: {
    remotePatterns: [
      {
        hostname: '127.0.0.1',
      },
    ],
  },
  images: {
    remotePatterns: [
      {
        hostname: 'localhost',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL || "http://127.0.0.1:6342"}/api/:path*`,
      },
      {
        source: "/gradio/:path*",
        destination: `${process.env.API_URL || "http://127.0.0.1:6342"}/gradio/:path*`,
      },
    ];
  },
};

export default nextConfig;
