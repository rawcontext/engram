/** @type {import('next').NextConfig} */
const nextConfig = {
	output: "standalone",
	serverExternalPackages: [
		"@huggingface/transformers",
		"onnxruntime-node",
		"sharp",
		"pino",
		"pino-pretty",
		"thread-stream",
		"sonic-boom",
		"@confluentinc/kafka-javascript",
		// FalkorDB and its dependency @js-temporal/polyfill have BigInt bundling issues
		"falkordb",
		"@js-temporal/polyfill",
	],
};

export default nextConfig;
