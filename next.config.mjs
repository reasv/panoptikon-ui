/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    reactCompiler: true,
  },
  async headers() {
    return [
      {
        // Apply these headers to all routes
        source: '/:path*',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin', // You can also use 'same-origin-allow-popups' if needed
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp', // Or 'credentialless' depending on your use case
          },
        ],
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL}/api/:path*`,
      },
      {
        source: '/gradio/:path*',
        destination: `${process.env.API_URL}/gradio/:path*`,
      },
    ];
  }
};

export default nextConfig;
