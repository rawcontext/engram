import { AnthropicParser } from "./anthropic";
import { ClaudeCodeParser } from "./claude-code";
import { ClineParser } from "./cline";
import { CodexParser } from "./codex";
import { GeminiParser } from "./gemini";
import type { ParserStrategy, StreamDelta } from "./interface";
import { OpenAIParser } from "./openai";
import { OpenCodeParser } from "./opencode";
import { XAIParser } from "./xai";

/**
 * Registry for provider-specific stream parsers.
 *
 * Replaces the 8-way if-else chain in the ingestion app with a
 * lookup-based approach that supports aliases and is extensible.
 */
export class ParserRegistry {
	private parsers = new Map<string, ParserStrategy>();
	private aliases = new Map<string, string>();

	/**
	 * Register a parser for a provider.
	 * @param provider - The provider identifier (case-insensitive)
	 * @param parser - The parser implementation
	 */
	register(provider: string, parser: ParserStrategy): void {
		this.parsers.set(provider.toLowerCase(), parser);
	}

	/**
	 * Register an alias that maps to an existing provider.
	 * @param alias - The alias (case-insensitive)
	 * @param provider - The target provider (case-insensitive)
	 */
	registerAlias(alias: string, provider: string): void {
		this.aliases.set(alias.toLowerCase(), provider.toLowerCase());
	}

	/**
	 * Get a parser for a provider or alias.
	 * @param provider - The provider identifier or alias (case-insensitive)
	 * @returns The parser, or undefined if not found
	 */
	get(provider: string): ParserStrategy | undefined {
		const key = provider.toLowerCase();
		const resolvedKey = this.aliases.get(key) ?? key;
		return this.parsers.get(resolvedKey);
	}

	/**
	 * Check if a provider or alias is registered.
	 * @param provider - The provider identifier or alias (case-insensitive)
	 * @returns True if the provider is registered
	 */
	has(provider: string): boolean {
		const key = provider.toLowerCase();
		return this.parsers.has(key) || this.aliases.has(key);
	}

	/**
	 * Get all registered provider names (not aliases).
	 * @returns Array of provider names
	 */
	providers(): string[] {
		return Array.from(this.parsers.keys());
	}

	/**
	 * Get all registered aliases.
	 * @returns Array of alias names
	 */
	aliasNames(): string[] {
		return Array.from(this.aliases.keys());
	}

	/**
	 * Parse a payload using the appropriate provider parser.
	 * @param provider - The provider identifier or alias
	 * @param payload - The raw event payload
	 * @returns The parsed stream delta, or null if no parser found or parse fails
	 */
	parse(provider: string, payload: unknown): StreamDelta | null {
		const parser = this.get(provider);
		if (!parser) {
			return null;
		}
		return parser.parse(payload);
	}
}

/**
 * Create a registry pre-populated with all known parsers and aliases.
 * @returns A new ParserRegistry with all parsers registered
 */
export function createDefaultRegistry(): ParserRegistry {
	const registry = new ParserRegistry();

	// Register all parsers
	registry.register("anthropic", new AnthropicParser());
	registry.register("openai", new OpenAIParser());
	registry.register("claude_code", new ClaudeCodeParser());
	registry.register("gemini", new GeminiParser());
	registry.register("codex", new CodexParser());
	registry.register("cline", new ClineParser());
	registry.register("xai", new XAIParser());
	registry.register("opencode", new OpenCodeParser());

	// Register common aliases
	registry.registerAlias("gpt", "openai");
	registry.registerAlias("gpt-4", "openai");
	registry.registerAlias("gpt-3.5", "openai");
	registry.registerAlias("gpt4", "openai");
	registry.registerAlias("claude", "anthropic");
	registry.registerAlias("claude-code", "claude_code");
	registry.registerAlias("grok", "xai");
	registry.registerAlias("grok-3", "xai");

	return registry;
}

/**
 * Default singleton registry with all parsers registered.
 * Use this for most cases; create a custom registry only when needed.
 */
export const defaultRegistry = createDefaultRegistry();
