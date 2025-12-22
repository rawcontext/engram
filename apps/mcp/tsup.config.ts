import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	// Skip DTS generation - not needed for CLI tool and has issues with workspace deps
	dts: false,
	clean: true,
	target: "node20",
	splitting: false,
	sourcemap: true,
	minify: false,

	// Bundle internal @engram/* packages for distribution
	// These are workspace dependencies that won't be available on npm
	noExternal: ["@engram/logger", "@engram/graph", "@engram/common"],

	// Keep external for:
	// - Native modules that can't be bundled
	// - Large dependencies that users should install themselves
	external: [
		// Native database clients
		"falkordb",
		"@qdrant/js-client-rest",
		// MCP SDK - users need compatible version
		"@modelcontextprotocol/sdk",
		// Storage depends on these
		"@nats-io/jetstream",
		"@nats-io/transport-node",
		"ioredis",
		// Search depends on these (optional, only for local mode)
		"@huggingface/transformers",
		"@ai-sdk/openai",
	],

	// Add shebang for CLI execution
	banner: {
		js: "#!/usr/bin/env node",
	},

	// Environment variables for build
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
	},
});
