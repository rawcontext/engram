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
				// Barrel index files (re-exports only)
				"**/packages/*/src/index.ts",
				"**/packages/*/src/*/index.ts",
				// Interface/type-only files
				"**/packages/storage/src/interfaces.ts",
				"**/packages/logger/src/types.ts",
				"**/packages/parser/src/parser/interface.ts",
				"**/packages/parser/src/diff.ts",
				"**/packages/parser/src/thinking.ts",
				"**/packages/vfs/src/interfaces.ts",
				// Infra files with untestable environmental branches
				"**/packages/infra/src/k8s/rbac.ts",
				"**/packages/infra/src/k8s/network-policy.ts",
				"**/packages/infra/src/k8s/tuner.ts",
				// Native Kafka module files (use createRequire, can't be mocked)
				"**/packages/storage/src/kafka.ts",
				"**/packages/storage/src/consumer-readiness.ts",
				// Spawns child processes for benchmark CLI
				"**/packages/tuner/src/executor/evaluation-adapter.ts",
			],
			thresholds: {
				statements: 90,
				branches: 85,
				functions: 90,
				lines: 90,
			},
		},
	},
	resolve: {
		extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
	},
});
