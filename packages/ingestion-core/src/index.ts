// Extractors (refactored with BaseTagExtractor)

// Legacy re-exports for backward compatibility (deprecated)
// These files now re-export from ./extractors
export { DiffExtractor } from "./diff";
export * from "./extractors";
// Parsers
export * from "./parser/anthropic";
export * from "./parser/claude-code";
export * from "./parser/cline";
export * from "./parser/codex";
export * from "./parser/gemini";
export * from "./parser/interface";
export * from "./parser/openai";
export * from "./parser/opencode";
export * from "./parser/registry";
export * from "./parser/schemas";
export * from "./parser/xai";
// Utilities
export * from "./protocol";
export * from "./redactor";
export { ThinkingExtractor } from "./thinking";
