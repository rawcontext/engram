import { createLogger } from "@engram/logger";
import type { RerankerConfig } from "./index";
import { rerankerConfig } from "./index";

const logger = createLogger({ component: "RuntimeConfig" });

/**
 * Type for configuration update callback.
 */
type ConfigUpdateCallback = (config: RerankerConfig) => void;

/**
 * RuntimeConfig provides a singleton for managing reranker configuration
 * with support for runtime updates and hot reload.
 *
 * Features:
 * - Lazy initialization from environment
 * - Runtime configuration updates via update()
 * - Watch callbacks for configuration changes
 * - Thread-safe singleton pattern
 * - Validation on updates
 *
 * Example usage:
 * ```ts
 * // Get current config
 * const config = RuntimeConfig.get();
 *
 * // Update config at runtime
 * RuntimeConfig.update({ defaultTier: 'accurate' });
 *
 * // Watch for changes
 * const unwatch = RuntimeConfig.watch((config) => {
 *   console.log('Config updated:', config);
 * });
 *
 * // Later: stop watching
 * unwatch();
 * ```
 */
export class RuntimeConfig {
	private static instance: RuntimeConfig | null = null;
	private config: RerankerConfig;
	private watchers: Set<ConfigUpdateCallback> = new Set();

	private constructor(initialConfig?: RerankerConfig) {
		if (initialConfig) {
			this.config = initialConfig;
		} else {
			// Use the pre-loaded config from index (already has env vars applied)
			this.config = structuredClone(rerankerConfig);
			this.validateApiKeys(this.config);
		}

		logger.info({
			msg: "Runtime configuration initialized",
			enabled: this.config.enabled,
			defaultTier: this.config.defaultTier,
			timeoutMs: this.config.timeoutMs,
			abTesting: this.config.abTesting,
		});
	}

	/**
	 * Get the singleton instance of RuntimeConfig.
	 * Initializes from environment on first call.
	 *
	 * @returns Current reranker configuration
	 */
	static get(): RerankerConfig {
		if (!RuntimeConfig.instance) {
			RuntimeConfig.instance = new RuntimeConfig();
		}
		// Return a deep copy to prevent external mutation
		return structuredClone(RuntimeConfig.instance.config);
	}

	/**
	 * Update configuration at runtime.
	 * Performs deep merge with existing configuration.
	 *
	 * @param partial - Partial configuration to update
	 * @throws {Error} If validation fails
	 */
	static update(partial: Partial<RerankerConfig>): void {
		if (!RuntimeConfig.instance) {
			RuntimeConfig.instance = new RuntimeConfig();
		}

		const instance = RuntimeConfig.instance;
		const oldConfig = structuredClone(instance.config);

		// Deep merge partial config
		instance.config = RuntimeConfig.deepMerge(instance.config, partial);

		// Validate updated config
		try {
			instance.validateApiKeys(instance.config);
		} catch (error) {
			// Rollback on validation failure
			instance.config = oldConfig;
			throw error;
		}

		logger.info({
			msg: "Configuration updated",
			changes: partial,
		});

		// Notify watchers
		instance.notifyWatchers();
	}

	/**
	 * Reset configuration to environment defaults.
	 * Clears all runtime updates.
	 */
	static reset(): void {
		if (!RuntimeConfig.instance) {
			return;
		}

		const instance = RuntimeConfig.instance;
		instance.config = structuredClone(rerankerConfig);
		instance.validateApiKeys(instance.config);

		logger.info({
			msg: "Configuration reset to environment defaults",
		});

		instance.notifyWatchers();
	}

	/**
	 * Watch for configuration changes.
	 * Callback is invoked immediately with current config and on every update.
	 *
	 * @param callback - Function to call when configuration changes
	 * @returns Unwatch function to stop receiving updates
	 */
	static watch(callback: ConfigUpdateCallback): () => void {
		if (!RuntimeConfig.instance) {
			RuntimeConfig.instance = new RuntimeConfig();
		}

		const instance = RuntimeConfig.instance;
		instance.watchers.add(callback);

		// Invoke callback immediately with current config
		callback(structuredClone(instance.config));

		logger.debug({
			msg: "Configuration watcher registered",
			totalWatchers: instance.watchers.size,
		});

		// Return unwatch function
		return () => {
			instance.watchers.delete(callback);
			logger.debug({
				msg: "Configuration watcher removed",
				totalWatchers: instance.watchers.size,
			});
		};
	}

	/**
	 * Initialize runtime configuration with a specific config.
	 * Useful for testing or manual initialization.
	 *
	 * @param config - Initial configuration
	 */
	static initialize(config: RerankerConfig): void {
		RuntimeConfig.instance = new RuntimeConfig(config);
		logger.info({
			msg: "Runtime configuration manually initialized",
		});
	}

	/**
	 * Clear the singleton instance.
	 * Primarily for testing purposes.
	 */
	static destroy(): void {
		if (RuntimeConfig.instance) {
			RuntimeConfig.instance.watchers.clear();
			RuntimeConfig.instance = null;
			logger.debug({
				msg: "Runtime configuration destroyed",
			});
		}
	}

	/**
	 * Get the number of active watchers.
	 * Useful for debugging and testing.
	 */
	static getWatcherCount(): number {
		return RuntimeConfig.instance?.watchers.size ?? 0;
	}

	/**
	 * Validate that required API keys are present for enabled tiers.
	 * Logs a warning and disables the tier if API key is missing (instead of crashing).
	 *
	 * @param config - Reranker configuration
	 */
	private validateApiKeys(config: RerankerConfig): void {
		// Check if LLM tier is enabled and requires API key
		if (config.tiers.llm.enabled && !process.env.XAI_API_KEY) {
			// Log warning and disable tier instead of crashing
			logger.warn({
				msg: "XAI_API_KEY not set - LLM reranker tier will be disabled",
				tier: "llm",
			});
			config.tiers.llm.enabled = false;
		}
	}

	/**
	 * Notify all watchers of configuration change.
	 */
	private notifyWatchers(): void {
		const configCopy = structuredClone(this.config);
		for (const callback of this.watchers) {
			try {
				callback(configCopy);
			} catch (error) {
				logger.error({
					msg: "Error in configuration watcher callback",
					error,
				});
			}
		}
	}

	/**
	 * Deep merge two configuration objects.
	 * Arrays are replaced, not merged.
	 */
	private static deepMerge<T>(target: T, source: Partial<T>): T {
		const result = { ...target };

		for (const key in source) {
			const sourceValue = source[key];
			const targetValue = result[key];

			if (sourceValue === undefined) {
				continue;
			}

			// Handle nested objects
			if (
				typeof sourceValue === "object" &&
				sourceValue !== null &&
				!Array.isArray(sourceValue) &&
				typeof targetValue === "object" &&
				targetValue !== null &&
				!Array.isArray(targetValue)
			) {
				result[key] = RuntimeConfig.deepMerge(
					targetValue,
					sourceValue as Partial<typeof targetValue>,
				) as T[Extract<keyof T, string>];
			} else {
				// Replace value (including arrays)
				result[key] = sourceValue as T[Extract<keyof T, string>];
			}
		}

		return result;
	}
}
