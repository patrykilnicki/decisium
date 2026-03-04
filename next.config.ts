import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@decisium/agents"],
  async redirects() {
    return [
      { source: "/vault", destination: "/collections", permanent: true },
      {
        source: "/vault/collections/:collectionId",
        destination: "/collections/:collectionId",
        permanent: true,
      },
      {
        source: "/vault/documents/new",
        destination: "/collections/documents/new",
        permanent: true,
      },
      {
        source: "/vault/documents/:documentId",
        destination: "/collections/documents/:documentId",
        permanent: true,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
