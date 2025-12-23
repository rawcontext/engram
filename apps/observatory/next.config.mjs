/** @type {import('next').NextConfig} */
const nextConfig = {
	output: "standalone",
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "lh3.googleusercontent.com",
				pathname: "/**",
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
