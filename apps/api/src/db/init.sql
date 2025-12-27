-- =============================================================================
-- Engram PostgreSQL Initialization Script
-- =============================================================================
-- This script runs ONLY on initial container creation (when data dir is empty).
-- All statements use IF NOT EXISTS to be idempotent and safe.
--
-- Tables created:
--   1. Better Auth tables (user, session, account, verification)
--   2. OAuth Device Flow tables (device_codes, oauth_tokens)
-- =============================================================================

-- Create databases (safe - SELECT approach avoids errors if they exist)
-- Note: The default database (POSTGRES_DB) is auto-created by postgres entrypoint
SELECT 'CREATE DATABASE engram' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'engram')\gexec
SELECT 'CREATE DATABASE optuna' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'optuna')\gexec

-- Connect to engram database to create auth tables
\c engram;

-- =============================================================================
-- BETTER AUTH TABLES
-- =============================================================================
-- IMPORTANT: Better Auth uses camelCase column names!

-- User table (includes role field for RBAC)
CREATE TABLE IF NOT EXISTS "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    "emailVerified" BOOLEAN DEFAULT FALSE NOT NULL,
    image TEXT,
    role TEXT DEFAULT 'user',
    "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
    "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Add role column if it doesn't exist (for existing installations)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user' AND column_name = 'role'
    ) THEN
        ALTER TABLE "user" ADD COLUMN role TEXT DEFAULT 'user';
    END IF;
END $$;

-- Session table
CREATE TABLE IF NOT EXISTS "session" (
    id TEXT PRIMARY KEY,
    "expiresAt" TIMESTAMP NOT NULL,
    token TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
    "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_userId_idx ON "session"("userId");

-- Account table (for OAuth providers like Google)
CREATE TABLE IF NOT EXISTS "account" (
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
CREATE INDEX IF NOT EXISTS account_userId_idx ON "account"("userId");

-- Verification table (for email verification, password resets, etc.)
CREATE TABLE IF NOT EXISTS "verification" (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    "expiresAt" TIMESTAMP NOT NULL,
    "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL,
    "updatedAt" TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON "verification"(identifier);

-- =============================================================================
-- OAUTH DEVICE FLOW TABLES
-- =============================================================================
-- See docs/design/oauth-device-flow.md for design details

-- Device Codes Table
-- Stores pending device authorization requests (RFC 8628)
CREATE TABLE IF NOT EXISTS device_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_code TEXT NOT NULL UNIQUE,
    user_code TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL DEFAULT 'mcp',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'authorized', 'denied', 'expired', 'used')),
    user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_polled_at TIMESTAMP WITH TIME ZONE,
    authorized_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    user_agent TEXT,
    ip_address TEXT
);
CREATE INDEX IF NOT EXISTS idx_device_codes_user_code ON device_codes(user_code);
CREATE INDEX IF NOT EXISTS idx_device_codes_device_code ON device_codes(device_code);
CREATE INDEX IF NOT EXISTS idx_device_codes_pending_expires ON device_codes(expires_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_device_codes_user_id ON device_codes(user_id);

-- OAuth Tokens Table
-- Stores access and refresh tokens issued via device flow
CREATE TABLE IF NOT EXISTS oauth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    access_token_hash TEXT NOT NULL UNIQUE,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    access_token_prefix TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    scopes TEXT[] NOT NULL DEFAULT ARRAY['memory:read', 'memory:write', 'query:read'],
    rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
    access_token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    refresh_token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_reason TEXT,
    client_id TEXT NOT NULL DEFAULT 'mcp',
    device_code_id UUID REFERENCES device_codes(id) ON DELETE SET NULL,
    user_agent TEXT,
    ip_address TEXT
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_id ON oauth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_access_hash ON oauth_tokens(access_token_hash);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_refresh_hash ON oauth_tokens(refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_active ON oauth_tokens(access_token_expires_at)
    WHERE revoked_at IS NULL;

-- Updated timestamp trigger for oauth_tokens
CREATE OR REPLACE FUNCTION update_oauth_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS oauth_tokens_updated_at ON oauth_tokens;
CREATE TRIGGER oauth_tokens_updated_at
    BEFORE UPDATE ON oauth_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_oauth_tokens_updated_at();

-- =============================================================================
-- CLEANUP FUNCTIONS
-- =============================================================================

-- Function to expire old device codes
CREATE OR REPLACE FUNCTION cleanup_expired_device_codes()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    UPDATE device_codes
    SET status = 'expired'
    WHERE status = 'pending'
      AND expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    DELETE FROM device_codes
    WHERE status IN ('expired', 'denied', 'used')
      AND created_at < NOW() - INTERVAL '24 hours';

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
