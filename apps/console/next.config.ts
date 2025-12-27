import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	experimental: {
		// Enable React 19 features
	},
	transpilePackages: ["@engram/common", "@engram/websocket"],
};

export default nextConfig;
