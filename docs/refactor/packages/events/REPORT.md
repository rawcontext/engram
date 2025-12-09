# Refactoring Analysis Report: @engram/events

**Package:** `/Users/ccheney/Projects/the-system/packages/events`
**Generated:** 2025-12-09
**Analysis Type:** READ-ONLY

---

## Executive Summary

The `@engram/events` package is a small, focused schema definition package containing Zod schemas for event validation. At 62 lines of code in a single source file, it is relatively clean but has several architectural and type safety issues that should be addressed.

**Overall Health:** Good
**Lines of Code:** 62 (source), 179 (tests)
**Test Coverage:** Adequate - tests exist but miss edge cases

---

## 1. Code Smells and Complexity Issues

### 1.1 Single File Monolith (Low Severity)

**File:** `/Users/ccheney/Projects/the-system/packages/events/src/index.ts`
**Lines:** 1-62

The entire package is contained in a single file. While the file is small enough that this is not a critical issue, as the event types grow, this will become harder to maintain.

**Current state:**
- `ProviderEnum` (lines 3-13)
- `RawStreamEventSchema` (lines 15-27)
- `ParsedStreamEventSchema` (lines 30-61)

**Recommendation:** Consider splitting into:
- `src/schemas/provider.ts` - Provider enumeration
- `src/schemas/raw-event.ts` - Raw stream event schema
- `src/schemas/parsed-event.ts` - Parsed stream event schema
- `src/index.ts` - Re-exports

### 1.2 Magic Strings for Event Types (Medium Severity)

**File:** `/Users/ccheney/Projects/the-system/packages/events/src/index.ts:34`

```typescript
type: z.enum(["content", "thought", "tool_call", "diff", "usage", "control"]),
```

Event types are defined inline as magic strings. This pattern is repeated in consumers and lacks a single source of truth.

**Impact:**
- The `StreamDelta` interface in `ingestion-core` uses `"stop"` instead of `"control"`:
  `/Users/ccheney/Projects/the-system/packages/ingestion-core/src/parser/interface.ts:2`
- No compile-time safety when referencing event types in consuming code

---

## 2. Architecture Improvements

### 2.1 Schema Duplication with ingestion-core (High Severity)

**Issue:** The `ParsedStreamEvent` schema defines fields that partially overlap with `StreamDelta` in `@engram/ingestion-core`, but with different naming conventions and structures.

**Comparison:**

| ParsedStreamEvent | StreamDelta | Issue |
|-------------------|-------------|-------|
| `tool_call.arguments_delta` | `toolCall.args` | Different field names |
| `usage.input_tokens` | `usage.input` | Different field names |
| `usage.output_tokens` | `usage.output` | Different field names |
| N/A | `usage.reasoning` | Missing field |
| N/A | `usage.cacheRead` | Missing field |
| N/A | `usage.cacheWrite` | Missing field |
| N/A | `cost` | Missing field |
| N/A | `timing` | Missing field |
| N/A | `session` | Missing field |
| N/A | `model` | Missing field |
| N/A | `gitSnapshot` | Missing field |

**Files:**
- `/Users/ccheney/Projects/the-system/packages/events/src/index.ts:38-57`
- `/Users/ccheney/Projects/the-system/packages/ingestion-core/src/parser/interface.ts:1-36`

**Impact:** Field mapping is required in `apps/ingestion/src/index.ts:103-119`, adding complexity and potential for bugs.

**Recommendation:** Unify the schemas:
1. Move `StreamDelta` interface to `@engram/events`
2. Create a shared event type enum
3. Define a single canonical schema that both packages use

### 2.2 Missing Event ID Generation (Medium Severity)

**File:** `/Users/ccheney/Projects/the-system/packages/events/src/index.ts:30-32`

```typescript
export const ParsedStreamEventSchema = z.object({
	event_id: z.string().uuid(),
	original_event_id: z.string().uuid(),
```

The schema requires UUIDs but provides no helper for generating them. Consumers must generate their own, leading to inconsistent ID generation patterns.

**Observed in:**
- `/Users/ccheney/Projects/the-system/apps/ingestion/src/index.ts` - Does not generate `event_id` for parsed events
- `/Users/ccheney/Projects/the-system/tests/e2e/full_loop.test.ts:9-10` - Uses `crypto.randomUUID()`

**Recommendation:** Export a factory function:
```typescript
export function createParsedEvent(data: Omit<ParsedStreamEvent, 'event_id'>): ParsedStreamEvent
```

### 2.3 Provider Enum Incomplete Exports (Low Severity)

**File:** `/Users/ccheney/Projects/the-system/packages/events/src/index.ts:3-13`

The `ProviderEnum` is exported but no derived type is exported, forcing consumers to infer it.

```typescript
// Current: consumers must use z.infer
type Provider = z.infer<typeof ProviderEnum>;

// Preferred: explicit export
export type Provider = z.infer<typeof ProviderEnum>;
```

---

## 3. DRY Violations (Duplicated Code)

### 3.1 Role Enum Duplication (Medium Severity)

The role enum `["user", "assistant", "system"]` appears in multiple locations:

| Location | File | Line |
|----------|------|------|
| ParsedStreamEvent | `/Users/ccheney/Projects/the-system/packages/events/src/index.ts` | 35 |
| ThoughtNodeSchema | `/Users/ccheney/Projects/the-system/packages/memory-core/src/models/nodes.ts` | 86 |

**Recommendation:** Export a `RoleEnum` from `@engram/events` and use it in both packages.

### 3.2 Event Type Enum Duplication (Medium Severity)

Event types are defined inline in multiple places:

| Location | Types | File |
|----------|-------|------|
| ParsedStreamEvent | content, thought, tool_call, diff, usage, control | events/src/index.ts:34 |
| StreamDelta | content, thought, tool_call, usage, stop | ingestion-core/src/parser/interface.ts:2 |

**Issue:** `"control"` vs `"stop"` - different termination event names.

### 3.3 UUID Validation Pattern (Low Severity)

The pattern `z.string().uuid()` is repeated 4 times in the file. Consider extracting to a constant:

```typescript
const uuid = z.string().uuid();
```

---

## 4. SOLID Principle Violations

### 4.1 Single Responsibility Principle (Low Severity)

The package correctly focuses on a single responsibility: event schema definitions. No violations detected at the package level.

### 4.2 Open/Closed Principle (Medium Severity)

**File:** `/Users/ccheney/Projects/the-system/packages/events/src/index.ts:3-13`

The `ProviderEnum` is closed for extension. Adding a new provider requires modifying the source file.

**Current providers:**
- openai, anthropic, local_mock, xai, claude_code, codex, gemini, opencode, cline

**Impact:** Every new LLM provider requires a package change and version bump.

**Recommendation:** Consider a registry pattern or allow extension via configuration.

### 4.3 Interface Segregation Principle (Low Severity)

The `ParsedStreamEvent` schema uses optional fields for different event types, which is appropriate for a union-like structure. However, discriminated unions would be more type-safe:

```typescript
// Current: all fields optional
type: z.enum([...]),
tool_call: z.object({...}).optional(),
usage: z.object({...}).optional(),

// Better: discriminated union
const ContentEvent = z.object({ type: z.literal("content"), content: z.string() });
const ToolCallEvent = z.object({ type: z.literal("tool_call"), tool_call: ToolCallSchema });
export const ParsedStreamEventSchema = z.discriminatedUnion("type", [ContentEvent, ToolCallEvent, ...]);
```

### 4.4 Dependency Inversion Principle (N/A)

Not applicable - the package has no runtime dependencies beyond Zod.

---

## 5. Dependency Issues

### 5.1 Zod Version (Low Severity)

**File:** `/Users/ccheney/Projects/the-system/packages/events/package.json:13`

```json
"dependencies": {
  "zod": "^3.23.4"
}
```

Zod 3.x is used, but the code comment on line 21-22 indicates uncertainty about API compatibility:

```typescript
// Zod 3.x behavior for records: z.record(keySchema, valueSchema) OR z.record(valueSchema)
// We'll use z.record(z.string(), z.unknown()) to be explicit and compatible
```

**Recommendation:** Lock to a specific minor version if there are API concerns.

### 5.2 No Build Configuration (Low Severity)

**File:** `/Users/ccheney/Projects/the-system/packages/events/package.json:15-16`

```json
"scripts": {
  "build": "echo 'Build success'",
```

The package has no actual build step - it exports TypeScript directly via:
```json
"main": "./src/index.ts",
"types": "./src/index.ts",
```

**Impact:** Works in a monorepo with TypeScript but would fail if published to npm.

---

## 6. Testing Gaps

### 6.1 Missing Tests for Boundary Conditions (Medium Severity)

**File:** `/Users/ccheney/Projects/the-system/packages/events/src/index.test.ts`

**Gaps identified:**

| Test Case | Status |
|-----------|--------|
| Provider enum - all valid values | Partial (only 3 of 9 tested) |
| RawStreamEvent - empty payload | Not tested |
| RawStreamEvent - nested payload objects | Not tested |
| ParsedStreamEvent - control event type | Not tested |
| ParsedStreamEvent - diff without file | Not tested |
| ParsedStreamEvent - metadata field | Not tested |
| ParsedStreamEvent - thought without content | Not tested |

### 6.2 Missing Integration Tests (Medium Severity)

No tests verify that the schemas work correctly with the actual consumers:
- `apps/ingestion/src/index.ts`
- `apps/memory/src/turn-aggregator.ts`
- `apps/interface/app/api/ingest/route.ts`

**Recommendation:** Add integration test fixtures that validate end-to-end event flow.

### 6.3 Missing Error Message Tests (Low Severity)

The tests verify that invalid data throws, but don't verify the error messages are useful:

```typescript
// Current
expect(() => RawStreamEventSchema.parse(invalidEvent)).toThrow();

// Better
expect(() => RawStreamEventSchema.parse(invalidEvent)).toThrow(/Invalid uuid/);
```

---

## 7. Type Safety Issues

### 7.1 Loose Payload Typing (High Severity)

**File:** `/Users/ccheney/Projects/the-system/packages/events/src/index.ts:23`

```typescript
payload: z.record(z.string(), z.unknown()),
```

The payload accepts any object, providing no type safety for provider-specific payloads.

**Impact:** Runtime errors if payload structure doesn't match expected format for a given provider.

**Recommendation:** Use discriminated unions based on provider:

```typescript
const AnthropicPayload = z.object({ type: z.string(), /* ... */ });
const OpenAIPayload = z.object({ choices: z.array(/* ... */) });

export const RawStreamEventSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("anthropic"), payload: AnthropicPayload }),
  z.object({ provider: z.literal("openai"), payload: OpenAIPayload }),
  // ...
]);
```

### 7.2 Inconsistent Optional Field Usage (Medium Severity)

**File:** `/Users/ccheney/Projects/the-system/packages/events/src/index.ts:35-58`

Some fields are marked optional when they should be conditionally required based on event type:

```typescript
role: z.enum(["user", "assistant", "system"]).optional(), // Optional for all
content: z.string().optional(), // Optional for all
tool_call: z.object({...}).optional(), // Optional for all
```

**Issue:** A `content` event should require `content` field; a `tool_call` event should require `tool_call` field.

### 7.3 Missing Export of Inferred Types (Medium Severity)

**File:** `/Users/ccheney/Projects/the-system/packages/events/src/index.ts`

Only two types are exported:
- `RawStreamEvent` (line 28)
- `ParsedStreamEvent` (line 61)

**Missing exports:**
- `Provider` type (from `ProviderEnum`)
- `EventType` type (from the type enum)
- `Role` type (from the role enum)
- `ToolCall` type (nested object)
- `Usage` type (nested object)
- `Diff` type (nested object)

---

## 8. Error Handling Patterns

### 8.1 No Custom Error Types (Low Severity)

The package relies entirely on Zod's built-in error handling. Consider exporting custom error types for better error handling in consumers:

```typescript
export class EventValidationError extends Error {
  constructor(public field: string, public value: unknown, message: string) {
    super(message);
  }
}
```

### 8.2 No Validation Helpers (Low Severity)

Consumers must handle Zod errors directly. Consider exporting safe parse helpers:

```typescript
export function safeParseRawEvent(data: unknown):
  { success: true; data: RawStreamEvent } |
  { success: false; error: string } {
  const result = RawStreamEventSchema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error.message };
}
```

---

## Summary Table

| Category | High | Medium | Low | Total |
|----------|------|--------|-----|-------|
| Code Smells | 0 | 1 | 1 | 2 |
| Architecture | 1 | 1 | 1 | 3 |
| DRY Violations | 0 | 2 | 1 | 3 |
| SOLID Violations | 0 | 2 | 1 | 3 |
| Dependencies | 0 | 0 | 2 | 2 |
| Testing Gaps | 0 | 2 | 1 | 3 |
| Type Safety | 1 | 2 | 0 | 3 |
| Error Handling | 0 | 0 | 2 | 2 |
| **Total** | **2** | **10** | **9** | **21** |

---

## Recommended Refactoring Priorities

### Phase 1: Type Safety (P0 - High Impact)
1. Convert `ParsedStreamEventSchema` to discriminated union by event type
2. Add typed payload schemas per provider
3. Export all inferred types

### Phase 2: DRY Cleanup (P1 - Medium Impact)
1. Create and export `RoleEnum`
2. Create and export `EventTypeEnum`
3. Unify with `StreamDelta` in `ingestion-core`

### Phase 3: Testing (P1 - Medium Impact)
1. Complete provider enum test coverage
2. Add boundary condition tests
3. Add integration test fixtures

### Phase 4: Architecture (P2 - Low Impact)
1. Split into multiple files if schema count grows
2. Add factory functions for event creation
3. Consider provider extensibility pattern

---

## Metrics Before Refactoring

| Metric | Value |
|--------|-------|
| Lines of Code (Source) | 62 |
| Lines of Code (Tests) | 179 |
| Exported Schemas | 3 |
| Exported Types | 2 |
| Test Coverage | ~70% (estimated) |
| Cyclomatic Complexity | 1 (schemas only) |
| Dependencies | 1 (zod) |

---

## Files Analyzed

1. `/Users/ccheney/Projects/the-system/packages/events/src/index.ts` (source)
2. `/Users/ccheney/Projects/the-system/packages/events/src/index.test.ts` (tests)
3. `/Users/ccheney/Projects/the-system/packages/events/package.json` (config)
4. `/Users/ccheney/Projects/the-system/apps/ingestion/src/index.ts` (consumer)
5. `/Users/ccheney/Projects/the-system/apps/memory/src/turn-aggregator.ts` (consumer)
6. `/Users/ccheney/Projects/the-system/apps/interface/app/api/ingest/route.ts` (consumer)
7. `/Users/ccheney/Projects/the-system/packages/ingestion-core/src/parser/interface.ts` (related)
8. `/Users/ccheney/Projects/the-system/packages/memory-core/src/models/nodes.ts` (related)
9. `/Users/ccheney/Projects/the-system/packages/memory-core/src/models/base.ts` (related)
