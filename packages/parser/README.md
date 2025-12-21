# @engram/parser

Stream parser for AI provider outputs with normalization, extraction, and redaction capabilities.

## Overview

`@engram/parser` transforms heterogeneous streaming events from 8+ AI providers into a unified `StreamDelta` format. Includes streaming extractors for thinking blocks and diffs, plus PII/secret redaction for safe storage.

## Features

- **Provider Parsers**: Normalize streaming events from Anthropic, OpenAI, Gemini, Claude Code, Cline, Codex, XAI, and OpenCode
- **Streaming Extractors**: Real-time extraction of `<thinking>` blocks and diff blocks with partial-match handling at chunk boundaries
- **Parser Registry**: Lookup-based parser selection with alias support (e.g., `claude` → `anthropic`, `gpt` → `openai`)
- **Protocol Detection**: Auto-detect provider from HTTP headers or event structure
- **Zod Validation**: Runtime schema validation for all provider event types
- **Redaction**: Strip PII, API keys, credentials, and secrets from text
- **Type-Safe**: Full TypeScript support with discriminated unions for all event types

## Installation

```bash
npm install @engram/parser
```

## Supported Providers

| Provider | Registry Key | Aliases |
|----------|--------------|---------|
| Anthropic | `anthropic` | `claude` |
| OpenAI | `openai` | `gpt`, `gpt-4`, `gpt-3.5`, `gpt4` |
| Gemini | `gemini` | - |
| Claude Code | `claude_code` | `claude-code` |
| Cline | `cline` | - |
| Codex | `codex` | - |
| XAI (Grok) | `xai` | `grok`, `grok-3` |
| OpenCode | `opencode` | - |

## Core Concepts

### StreamDelta

All parsers produce a normalized `StreamDelta` object:

```typescript
interface StreamDelta {
  type?: "content" | "thought" | "tool_call" | "usage" | "stop";
  role?: string;                    // "user" | "assistant"
  content?: string;                 // Regular text content
  thought?: string;                 // Extracted thinking/reasoning
  diff?: string;                    // Extracted diff block
  diffFile?: string;                // File path for diff
  toolCall?: {
    index?: number;
    id?: string;
    name?: string;
    args?: string;                  // Partial JSON
  };
  usage?: {
    input?: number;                 // Input tokens
    output?: number;                // Output tokens
    reasoning?: number;             // Extended thinking tokens
    cacheRead?: number;             // Cache read tokens
    cacheWrite?: number;            // Cache write tokens
    total?: number;
  };
  cost?: number;                    // Cost in USD
  timing?: {
    start?: number;                 // Start timestamp (ms epoch)
    end?: number;                   // End timestamp (ms epoch)
    duration?: number;              // Duration in ms
  };
  session?: {
    id?: string;
    messageId?: string;
    partId?: string;
    threadId?: string;
  };
  model?: string;
  gitSnapshot?: string;             // Git commit hash
  stopReason?: string;
}
```

### ParserStrategy

All parsers implement the `ParserStrategy` interface:

```typescript
interface ParserStrategy {
  parse(payload: unknown): StreamDelta | null;
}
```

## Usage

### Basic Parsing

```typescript
import { AnthropicParser, OpenAIParser } from "@engram/parser";

// Direct parser usage
const anthropicParser = new AnthropicParser();
const delta = anthropicParser.parse(rawEvent);

const openaiParser = new OpenAIParser();
const delta2 = openaiParser.parse(rawChunk);
```

### Parser Registry (Recommended)

```typescript
import { defaultRegistry } from "@engram/parser";

// Get parser by provider name or alias
const parser = defaultRegistry.get("anthropic");  // Returns AnthropicParser
const parser2 = defaultRegistry.get("claude");    // Same parser (alias)
const parser3 = defaultRegistry.get("gpt");       // Returns OpenAIParser

// Parse with registry
const delta = defaultRegistry.parse("anthropic", rawEvent);

// Check if provider is registered
if (defaultRegistry.has("xai")) {
  const parser = defaultRegistry.get("xai");
}

// List all registered providers
const providers = defaultRegistry.providers();
// ["anthropic", "openai", "gemini", "claude_code", "cline", "codex", "xai", "opencode"]

const aliases = defaultRegistry.aliasNames();
// ["gpt", "gpt-4", "gpt-3.5", "gpt4", "claude", "claude-code", "grok", "grok-3"]
```

### Custom Registry

```typescript
import { ParserRegistry, AnthropicParser } from "@engram/parser";

const registry = new ParserRegistry();
registry.register("anthropic", new AnthropicParser());
registry.registerAlias("claude", "anthropic");

const parser = registry.get("claude");
```

### Protocol Detection

```typescript
import { detectProtocol } from "@engram/parser";

const protocol = detectProtocol(httpHeaders, bodyChunk);
// Returns: "openai" | "anthropic" | "unknown"

if (protocol === "anthropic") {
  const parser = defaultRegistry.get("anthropic");
  const delta = parser.parse(bodyChunk);
}
```

### Thinking Block Extraction

Extract `<thinking>...</thinking>` blocks from streaming text:

```typescript
import { ThinkingExtractor } from "@engram/parser";

const extractor = new ThinkingExtractor();

// Process streaming chunks
const result1 = extractor.process("Hello <think");
// { content: "Hello " }

const result2 = extractor.process("ing>I am reasoning</thinking> world");
// { content: " world", thought: "I am reasoning" }

// Flush remaining buffer when stream ends
const result3 = extractor.flush();

// Reset for reuse
extractor.reset();
```

### Diff Block Extraction

Extract search/replace diff blocks:

```typescript
import { DiffExtractor } from "@engram/parser";

const extractor = new DiffExtractor();

const result = extractor.process(
  "Some text <<<<<<< SEARCH\nold code\n=======\nnew code\n>>>>>>> REPLACE more text"
);
// {
//   content: "Some text  more text",
//   diff: "<<<<<<< SEARCH\nold code\n=======\nnew code\n>>>>>>> REPLACE"
// }
```

### PII/Secret Redaction

```typescript
import { Redactor } from "@engram/parser";

const redactor = new Redactor();
const safe = redactor.redact(
  "My email is user@example.com and API key is sk-ant-1234567890abcdef"
);
// "My email is [EMAIL] and API key is [ANTHROPIC_KEY_REDACTED]"
```

**Redacted Patterns**:
- Emails
- SSNs (US format)
- Credit card numbers
- Phone numbers (7-15 digits)
- API keys: OpenAI, Anthropic, AWS, GitHub, Google, NPM
- JWT tokens
- Private keys (PEM format)
- Database URLs
- Bearer tokens
- Password fields

### Zod Schema Validation

```typescript
import {
  parseAnthropicEvent,
  parseOpenAIChunk,
  parseClaudeCodeEvent,
  AnthropicEventSchema,
} from "@engram/parser";

// Safe parsing with error details
const result = parseAnthropicEvent(rawPayload);
if (result.success) {
  console.log(result.data);  // Typed as AnthropicEvent
} else {
  console.error(result.error.issues);  // Zod validation errors
}

// Direct schema usage
const validated = AnthropicEventSchema.parse(rawPayload);  // Throws on error
```

## Exported APIs

### Parsers

- `AnthropicParser` - Anthropic streaming events
- `OpenAIParser` - OpenAI chat completion chunks
- `GeminiParser` - Gemini custom event format
- `ClaudeCodeParser` - Claude Code CLI events
- `ClineParser` - Cline VSCode extension events
- `CodexParser` - Codex streaming events
- `XAIParser` - xAI (Grok) streaming events (extends OpenAI format)
- `OpenCodeParser` - OpenCode streaming events

### Registry

- `ParserRegistry` - Custom registry class
- `createDefaultRegistry()` - Factory for pre-populated registry
- `defaultRegistry` - Singleton with all parsers and aliases

### Extractors

- `BaseTagExtractor<TField>` - Abstract base class for tag extractors
- `ThinkingExtractor` - Extract `<thinking>` blocks
- `DiffExtractor` - Extract diff blocks

### Utilities

- `detectProtocol(headers, bodyChunk)` - Auto-detect provider protocol
- `Redactor` - PII/secret redaction

### Schemas (Zod)

All provider event schemas exported with corresponding TypeScript types:

- `AnthropicEventSchema`, `AnthropicEvent`
- `OpenAIChunkSchema`, `OpenAIChunk`
- `XAIChunkSchema`, `XAIChunk`
- `ClaudeCodeEventSchema`, `ClaudeCodeEvent`
- `GeminiEventSchema`, `GeminiEvent`
- `CodexEventSchema`, `CodexEvent`
- `ClineEventSchema`, `ClineEvent`
- `OpenCodeEventSchema`, `OpenCodeEvent`

Plus helper functions:
- `parseAnthropicEvent(payload)`
- `parseOpenAIChunk(payload)`
- `parseXAIChunk(payload)`
- `parseClaudeCodeEvent(payload)`
- `parseGeminiEvent(payload)`
- `parseCodexEvent(payload)`
- `parseClineEvent(payload)`
- `parseOpenCodeEvent(payload)`

### Types

- `StreamDelta` - Normalized event format
- `ParserStrategy` - Parser interface
- `TagExtractorConfig<TField>` - Extractor configuration
- `Protocol` - `"openai" | "anthropic" | "unknown"`

## Dependencies

- `zod` (v4.2.1) - Runtime schema validation
- `@engram/events` - Event type definitions
- `@engram/common` - Shared utilities

## Adding a New Provider

1. **Define Zod schemas** in `src/parser/schemas.ts`:
   ```typescript
   export const MyProviderEventSchema = z.object({
     type: z.literal("message"),
     content: z.string(),
   });
   export type MyProviderEvent = z.infer<typeof MyProviderEventSchema>;
   ```

2. **Implement ParserStrategy** in `src/parser/my-provider.ts`:
   ```typescript
   import type { ParserStrategy, StreamDelta } from "./interface";
   import { MyProviderEventSchema } from "./schemas";

   export class MyProviderParser implements ParserStrategy {
     parse(payload: unknown): StreamDelta | null {
       const result = MyProviderEventSchema.safeParse(payload);
       if (!result.success) return null;

       return {
         content: result.data.content,
         role: "assistant",
       };
     }
   }
   ```

3. **Register in `src/parser/registry.ts`**:
   ```typescript
   import { MyProviderParser } from "./my-provider";

   export function createDefaultRegistry(): ParserRegistry {
     const registry = new ParserRegistry();
     // ... existing registrations
     registry.register("my_provider", new MyProviderParser());
     registry.registerAlias("mp", "my_provider");
     return registry;
   }
   ```

4. **Export from `src/index.ts`**:
   ```typescript
   export * from "./parser/my-provider";
   ```

5. **Add provider to `ProviderEnum`** in `@engram/events`

## Architecture Notes

- **Streaming-first**: All extractors handle partial matches at chunk boundaries
- **Fail-safe parsing**: Invalid events return `null` rather than throwing
- **Zero-copy buffer**: Extractors use string slicing to avoid unnecessary allocations
- **Type-safe dynamics**: `BaseTagExtractor` uses `Object.defineProperty` for type-safe dynamic field assignment
- **ReDoS-safe**: Redactor patterns avoid catastrophic backtracking
