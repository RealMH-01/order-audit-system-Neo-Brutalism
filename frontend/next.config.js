/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://8.136.189.224:28080/api/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
