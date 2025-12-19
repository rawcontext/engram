# @engram/tsconfig

Shared TypeScript configuration for the Engram monorepo.

## Overview

Ensures consistent TypeScript compilation and type checking across all packages and applications.

## Usage

Extend the base configuration in your `tsconfig.json`:

```json
{
  "extends": "@engram/tsconfig/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

## Base Configuration

The `base.json` includes:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

## Key Settings

| Setting | Value | Purpose |
|:--------|:------|:--------|
| `target` | ES2022 | Modern JavaScript features |
| `module` | NodeNext | ESM with Node.js resolution |
| `strict` | true | All strict type checks enabled |
| `verbatimModuleSyntax` | true | Explicit import/export types |

## Customization

Override settings as needed in your package:

```json
{
  "extends": "@engram/tsconfig/base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM"]
  }
}
```
