/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@academic-precision/contracts",
    "@academic-precision/config",
    "@academic-precision/ui",
  ],
};

export default nextConfig;
