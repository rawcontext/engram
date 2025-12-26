/** @type {import('next').NextConfig} */
const nextConfig = {
	// Note: We use a custom server.ts for WebSocket support,
	// so we cannot use "output: standalone" which requires server.js
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "lh3.googleusercontent.com",
				port: "",
				pathname: "/**",
				search: "",
			},
		],
	},
	serverExternalPackages: [
		"@huggingface/transformers",
		"onnxruntime-node",
		"sharp",
		"pino",
		"pino-pretty",
		"thread-stream",
		"sonic-boom",
		// FalkorDB and its dependency @js-temporal/polyfill have BigInt bundling issues
		"falkordb",
		"@js-temporal/polyfill",
		// PostgreSQL driver for Better Auth
		"pg",
	],
};

export default nextConfig;
