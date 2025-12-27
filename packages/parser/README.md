# @engram/parser

Stream parser for AI provider outputs with normalization, extraction, and redaction capabilities.

## Purpose

`@engram/parser` transforms heterogeneous streaming events from 8+ AI providers into a unified `StreamDelta` format. Includes streaming extractors for thinking blocks and diffs, plus PII/secret redaction for safe storage.

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

## Usage

### Parser Registry (Recommended)

```typescript
import { defaultRegistry } from "@engram/parser";

// Get parser by provider name or alias
const parser = defaultRegistry.get("anthropic");
const delta = defaultRegistry.parse("claude", rawEvent);

// List all registered providers and aliases
const providers = defaultRegistry.providers();
const aliases = defaultRegistry.aliasNames();
```

### Direct Parser Usage

```typescript
import { AnthropicParser, OpenAIParser } from "@engram/parser";

const parser = new AnthropicParser();
const delta = parser.parse(rawEvent);
```

### Streaming Extractors

```typescript
import { ThinkingExtractor, DiffExtractor } from "@engram/parser";

// Extract <thinking>...</thinking> blocks
const thinkingExtractor = new ThinkingExtractor();
const result = thinkingExtractor.process("Hello <thinking>reasoning</thinking> world");
// { content: "Hello  world", thought: "reasoning" }

// Extract diff blocks
const diffExtractor = new DiffExtractor();
const result2 = diffExtractor.process(
  "<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE"
);
```

### PII/Secret Redaction

```typescript
import { Redactor } from "@engram/parser";

const redactor = new Redactor();
const safe = redactor.redact("Email: user@example.com API key: sk-ant-123");
// "Email: [EMAIL] API key: [ANTHROPIC_KEY_REDACTED]"
```

### Protocol Detection

```typescript
import { detectProtocol } from "@engram/parser";

const protocol = detectProtocol(httpHeaders, bodyChunk);
// Returns: "openai" | "anthropic" | "unknown"
```

## Core Types

```typescript
interface StreamDelta {
  type?: "content" | "thought" | "tool_call" | "usage" | "stop";
  role?: string;
  content?: string;
  thought?: string;
  diff?: string;
  diffFile?: string;
  toolCall?: { index?: number; id?: string; name?: string; args?: string };
  usage?: { input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number };
  cost?: number;
  timing?: { start?: number; end?: number; duration?: number };
  session?: { id?: string; messageId?: string; partId?: string; threadId?: string };
  model?: string;
  gitSnapshot?: string;
  stopReason?: string;
}

interface ParserStrategy {
  parse(payload: unknown): StreamDelta | null;
}
```

## Architecture

- **Streaming-first**: All extractors handle partial matches at chunk boundaries
- **Fail-safe parsing**: Invalid events return `null` rather than throwing
- **Zod validation**: Runtime schema validation for all provider event types
- **Zero-copy buffer**: Extractors use string slicing to avoid allocations
- **ReDoS-safe**: Redactor patterns avoid catastrophic backtracking
