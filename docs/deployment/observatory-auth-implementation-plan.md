# Observatory Authentication Implementation Plan

## Overview

Replace the partial Clerk integration in Observatory with **Better Auth v1.4.7** using Google OAuth as the authentication method. All routes will be protected, requiring users to sign in via Google before accessing the application.

**Key Resources:**
- [Better Auth Documentation](https://www.better-auth.com/)
- [Better Auth npm](https://www.npmjs.com/package/better-auth)
- [Better Auth GitHub](https://github.com/better-auth/better-auth)
- [Next.js Integration Guide](https://www.better-auth.com/docs/integrations/next)

## Current State Analysis

### Existing Auth Files (to be replaced)

| File | Current Purpose | Action |
|------|-----------------|--------|
| `lib/auth.ts` | Clerk `checkRole()` function | **Replace** with Better Auth server config |
| `lib/rbac.ts` | Clerk-based RBAC with `requireRole()`, `withRole()` | **Update** to use Better Auth |
| `package.json` | Has `@clerk/nextjs: ^6.36.5` | **Remove** Clerk, **Add** Better Auth |

### Missing Components

- No middleware for route protection
- No sign-in/sign-out pages
- No auth provider in root layout (not needed with Better Auth)
- No database adapter configured

## Implementation Steps

### Step 1: Update Dependencies

**File:** `apps/observatory/package.json`

Remove:
```json
"@clerk/nextjs": "^6.36.5"
```

Add:
```json
"better-auth": "^1.4.7",
"pg": "^8.13.0"
```

Run:
```bash
cd apps/observatory && npm install
```

---

### Step 2: Configure Environment Variables

**File:** `apps/observatory/.env`

Add the following variables:

```env
# Better Auth
BETTER_AUTH_SECRET=<generate-with-openssl-rand-base64-32>
BETTER_AUTH_URL=http://localhost:5000

# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>

# PostgreSQL for Better Auth sessions
AUTH_DATABASE_URL=postgresql://engram:${POSTGRES_PASSWORD}@localhost:5432/engram
```

**Production Environment Variables** (add to `docker-compose.prod.yml` for observatory service):

```yaml
environment:
  - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
  - BETTER_AUTH_URL=https://observatory.statient.com
  - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
  - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
  - AUTH_DATABASE_URL=postgresql://${POSTGRES_USER:-engram}:${POSTGRES_PASSWORD}@postgres:5432/engram
```

---

### Step 3: Create Better Auth Server Configuration

**File:** `apps/observatory/lib/auth.ts`

Replace entire file with:

```typescript
import { betterAuth } from "better-auth";
import { Pool } from "pg";

export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.AUTH_DATABASE_URL,
  }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },
  trustedOrigins: [
    "http://localhost:5000",
    "http://localhost:3000",
    "https://observatory.statient.com",
  ],
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
```

---

### Step 4: Create Auth Client for React

**File:** `apps/observatory/lib/auth-client.ts` (new file)

```typescript
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL || "",
});

export const { signIn, signOut, useSession } = authClient;
```

---

### Step 5: Create API Route Handler

**File:** `apps/observatory/app/api/auth/[...all]/route.ts` (new file)

```typescript
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
```

Note: The `@/` alias resolves to the app root. Verify `tsconfig.json` has:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

---

### Step 6: Create Middleware for Route Protection

**File:** `apps/observatory/middleware.ts` (new file at app root)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  runtime: "nodejs",
  matcher: [
    /*
     * Match all request paths except:
     * - /sign-in (auth page)
     * - /api/auth (auth API routes)
     * - /_next/static (static files)
     * - /_next/image (image optimization)
     * - /favicon.ico, /robots.txt, etc.
     */
    "/((?!sign-in|api/auth|_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};
```

---

### Step 7: Create Sign-In Page

**File:** `apps/observatory/app/sign-in/page.tsx` (new file)

```tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useState } from "react";

export default function SignInPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError(null);

    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: "/",
      });
    } catch (err) {
      setError("Failed to sign in. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="glass-panel p-8 max-w-md w-full mx-4">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-cyan-400 mb-2">ENGRAM</h1>
          <p className="text-gray-400 text-sm tracking-wider">
            NEURAL OBSERVATORY
          </p>
        </div>

        <div className="space-y-4">
          <p className="text-center text-gray-300 text-sm">
            Sign in to access the Neural Observatory
          </p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-2 rounded text-sm text-center">
              {error}
            </div>
          )}

          <button
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <GoogleIcon />
            <span className="text-white">
              {isLoading ? "Signing in..." : "Continue with Google"}
            </span>
          </button>
        </div>

        <p className="mt-8 text-center text-gray-500 text-xs">
          Access is restricted to authorized users only.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
```

---

### Step 8: Update RBAC to Use Better Auth

**File:** `apps/observatory/lib/rbac.ts`

Replace entire file with:

```typescript
import { headers } from "next/headers";
import type { NextResponse } from "next/server";
import { auth, type Session } from "./auth";
import { apiError } from "./api-response";

export enum UserRole {
  ADMIN = "admin",
  USER = "user",
  SYSTEM = "system",
}

export class AuthorizationError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Get the current session. Throws AuthorizationError if not authenticated.
 */
export async function getSession(): Promise<Session> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new AuthorizationError("User not authenticated");
  }

  return session;
}

/**
 * Checks if the current user has the required role.
 * For now, all authenticated users are considered to have USER role.
 * ADMIN and SYSTEM roles can be implemented via user metadata later.
 */
export async function requireRole(requiredRole: UserRole): Promise<Session> {
  const session = await getSession();

  // For now, all authenticated Google users have USER role
  // SYSTEM role is reserved for internal API calls
  if (requiredRole === UserRole.SYSTEM) {
    // Check for system API key or special header
    const headersList = await headers();
    const systemKey = headersList.get("x-system-key");
    if (systemKey !== process.env.SYSTEM_API_KEY) {
      throw new ForbiddenError("System access required");
    }
  }

  return session;
}

/**
 * Higher-order function to protect API routes with RBAC.
 */
export const withRole =
  (role: UserRole) =>
  (handler: (req: Request, session: Session) => Promise<NextResponse>) =>
  async (req: Request) => {
    try {
      const session = await requireRole(role);
      return handler(req, session);
    } catch (e) {
      if (e instanceof AuthorizationError) {
        return apiError(e.message, "UNAUTHORIZED", 401);
      }
      if (e instanceof ForbiddenError) {
        return apiError(e.message, "FORBIDDEN", 403);
      }
      return apiError("Internal Authorization Error", "AUTH_ERROR", 500);
    }
  };

/**
 * Higher-order function to protect API routes requiring authentication only.
 */
export const withAuth =
  (handler: (req: Request, session: Session) => Promise<NextResponse>) =>
  async (req: Request) => {
    try {
      const session = await getSession();
      return handler(req, session);
    } catch (e) {
      if (e instanceof AuthorizationError) {
        return apiError(e.message, "UNAUTHORIZED", 401);
      }
      return apiError("Internal Authorization Error", "AUTH_ERROR", 500);
    }
  };
```

---

### Step 9: Add User Menu Component

**File:** `apps/observatory/app/components/UserMenu.tsx` (new file)

```tsx
"use client";

import { authClient, useSession } from "@/lib/auth-client";
import { useState } from "react";

export function UserMenu() {
  const { data: session, isPending } = useSession();
  const [isOpen, setIsOpen] = useState(false);

  if (isPending) {
    return <div className="w-8 h-8 rounded-full bg-gray-700 animate-pulse" />;
  }

  if (!session?.user) {
    return null;
  }

  const handleSignOut = async () => {
    await authClient.signOut();
    window.location.href = "/sign-in";
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
      >
        {session.user.image ? (
          <img
            src={session.user.image}
            alt={session.user.name || "User"}
            className="w-8 h-8 rounded-full"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-sm font-medium">
            {session.user.name?.charAt(0) || session.user.email?.charAt(0) || "?"}
          </div>
        )}
        <span className="text-sm text-gray-300 hidden sm:block">
          {session.user.name || session.user.email}
        </span>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-full mt-2 w-48 py-2 bg-gray-900 border border-white/10 rounded-lg shadow-xl z-50">
            <div className="px-4 py-2 border-b border-white/10">
              <p className="text-sm font-medium text-white truncate">
                {session.user.name}
              </p>
              <p className="text-xs text-gray-400 truncate">
                {session.user.email}
              </p>
            </div>
            <button
              onClick={handleSignOut}
              className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-white/5 transition-colors"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

---

### Step 10: Update Root Layout to Include User Menu

**File:** `apps/observatory/app/layout.tsx`

The layout doesn't need an auth provider (Better Auth handles sessions via cookies), but we should add the user menu to the header. Since the main page handles its own header, no changes are strictly required. The UserMenu can be added to the main page or a shared header component.

---

### Step 11: Add Public Environment Variable

**File:** `apps/observatory/next.config.mjs`

Add environment variable exposure:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  },
  serverExternalPackages: [
    "@huggingface/transformers",
    "onnxruntime-node",
    "sharp",
    "pino",
    "pino-pretty",
    "thread-stream",
    "sonic-boom",
    "@confluentinc/kafka-javascript",
    "falkordb",
    "@js-temporal/polyfill",
    "pg", // Add pg for Better Auth database
  ],
};

export default nextConfig;
```

---

### Step 12: Update docker-compose.prod.yml

**File:** `docker-compose.prod.yml`

Update the observatory service environment:

```yaml
observatory:
  build:
    context: .
    dockerfile: apps/observatory/Dockerfile
  platform: linux/amd64
  environment:
    - NODE_ENV=production
    - HOSTNAME=0.0.0.0
    - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
    - BETTER_AUTH_URL=https://observatory.statient.com
    - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
    - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
    - AUTH_DATABASE_URL=postgresql://${POSTGRES_USER:-engram}:${POSTGRES_PASSWORD}@postgres:5432/engram
    - API_URL=http://api:8080
    - SEARCH_URL=http://search:5002
    - FALKORDB_URL=redis://falkordb:6379
```

---

### Step 13: Generate Better Auth Secret

Run locally to generate a secret:

```bash
openssl rand -base64 32
```

Add the result to:
1. `apps/observatory/.env` as `BETTER_AUTH_SECRET`
2. Server `.env` file for production

---

### Step 14: Set Up Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Navigate to **APIs & Services > Credentials**
4. Click **Create Credentials > OAuth client ID**
5. Select **Web application**
6. Add authorized redirect URIs:
   - Development: `http://localhost:5000/api/auth/callback/google`
   - Production: `https://observatory.statient.com/api/auth/callback/google`
7. Copy the Client ID and Client Secret to environment variables

---

### Step 15: Database Schema Migration

Better Auth automatically creates tables on first run. The following tables will be created in PostgreSQL:

- `user` - User accounts
- `session` - Active sessions
- `account` - OAuth provider accounts

No manual migration is required. Better Auth handles schema creation automatically.

---

## File Summary

### New Files

| File | Purpose |
|------|---------|
| `lib/auth-client.ts` | React auth client with hooks |
| `app/api/auth/[...all]/route.ts` | Better Auth API handler |
| `app/sign-in/page.tsx` | Google sign-in page |
| `app/components/UserMenu.tsx` | User avatar and sign-out menu |
| `middleware.ts` | Route protection middleware |

### Modified Files

| File | Changes |
|------|---------|
| `lib/auth.ts` | Replace Clerk with Better Auth server config |
| `lib/rbac.ts` | Update to use Better Auth sessions |
| `package.json` | Remove Clerk, add Better Auth and pg |
| `next.config.mjs` | Add env exposure and pg to external packages |
| `docker-compose.prod.yml` | Add auth environment variables |
| `.env` | Add Better Auth and Google OAuth variables |

### Files to Delete

| File | Reason |
|------|--------|
| `lib/auth.test.ts` | Clerk-specific tests (rewrite for Better Auth) |

---

## Testing Checklist

1. [ ] Start local development server
2. [ ] Visit `http://localhost:5000` - should redirect to `/sign-in`
3. [ ] Click "Continue with Google" - should redirect to Google OAuth
4. [ ] Complete Google sign-in - should redirect back to home page
5. [ ] Verify user session persists on page refresh
6. [ ] Verify sign-out clears session and redirects to sign-in
7. [ ] Test protected API routes return 401 without session
8. [ ] Deploy to production and test OAuth callback URLs

---

## Security Considerations

1. **BETTER_AUTH_SECRET**: Must be kept secret and rotated periodically
2. **Google OAuth**: Restrict authorized domains in Google Cloud Console
3. **Session expiry**: Configured for 7 days, adjust as needed
4. **HTTPS**: Required in production for secure cookie transmission
5. **Trusted Origins**: Only allow known domains in `trustedOrigins`

---

## Rollback Plan

If issues arise:

1. Revert package.json changes
2. Restore original `lib/auth.ts` and `lib/rbac.ts` from git
3. Remove new files (`middleware.ts`, `app/sign-in/`, `lib/auth-client.ts`, etc.)
4. Redeploy with original Clerk configuration (if Clerk was configured)

---

## Dependencies

- **better-auth**: v1.4.7
- **pg**: v8.13.0 (PostgreSQL client for sessions)
- **Next.js**: v16.1.0 (existing)
- **React**: v19.2.3 (existing)
