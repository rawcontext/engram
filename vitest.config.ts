import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		globals: true,
		environment: "node",
		testTimeout: 30000,
		hookTimeout: 30000,
	},
	resolve: {
		// Enable TypeScript path resolution
		extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
	},
});
