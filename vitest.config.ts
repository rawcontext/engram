import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			// Default configuration for most packages (fast unit tests)
			{
				test: {
					name: "default",
					include: [
						"apps/**/*.test.ts",
						"packages/**/*.test.ts",
						// Exclude infra - it has its own config
						"!packages/infra/**/*.test.ts",
						// Exclude integration tests - run separately with test:integration
						"!**/*.integration.test.ts",
					],
					exclude: ["**/node_modules/**", "**/dist/**"],
					globals: true,
					environment: "node",
					testTimeout: 30000,
					hookTimeout: 30000,
				},
			},
			// Integration tests (WebSocket, E2E mocking, etc.) - run with test:integration
			{
				test: {
					name: "integration",
					include: ["**/*.integration.test.ts"],
					exclude: ["**/node_modules/**", "**/dist/**"],
					globals: true,
					environment: "node",
					testTimeout: 60000,
					hookTimeout: 60000,
				},
			},
			// Infrastructure package needs Pulumi mocks
			{
				test: {
					name: "@engram/infra",
					root: "./packages/infra",
					setupFiles: ["./vitest.setup.ts"],
					include: ["src/**/*.test.ts"],
					globals: true,
				},
			},
		],
	},
	resolve: {
		extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
	},
});
