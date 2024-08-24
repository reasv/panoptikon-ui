/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    reactCompiler: true,
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
