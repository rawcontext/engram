# @engram/parser

Parses AI provider stream outputs into standardized event format.

## Overview

Normalizes heterogeneous AI provider outputs into a unified streaming event format. Supports multiple LLM providers and includes extractors for thinking blocks and diffs.

## Installation

```bash
npm install @engram/parser
```

## Supported Providers

| Provider | Import |
|:---------|:-------|
| Anthropic | `anthropic` |
| OpenAI | `openai` |
| Gemini | `gemini` |
| Claude Code | `claude-code` |
| Cline | `cline` |
| Codex | `codex` |
| XAI | `xai` |
| OpenCode | `opencode` |

## Usage

### Provider Parsers

```typescript
import { anthropic, openai, gemini } from "@engram/parser";

// Parse Anthropic streaming events
const parser = anthropic();
const delta = parser.parse(rawEvent);
```

### Stream Delta Interface

All parsers produce a normalized `StreamDelta`:

```typescript
interface StreamDelta {
  content?: string;
  thoughts?: string;
  toolCalls?: ToolCall[];
  usage?: Usage;
  timing?: Timing;
}
```

### Extractors

```typescript
import { DiffExtractor, ThinkingExtractor } from "@engram/parser";

// Extract thinking blocks
const thinkingExtractor = new ThinkingExtractor();
const { content, thinking } = thinkingExtractor.extract(text);

// Extract diffs
const diffExtractor = new DiffExtractor();
const diffs = diffExtractor.extract(text);
```

### Diff Redaction

```typescript
import { DiffRedactor } from "@engram/parser";

const redactor = new DiffRedactor();
const safeDiff = redactor.redact(diff, {
  patterns: [/API_KEY=.*/g],
});
```

### Parser Registry

```typescript
import { registry } from "@engram/parser";

// Get parser by provider name
const parser = registry.get("anthropic");
```

## Adding a New Provider

1. Implement `ParserStrategy` interface
2. Register in the parser registry
3. Add provider to `ProviderEnum` in `@engram/events`
