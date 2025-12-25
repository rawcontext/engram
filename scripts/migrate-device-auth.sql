-- OAuth Device Flow tables for MCP authentication
-- See docs/design/oauth-device-flow.md for design details
-- Run this on the engram database after migrate-auth.sql

-- =============================================================================
-- Device Codes Table
-- =============================================================================
-- Stores pending device authorization requests (RFC 8628)
-- User codes are displayed to users, device codes are used for polling

CREATE TABLE IF NOT EXISTS device_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Codes
    device_code TEXT NOT NULL UNIQUE,   -- Secret, used for polling (32 random chars)
    user_code TEXT NOT NULL UNIQUE,     -- Human-readable XXXX-XXXX format
    client_id TEXT NOT NULL DEFAULT 'mcp',

    -- Status
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'authorized', 'denied', 'expired', 'used')),

    -- Link to user (set when authorized via /activate page)
    user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,

    -- Timing
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_polled_at TIMESTAMP WITH TIME ZONE,
    authorized_at TIMESTAMP WITH TIME ZONE,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    user_agent TEXT,
    ip_address TEXT
);

-- Indexes for device code lookups
CREATE INDEX IF NOT EXISTS idx_device_codes_user_code ON device_codes(user_code);
CREATE INDEX IF NOT EXISTS idx_device_codes_device_code ON device_codes(device_code);
CREATE INDEX IF NOT EXISTS idx_device_codes_pending_expires ON device_codes(expires_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_device_codes_user_id ON device_codes(user_id);

-- =============================================================================
-- OAuth Tokens Table
-- =============================================================================
-- Stores access and refresh tokens issued via device flow
-- Tokens are hashed with SHA-256 (same as API keys)

CREATE TABLE IF NOT EXISTS oauth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Token hashes (never store plaintext)
    access_token_hash TEXT NOT NULL UNIQUE,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    access_token_prefix TEXT NOT NULL,  -- For display: "engram_oauth_abc..."

    -- Link to user
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

    -- Scopes (same format as api_keys)
    scopes TEXT[] NOT NULL DEFAULT ARRAY['memory:read', 'memory:write', 'query:read'],

    -- Rate limiting (consistent with api_keys)
    rate_limit_rpm INTEGER NOT NULL DEFAULT 60,

    -- Timing
    access_token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    refresh_token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE,

    -- Revocation
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_reason TEXT,

    -- Client info
    client_id TEXT NOT NULL DEFAULT 'mcp',
    device_code_id UUID REFERENCES device_codes(id) ON DELETE SET NULL,
    user_agent TEXT,
    ip_address TEXT
);

-- Indexes for token lookups
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
-- Cleanup Functions
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

    -- Delete expired codes older than 24 hours
    DELETE FROM device_codes
    WHERE status IN ('expired', 'denied', 'used')
      AND created_at < NOW() - INTERVAL '24 hours';

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
