import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			// Kafka tests use createRequire which bypasses vitest mocks
			// and the native module causes worker crashes
			"**/kafka.test.ts",
			"**/consumer-readiness.test.ts",
		],
		globals: true,
		environment: "node",
		testTimeout: 30000,
		hookTimeout: 30000,
		setupFiles: ["./packages/infra/vitest.setup.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary", "html"],
			reportsDirectory: "./coverage",
			exclude: [
				"**/*.test.ts",
				"**/*.spec.ts",
				"**/node_modules/**",
				"**/dist/**",
				"**/__mocks__/**",
				"**/vitest.setup.ts",
				// Infra files with untestable environmental branches
				"**/packages/infra/src/k8s/rbac.ts",
				"**/packages/infra/src/k8s/network-policy.ts",
				"**/packages/infra/src/k8s/tuner.ts",
			],
			thresholds: {
				statements: 100,
				branches: 100,
				functions: 100,
				lines: 100,
			},
		},
	},
	resolve: {
		extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
	},
});
