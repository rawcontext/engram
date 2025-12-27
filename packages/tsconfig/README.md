# @engram/tsconfig

Shared TypeScript configuration for the Engram monorepo. Ensures consistent compilation settings, strict type checking, and modern JavaScript features across all packages and applications.

## Purpose

Centralizes TypeScript compiler options to:
- Enforce strict type checking across the monorepo
- Enable TypeScript 7 (tsgo) optimizations (10x faster builds, multi-threaded compilation)
- Support ESNext features (ES2025: Set methods, Iterator helpers, Promise.try)
- Configure composite project references for parallel compilation
- Maintain consistent module resolution and interoperability

## Configuration Files

- **`base.json`** - Base configuration with ESNext target, bundler module resolution, strict mode

## Usage

Extend in your package's `tsconfig.json`:

```json
{
  "extends": "@engram/tsconfig/base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

## Key Settings

| Option | Value | Purpose |
|--------|-------|---------|
| `target` | ESNext | Latest ES2025+ features |
| `module` | esnext | Modern ESM modules |
| `moduleResolution` | bundler | Optimized for Bun and modern tooling |
| `strict` | true | All strict type-checking enabled |
| `composite` | true | Project references for monorepo parallel builds |
| `declaration` | true | Generate .d.ts files |
| `sourceMap` | true | Enable debugging |

**Default path alias**: `@/*` → `./src/*`

**Default includes**: `src/**/*`

**Default excludes**: `node_modules`, `dist`, `**/*.test.ts`, `**/*.spec.ts`

## TypeScript 7 (tsgo)

This configuration targets TypeScript 7's native Go implementation:

- **10x faster builds** with multi-threaded, parallel project compilation
- **ESNext target** for latest ES2025 features
- **Bundler resolution** optimized for Bun runtime
- **Downlevel emit** requires ES2021+ (no legacy transpilation)

Override settings as needed for framework-specific requirements (e.g., `jsx` for React, custom `outDir`).
