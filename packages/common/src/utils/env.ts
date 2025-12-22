/**
 * Environment variable utilities.
 *
 * Provides type-safe helpers for reading environment variables with defaults.
 * Consolidates patterns from across the codebase into a single source of truth.
 *
 * @module @engram/common/utils/env
 */

/**
 * Parse a boolean from an environment variable.
 *
 * Recognizes "true", "1" as true (case-insensitive).
 * Returns defaultValue if the environment variable is not set.
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns Parsed boolean value
 *
 * @example
 * ```ts
 * const debug = envBool("DEBUG", false);
 * const enabled = envBool("FEATURE_ENABLED", true);
 * ```
 */
export function envBool(key: string, defaultValue: boolean): boolean {
	const val = process.env[key];
	if (val === undefined) return defaultValue;
	return val.toLowerCase() === "true" || val === "1";
}

/**
 * Parse a number from an environment variable.
 *
 * Returns defaultValue if the environment variable is not set or not a valid number.
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set or invalid
 * @returns Parsed number value
 *
 * @example
 * ```ts
 * const port = envNum("PORT", 3000);
 * const timeout = envNum("TIMEOUT_MS", 5000);
 * ```
 */
export function envNum(key: string, defaultValue: number): number {
	const val = process.env[key];
	if (val === undefined) return defaultValue;
	const parsed = Number.parseInt(val, 10);
	return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse a float from an environment variable.
 *
 * Returns defaultValue if the environment variable is not set or not a valid number.
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set or invalid
 * @returns Parsed float value
 *
 * @example
 * ```ts
 * const threshold = envFloat("SCORE_THRESHOLD", 0.75);
 * ```
 */
export function envFloat(key: string, defaultValue: number): number {
	const val = process.env[key];
	if (val === undefined) return defaultValue;
	const parsed = Number.parseFloat(val);
	return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get a string from an environment variable.
 *
 * Returns defaultValue if the environment variable is not set.
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns String value
 *
 * @example
 * ```ts
 * const host = envStr("REDIS_HOST", "localhost");
 * const model = envStr("RERANK_MODEL", "ms-marco-MiniLM-L-6-v2");
 * ```
 */
export function envStr(key: string, defaultValue: string): string {
	return process.env[key] ?? defaultValue;
}

/**
 * Get a required environment variable.
 *
 * Throws an error if the environment variable is not set.
 *
 * @param key - Environment variable name
 * @returns String value
 * @throws Error if the environment variable is not set
 *
 * @example
 * ```ts
 * const apiKey = envRequired("API_KEY"); // Throws if not set
 * ```
 */
export function envRequired(key: string): string {
	const val = process.env[key];
	if (val === undefined || val === "") {
		throw new Error(`Required environment variable ${key} is not set`);
	}
	return val;
}

/**
 * Get an environment variable as a string array.
 *
 * Splits the value by the specified delimiter.
 * Returns defaultValue if the environment variable is not set.
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @param delimiter - Delimiter to split on (default: ",")
 * @returns Array of strings
 *
 * @example
 * ```ts
 * const servers = envArray("NATS_SERVERS", ["localhost:4222"]);
 * const hosts = envArray("REDIS_HOSTS", ["127.0.0.1"], ";");
 * ```
 */
export function envArray(key: string, defaultValue: string[], delimiter: string = ","): string[] {
	const val = process.env[key];
	if (val === undefined || val === "") return defaultValue;
	return val.split(delimiter).map((item) => item.trim());
}
