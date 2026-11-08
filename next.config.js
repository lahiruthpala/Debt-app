/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{
      source: "/dashboard",
      headers: [{key:"Cache-Control",value:"no-store, max-age=0, must-revalidate"}],
    }]
  },
}

module.exports = nextConfig
