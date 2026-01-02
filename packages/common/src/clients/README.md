# Gemini Client

Type-safe Gemini API client with structured output support using Zod schemas.

## Installation

The Gemini client is part of `@engram/common`:

```bash
bun add @engram/common
```

## Configuration

Set your Gemini API key as an environment variable:

```bash
export GEMINI_API_KEY="your-api-key-here"
```

Or pass it directly to the client:

```typescript
import { createGeminiClient } from "@engram/common/clients";

const client = createGeminiClient({
  apiKey: "your-api-key-here"
});
```

## Usage

### Basic Structured Output

```typescript
import { createGeminiClient } from "@engram/common/clients";
import { z } from "zod";

const client = createGeminiClient();

// Define your schema
const RecipeSchema = z.object({
  name: z.string(),
  ingredients: z.array(z.string()),
  steps: z.array(z.string()),
  prepTimeMinutes: z.number().optional()
});

// Generate structured output
const recipe = await client.generateStructuredOutput({
  prompt: "Create a recipe for chocolate chip cookies",
  schema: RecipeSchema
});

console.log(recipe);
// {
//   name: "Chocolate Chip Cookies",
//   ingredients: ["2¼ cups all-purpose flour", "1 tsp baking soda", ...],
//   steps: ["Preheat oven to 375°F", ...],
//   prepTimeMinutes: 15
// }
```

### Batch Processing

Process multiple prompts in parallel:

```typescript
const SummarySchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string())
});

const articles = [
  "Long article text 1...",
  "Long article text 2...",
  "Long article text 3..."
];

const summaries = await client.generateBatch({
  prompts: articles.map(text => `Summarize this article: ${text}`),
  schema: SummarySchema,
  concurrency: 3 // Process 3 at a time
});

summaries.forEach((summary, i) => {
  console.log(`Article ${i + 1}: ${summary.summary}`);
});
```

### Custom Model and Temperature

```typescript
const result = await client.generateStructuredOutput({
  prompt: "Extract person info: John Doe, age 30, john@example.com",
  schema: z.object({
    name: z.string(),
    age: z.number(),
    email: z.string().email()
  }),
  model: "gemini-2.0-flash-exp", // Override default model
  temperature: 0.3, // Lower temperature for more deterministic output
  systemInstruction: "Extract only the information explicitly stated in the text."
});
```

### Error Handling

```typescript
import { GeminiError } from "@engram/common/clients";

try {
  const result = await client.generateStructuredOutput({
    prompt: "...",
    schema: MySchema
  });
} catch (error) {
  if (error instanceof GeminiError) {
    console.error("Gemini API error:", error.message);
    console.error("Error code:", error.code);
    if (error.cause) {
      console.error("Caused by:", error.cause);
    }
  }
}
```

## API Reference

### `createGeminiClient(config?)`

Create a new Gemini client instance.

**Parameters:**
- `config.apiKey` (optional): Google AI API key. Defaults to `process.env.GEMINI_API_KEY`
- `config.model` (optional): Default model to use. Defaults to `"gemini-2.0-flash-exp"`
- `config.maxRetries` (optional): Maximum number of retry attempts. Defaults to `3`
- `config.retryDelay` (optional): Base delay in milliseconds for exponential backoff. Defaults to `1000`

**Returns:** `GeminiClient`

### `client.generateStructuredOutput(options)`

Generate structured output that conforms to a Zod schema.

**Parameters:**
- `options.prompt` (required): The prompt to send to the model
- `options.schema` (required): Zod schema describing the expected response structure
- `options.model` (optional): Override the default model for this request
- `options.systemInstruction` (optional): System instruction to guide model behavior
- `options.temperature` (optional): Temperature for response generation (0.0-2.0). Defaults to `0.7`

**Returns:** `Promise<T>` where T is inferred from the Zod schema

### `client.generateBatch(options)`

Generate structured outputs for multiple prompts in parallel.

**Parameters:**
- `options.prompts` (required): Array of prompts to process
- `options.schema` (required): Zod schema describing the expected response structure
- `options.model` (optional): Override the default model for these requests
- `options.systemInstruction` (optional): System instruction to guide model behavior
- `options.temperature` (optional): Temperature for response generation (0.0-2.0). Defaults to `0.7`
- `options.concurrency` (optional): Maximum number of concurrent requests. Defaults to `5`

**Returns:** `Promise<T[]>` where T is inferred from the Zod schema

## Features

- **Type-safe**: Full TypeScript support with inferred types from Zod schemas
- **Automatic schema conversion**: Converts Zod schemas to JSON Schema format automatically
- **Retry logic**: Built-in exponential backoff for transient failures
- **Batch processing**: Process multiple prompts in parallel with configurable concurrency
- **Error handling**: Comprehensive error types with cause chaining

## Supported Models

- `gemini-2.0-flash-exp` (default) - Latest experimental flash model
- `gemini-2.5-flash` - Stable flash model
- `gemini-3-pro-preview` - Preview of Gemini 3 Pro

See [Google AI documentation](https://ai.google.dev/gemini-api/docs/models) for the latest model availability.

## Notes

- The Gemini API requires `responseMimeType: "application/json"` for structured output
- Schema conversion removes the top-level `$schema` property as Gemini doesn't expect it
- Temperature defaults to 0.7 for a balance between creativity and determinism
- Retry logic uses exponential backoff with jitter to handle rate limits and transient errors
