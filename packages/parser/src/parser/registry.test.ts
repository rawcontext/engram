import { describe, expect, it } from "vitest";
import { AnthropicParser } from "./anthropic";
import { OpenAIParser } from "./openai";
import { createDefaultRegistry, defaultRegistry, ParserRegistry } from "./registry";

describe("ParserRegistry", () => {
	describe("register and get", () => {
		it("should register and retrieve a parser", () => {
			const registry = new ParserRegistry();
			const parser = new AnthropicParser();
			registry.register("anthropic", parser);

			expect(registry.get("anthropic")).toBe(parser);
		});

		it("should be case-insensitive for provider names", () => {
			const registry = new ParserRegistry();
			const parser = new AnthropicParser();
			registry.register("Anthropic", parser);

			expect(registry.get("anthropic")).toBe(parser);
			expect(registry.get("ANTHROPIC")).toBe(parser);
			expect(registry.get("AnThRoPiC")).toBe(parser);
		});

		it("should return undefined for unregistered providers", () => {
			const registry = new ParserRegistry();
			expect(registry.get("unknown")).toBeUndefined();
		});
	});

	describe("aliases", () => {
		it("should register and resolve aliases", () => {
			const registry = new ParserRegistry();
			const parser = new OpenAIParser();
			registry.register("openai", parser);
			registry.registerAlias("gpt", "openai");

			expect(registry.get("gpt")).toBe(parser);
		});

		it("should be case-insensitive for aliases", () => {
			const registry = new ParserRegistry();
			const parser = new OpenAIParser();
			registry.register("openai", parser);
			registry.registerAlias("GPT", "OpenAI");

			expect(registry.get("gpt")).toBe(parser);
			expect(registry.get("GPT")).toBe(parser);
		});

		it("should return undefined for alias pointing to non-existent provider", () => {
			const registry = new ParserRegistry();
			registry.registerAlias("gpt", "openai");

			expect(registry.get("gpt")).toBeUndefined();
		});
	});

	describe("has", () => {
		it("should return true for registered providers", () => {
			const registry = new ParserRegistry();
			registry.register("anthropic", new AnthropicParser());

			expect(registry.has("anthropic")).toBe(true);
		});

		it("should return true for registered aliases", () => {
			const registry = new ParserRegistry();
			registry.register("anthropic", new AnthropicParser());
			registry.registerAlias("claude", "anthropic");

			expect(registry.has("claude")).toBe(true);
		});

		it("should return false for unregistered providers", () => {
			const registry = new ParserRegistry();
			expect(registry.has("unknown")).toBe(false);
		});
	});

	describe("providers", () => {
		it("should return all registered provider names", () => {
			const registry = new ParserRegistry();
			registry.register("anthropic", new AnthropicParser());
			registry.register("openai", new OpenAIParser());

			const providers = registry.providers();
			expect(providers).toContain("anthropic");
			expect(providers).toContain("openai");
			expect(providers).toHaveLength(2);
		});

		it("should not include aliases in providers list", () => {
			const registry = new ParserRegistry();
			registry.register("anthropic", new AnthropicParser());
			registry.registerAlias("claude", "anthropic");

			const providers = registry.providers();
			expect(providers).toContain("anthropic");
			expect(providers).not.toContain("claude");
		});
	});

	describe("aliasNames", () => {
		it("should return all registered alias names", () => {
			const registry = new ParserRegistry();
			registry.register("anthropic", new AnthropicParser());
			registry.registerAlias("claude", "anthropic");
			registry.registerAlias("sonnet", "anthropic");

			const aliases = registry.aliasNames();
			expect(aliases).toContain("claude");
			expect(aliases).toContain("sonnet");
			expect(aliases).toHaveLength(2);
		});
	});

	describe("parse", () => {
		it("should parse using the correct provider parser", () => {
			const registry = new ParserRegistry();
			registry.register("anthropic", new AnthropicParser());

			const event = {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "Hello" },
			};

			const result = registry.parse("anthropic", event);
			expect(result).toEqual({ role: "assistant", content: "Hello" });
		});

		it("should parse using aliases", () => {
			const registry = new ParserRegistry();
			registry.register("openai", new OpenAIParser());
			registry.registerAlias("gpt", "openai");

			const event = {
				choices: [{ delta: { content: "Hello" } }],
			};

			const result = registry.parse("gpt", event);
			expect(result).toEqual({ type: "content", content: "Hello" });
		});

		it("should return null for unknown providers", () => {
			const registry = new ParserRegistry();
			const result = registry.parse("unknown", { data: "test" });
			expect(result).toBeNull();
		});
	});
});

describe("createDefaultRegistry", () => {
	it("should create a registry with all 8 parsers", () => {
		const registry = createDefaultRegistry();
		const providers = registry.providers();

		expect(providers).toContain("anthropic");
		expect(providers).toContain("openai");
		expect(providers).toContain("claude_code");
		expect(providers).toContain("gemini");
		expect(providers).toContain("codex");
		expect(providers).toContain("cline");
		expect(providers).toContain("xai");
		expect(providers).toContain("opencode");
		expect(providers).toHaveLength(8);
	});

	it("should have aliases registered", () => {
		const registry = createDefaultRegistry();

		expect(registry.has("gpt")).toBe(true);
		expect(registry.has("claude")).toBe(true);
		expect(registry.has("grok")).toBe(true);
		expect(registry.has("claude-code")).toBe(true);
	});

	it("should resolve gpt alias to openai", () => {
		const registry = createDefaultRegistry();
		const openaiParser = registry.get("openai");
		const gptParser = registry.get("gpt");

		expect(gptParser).toBe(openaiParser);
	});

	it("should resolve claude alias to anthropic", () => {
		const registry = createDefaultRegistry();
		const anthropicParser = registry.get("anthropic");
		const claudeParser = registry.get("claude");

		expect(claudeParser).toBe(anthropicParser);
	});
});

describe("defaultRegistry", () => {
	it("should be a pre-configured singleton", () => {
		expect(defaultRegistry).toBeDefined();
		expect(defaultRegistry.providers()).toHaveLength(8);
	});

	it("should parse anthropic events", () => {
		const event = {
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: "Hello from Anthropic" },
		};

		const result = defaultRegistry.parse("anthropic", event);
		expect(result).toEqual({ role: "assistant", content: "Hello from Anthropic" });
	});

	it("should parse openai events via gpt alias", () => {
		const event = {
			choices: [{ delta: { content: "Hello from OpenAI" } }],
		};

		const result = defaultRegistry.parse("gpt", event);
		expect(result).toEqual({ type: "content", content: "Hello from OpenAI" });
	});
});
