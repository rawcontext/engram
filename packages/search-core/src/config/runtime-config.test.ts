import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DEFAULT_RERANKER_CONFIG, RuntimeConfig } from "./index";

describe("RuntimeConfig", () => {
	// Store original env
	const originalEnv = { ...process.env };

	beforeEach(() => {
		// Set dummy API key to avoid validation errors
		process.env.XAI_API_KEY = "test-api-key";
		// Clean up singleton before each test
		RuntimeConfig.destroy();
	});

	afterEach(() => {
		RuntimeConfig.destroy();
		// Restore original env
		process.env = { ...originalEnv };
	});

	describe("get", () => {
		test("should initialize from environment on first call", () => {
			const config = RuntimeConfig.get();

			expect(config).toBeDefined();
			expect(config.enabled).toBe(true);
			expect(config.defaultTier).toBe("fast");
		});

		test("should return same config on subsequent calls", () => {
			const config1 = RuntimeConfig.get();
			const config2 = RuntimeConfig.get();

			expect(config1).toEqual(config2);
		});

		test("should return deep copy (prevent external mutation)", () => {
			const config1 = RuntimeConfig.get();
			config1.enabled = false;
			config1.defaultTier = "llm";

			const config2 = RuntimeConfig.get();

			expect(config2.enabled).toBe(true);
			expect(config2.defaultTier).toBe("fast");
		});
	});

	describe("update", () => {
		test("should update top-level properties", () => {
			RuntimeConfig.update({ enabled: false });

			const config = RuntimeConfig.get();
			expect(config.enabled).toBe(false);
		});

		test("should update nested properties", () => {
			RuntimeConfig.update({
				tiers: {
					fast: {
						model: "custom/model",
						maxCandidates: 100,
						batchSize: 32,
						enabled: false,
					},
				},
			});

			const config = RuntimeConfig.get();
			expect(config.tiers.fast.model).toBe("custom/model");
			expect(config.tiers.fast.maxCandidates).toBe(100);
			expect(config.tiers.fast.batchSize).toBe(32);
			expect(config.tiers.fast.enabled).toBe(false);
		});

		test("should deep merge nested objects", () => {
			// Update only one property of fast tier
			RuntimeConfig.update({
				tiers: {
					fast: {
						model: "custom/model",
					},
				},
			});

			const config = RuntimeConfig.get();
			expect(config.tiers.fast.model).toBe("custom/model");
			// Other properties should remain unchanged
			expect(config.tiers.fast.maxCandidates).toBe(
				DEFAULT_RERANKER_CONFIG.tiers.fast.maxCandidates,
			);
			expect(config.tiers.fast.batchSize).toBe(DEFAULT_RERANKER_CONFIG.tiers.fast.batchSize);
			expect(config.tiers.fast.enabled).toBe(DEFAULT_RERANKER_CONFIG.tiers.fast.enabled);
		});

		test("should notify watchers on update", () => {
			let callCount = 0;
			let lastConfig = null;

			RuntimeConfig.watch((config) => {
				callCount++;
				lastConfig = config;
			});

			// Reset count after initial watch call
			callCount = 0;

			RuntimeConfig.update({ enabled: false });

			expect(callCount).toBe(1);
			expect(lastConfig?.enabled).toBe(false);
		});

		test("should auto-disable LLM tier when API key is missing", () => {
			// Delete XAI_API_KEY before update
			delete process.env.XAI_API_KEY;

			// Try to enable LLM tier without API key
			RuntimeConfig.update({
				tiers: {
					llm: {
						enabled: true,
					},
				},
			});

			const currentConfig = RuntimeConfig.get();
			// LLM tier should be auto-disabled (not crash) when API key is missing
			expect(currentConfig.tiers.llm.enabled).toBe(false);
		});
	});

	describe("reset", () => {
		test("should reset to environment defaults", () => {
			// Make some updates
			RuntimeConfig.update({ enabled: false, defaultTier: "llm" });

			const updatedConfig = RuntimeConfig.get();
			expect(updatedConfig.enabled).toBe(false);
			expect(updatedConfig.defaultTier).toBe("llm");

			// Reset
			RuntimeConfig.reset();

			const resetConfig = RuntimeConfig.get();
			expect(resetConfig.enabled).toBe(true);
			expect(resetConfig.defaultTier).toBe("fast");
		});

		test("should notify watchers on reset", () => {
			let callCount = 0;

			RuntimeConfig.watch(() => {
				callCount++;
			});

			// Reset count after initial watch call
			callCount = 0;

			RuntimeConfig.reset();

			expect(callCount).toBe(1);
		});
	});

	describe("watch", () => {
		test("should invoke callback immediately with current config", () => {
			let callCount = 0;
			let receivedConfig = null;

			RuntimeConfig.watch((config) => {
				callCount++;
				receivedConfig = config;
			});

			expect(callCount).toBe(1);
			expect(receivedConfig).toBeDefined();
		});

		test("should invoke callback on config update", () => {
			let callCount = 0;

			RuntimeConfig.watch(() => {
				callCount++;
			});

			// Reset count after initial call
			callCount = 0;

			RuntimeConfig.update({ enabled: false });

			expect(callCount).toBe(1);
		});

		test("should support multiple watchers", () => {
			let count1 = 0;
			let count2 = 0;

			RuntimeConfig.watch(() => {
				count1++;
			});
			RuntimeConfig.watch(() => {
				count2++;
			});

			// Reset counts after initial calls
			count1 = 0;
			count2 = 0;

			RuntimeConfig.update({ enabled: false });

			expect(count1).toBe(1);
			expect(count2).toBe(1);
		});

		test("should return unwatch function", () => {
			let callCount = 0;

			const unwatch = RuntimeConfig.watch(() => {
				callCount++;
			});

			// Reset count after initial call
			callCount = 0;

			RuntimeConfig.update({ enabled: false });
			expect(callCount).toBe(1);

			// Unwatch
			unwatch();

			RuntimeConfig.update({ enabled: true });
			expect(callCount).toBe(1); // Should not increase
		});

		test("should handle watcher errors gracefully", () => {
			let goodCallCount = 0;
			let badWatcherCalled = false;

			// Add a watcher that throws (but catch it)
			RuntimeConfig.watch(() => {
				badWatcherCalled = true;
				if (badWatcherCalled && goodCallCount > 0) {
					// Only throw on update, not initial call
					throw new Error("Watcher error");
				}
			});

			// Add a good watcher
			RuntimeConfig.watch(() => {
				goodCallCount++;
			});

			// Reset state after initial calls
			goodCallCount = 0;
			badWatcherCalled = false;

			// Update should not throw, and good watcher should still be called
			expect(() => RuntimeConfig.update({ enabled: false })).not.toThrow();
			expect(goodCallCount).toBe(1);
		});

		test("should provide deep copy to watchers", () => {
			let receivedConfig = null;

			RuntimeConfig.watch((config) => {
				receivedConfig = config;
			});

			// Mutate received config
			receivedConfig.enabled = false;

			// Get fresh config
			const freshConfig = RuntimeConfig.get();
			expect(freshConfig.enabled).toBe(true);
		});
	});

	describe("initialize", () => {
		test("should initialize with custom config", () => {
			const customConfig = {
				...DEFAULT_RERANKER_CONFIG,
				enabled: false,
				defaultTier: "accurate" as const,
			};

			RuntimeConfig.initialize(customConfig);

			const config = RuntimeConfig.get();
			expect(config.enabled).toBe(false);
			expect(config.defaultTier).toBe("accurate");
		});

		test("should replace existing instance", () => {
			// Initialize first time
			RuntimeConfig.get();

			const customConfig = {
				...DEFAULT_RERANKER_CONFIG,
				enabled: false,
			};

			RuntimeConfig.initialize(customConfig);

			const config = RuntimeConfig.get();
			expect(config.enabled).toBe(false);
		});
	});

	describe("destroy", () => {
		test("should clear singleton instance", () => {
			RuntimeConfig.get();
			RuntimeConfig.destroy();

			// Should reinitialize on next get
			const config = RuntimeConfig.get();
			expect(config).toBeDefined();
		});

		test("should clear all watchers", () => {
			let callCount = 0;

			RuntimeConfig.watch(() => {
				callCount++;
			});

			RuntimeConfig.destroy();
			callCount = 0;

			// Reinitialize
			RuntimeConfig.get();

			// Update should not trigger old watcher
			RuntimeConfig.update({ enabled: false });
			expect(callCount).toBe(0);
		});
	});

	describe("getWatcherCount", () => {
		test("should return 0 when no instance", () => {
			expect(RuntimeConfig.getWatcherCount()).toBe(0);
		});

		test("should return correct count", () => {
			RuntimeConfig.watch(() => {});
			expect(RuntimeConfig.getWatcherCount()).toBe(1);

			RuntimeConfig.watch(() => {});
			expect(RuntimeConfig.getWatcherCount()).toBe(2);

			const unwatch = RuntimeConfig.watch(() => {});
			expect(RuntimeConfig.getWatcherCount()).toBe(3);

			unwatch();
			expect(RuntimeConfig.getWatcherCount()).toBe(2);
		});
	});
});
