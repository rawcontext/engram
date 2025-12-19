import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
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
	"packages/infra/vitest.config.ts",
]);
