import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			// Default configuration for most packages
			{
				test: {
					name: "default",
					include: [
						"apps/**/*.test.ts",
						"packages/**/*.test.ts",
						// Exclude infra - it has its own config
						"!packages/infra/**/*.test.ts",
					],
					exclude: ["**/node_modules/**", "**/dist/**"],
					globals: true,
					environment: "node",
					testTimeout: 30000,
					hookTimeout: 30000,
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
