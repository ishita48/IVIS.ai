/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["mongodb", "pdfjs-dist", "mammoth"],
  outputFileTracingIncludes: {
    // pdfjs dynamically requires its legacy worker at runtime; Next's
    // tracer can't see that require, so uploads 500 on Vercel without this.
    "/api/sources/**": [
      "./node_modules/pdfjs-dist/legacy/build/**/*",
      "./node_modules/pdfjs-dist/build/**/*",
    ],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "img.clerk.com" },
      { protocol: "https", hostname: "images.clerk.dev" },
    ],
  },
};

export default nextConfig;
