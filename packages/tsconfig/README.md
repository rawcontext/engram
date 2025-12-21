# @engram/tsconfig

Shared TypeScript configuration for the Engram monorepo.

## Overview

Provides a base TypeScript configuration that ensures consistent compilation settings, strict type checking, and modern JavaScript features across all packages and applications.

## Configuration Files

- `base.json` - Base TypeScript configuration with ESNext target and bundler module resolution

## Usage

Extend the base configuration in your package's `tsconfig.json`:

```json
{
  "extends": "@engram/tsconfig/base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

## TypeScript Settings

The base configuration uses TypeScript 7 (tsgo) with the following compiler options:

| Setting | Value | Purpose |
|---------|-------|---------|
| `target` | ESNext | Latest ES2025+ features (Set methods, Iterator helpers, Promise.try) |
| `module` | esnext | Modern ESM modules |
| `moduleResolution` | bundler | Optimized for bundlers and modern tooling |
| `lib` | ["ESNext", "DOM"] | Latest ECMAScript and DOM APIs |
| `strict` | true | All strict type-checking options enabled |
| `composite` | true | Enable project references for monorepo builds |
| `declaration` | true | Generate .d.ts declaration files |
| `declarationMap` | true | Generate sourcemaps for declarations |
| `sourceMap` | true | Generate sourcemaps for debugging |
| `esModuleInterop` | true | Better CommonJS/ESM interoperability |
| `skipLibCheck` | true | Skip type checking of declaration files |
| `forceConsistentCasingInFileNames` | true | Enforce case-sensitive imports |

### Default Path Aliases

```json
{
  "paths": {
    "@/*": ["./src/*"]
  }
}
```

### Default Includes/Excludes

- **Include**: `src/**/*`
- **Exclude**: `node_modules`, `dist`, `**/*.test.ts`, `**/*.spec.ts`

## Customization

Override settings for specific needs:

```json
{
  "extends": "@engram/tsconfig/base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "rootDir": ".",
    "outDir": "build"
  },
  "include": ["src/**/*", "types/**/*"]
}
```

## TypeScript 7 (tsgo) Notes

This configuration is optimized for TypeScript 7's native Go implementation:

- 10x faster builds with multi-threaded compilation
- ESNext target enables latest ES2025 features
- Bundler module resolution for optimal tooling integration
- Composite projects enable parallel compilation across the monorepo
