# Schema DSL

Type-safe field type primitives for defining graph node schemas with a builder pattern.

## Features

- **Type-safe**: Full TypeScript type inference for field types
- **Builder pattern**: Chainable modifiers for clean, readable schema definitions
- **Comprehensive types**: Support for string, int, float, boolean, timestamp, array, enum, and vector fields
- **Constraints**: Built-in support for optional, default, min, max, and length constraints
- **Inspired by Drizzle ORM**: Similar API to Drizzle's column definitions

## Basic Usage

```typescript
import { field } from "@engram/graph/schema";

// Define a user schema
const userSchema = {
  id: field.string(),
  name: field.string().max(100),
  age: field.int().min(0).max(150).optional(),
  email: field.string().default("user@example.com"),
  isActive: field.boolean().default(true),
  createdAt: field.timestamp(),
  tags: field.array(field.string()).default([]),
  role: field.enum(["admin", "user", "guest"] as const).default("user"),
  embedding: field.vector(1536).optional(),
};
```

## Available Field Types

### String Field

```typescript
field.string()
  .max(100)              // Maximum length constraint
  .optional()            // Can be undefined
  .default("value")      // Default value
```

### Integer Field

```typescript
field.int()
  .min(0)                // Minimum value (inclusive)
  .max(100)              // Maximum value (inclusive)
  .optional()            // Can be undefined
  .default(42)           // Default value
```

### Float Field

```typescript
field.float()
  .min(0.0)              // Minimum value (inclusive)
  .max(1.0)              // Maximum value (inclusive)
  .optional()            // Can be undefined
  .default(0.5)          // Default value
```

### Boolean Field

```typescript
field.boolean()
  .optional()            // Can be undefined
  .default(true)         // Default value
```

### Timestamp Field

Stores epoch milliseconds.

```typescript
field.timestamp()
  .optional()            // Can be undefined
  .default(Date.now())   // Default value
```

### Array Field

Generic array with typed inner elements.

```typescript
field.array(field.string())           // Array of strings
field.array(field.int())              // Array of integers
field.array(field.array(field.int())) // Nested arrays
  .optional()                         // Can be undefined
  .default([])                        // Default value
```

### Enum Field

String literal union type.

```typescript
field.enum(["admin", "user", "guest"] as const)
  .optional()            // Can be undefined
  .default("user")       // Default value (must be one of the enum values)
```

### Vector Field

For embeddings and vector search.

```typescript
field.vector(1536)       // OpenAI ada-002 dimensions
field.vector(768)        // BERT dimensions
field.vector(384)        // MiniLM dimensions
  .optional()            // Can be undefined
  .default([...])        // Default value
```

## Type Inference

TypeScript automatically infers the correct types:

```typescript
const nameField = field.string();
// Type: Field<string>

const tagsField = field.array(field.string());
// Type: Field<string[]>

const roleField = field.enum(["admin", "user"] as const);
// Type: Field<"admin" | "user">
```

## Modifier Chaining

All modifiers return a new field instance, allowing for clean chaining:

```typescript
const ageField = field.int()
  .min(0)
  .max(150)
  .optional()
  .default(25);

// Configuration:
// - kind: "int"
// - min: 0
// - max: 150
// - optional: true
// - defaultValue: 25
```

## Next Steps

This field system is the foundation for:

1. **Node definitions** (`node.ts`) - Define node schemas with typed fields
2. **Query builder** - Type-safe query construction based on schemas
3. **Validation** - Runtime validation using field constraints
4. **Schema migrations** - Track and migrate schema changes
5. **Graph compilation** - Compile schemas to FalkorDB property graphs

## Related

- [Drizzle ORM Column Types](https://orm.drizzle.team/docs/column-types/pg)
- [Builder Pattern in TypeScript](https://refactoring.guru/design-patterns/builder/typescript/example)
