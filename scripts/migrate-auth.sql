-- Better Auth tables for Observatory authentication
-- Run this on the engram database
-- IMPORTANT: Better Auth uses camelCase column names!

-- Drop existing tables if they have wrong schema
DROP TABLE IF EXISTS "verification" CASCADE;
DROP TABLE IF EXISTS "account" CASCADE;
DROP TABLE IF EXISTS "session" CASCADE;
DROP TABLE IF EXISTS "user" CASCADE;

-- User table
CREATE TABLE "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    "emailVerified" BOOLEAN DEFAULT FALSE NOT NULL,
    image TEXT,
    "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
    "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Session table
CREATE TABLE "session" (
    id TEXT PRIMARY KEY,
    "expiresAt" TIMESTAMP NOT NULL,
    token TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
    "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX session_userId_idx ON "session"("userId");

-- Account table (for OAuth providers)
CREATE TABLE "account" (
    id TEXT PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP,
    "refreshTokenExpiresAt" TIMESTAMP,
    scope TEXT,
    password TEXT,
    "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
    "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE INDEX account_userId_idx ON "account"("userId");

-- Verification table (for email verification, password resets, etc.)
CREATE TABLE "verification" (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    "expiresAt" TIMESTAMP NOT NULL,
    "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
    "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE INDEX verification_identifier_idx ON "verification"(identifier);
