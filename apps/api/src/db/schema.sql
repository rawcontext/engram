-- API Keys schema
-- Stores API keys for authentication and authorization

CREATE TABLE IF NOT EXISTS api_keys (
    -- Primary key
    id TEXT PRIMARY KEY,

    -- Key identification
    key_hash TEXT NOT NULL UNIQUE,  -- SHA-256 hash of the full API key
    key_prefix TEXT NOT NULL,       -- First 20 chars for logging/display (e.g., "engram_live_abc123...")
    key_type TEXT NOT NULL CHECK (key_type IN ('live', 'test')),

    -- Ownership
    user_id TEXT,                   -- Optional user ID
    name TEXT NOT NULL,             -- Human-readable name for the key
    description TEXT,               -- Optional description

    -- Authorization
    scopes TEXT[] NOT NULL DEFAULT '{}',  -- Array of scopes (e.g., ['memory:read', 'memory:write'])

    -- Rate limiting
    rate_limit_rpm INTEGER NOT NULL DEFAULT 60,  -- Requests per minute

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,
    expires_at TIMESTAMP WITH TIME ZONE,  -- Optional expiration

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE,

    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_type ON api_keys(key_type);

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_api_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_api_keys_updated_at();
