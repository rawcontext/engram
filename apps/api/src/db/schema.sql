-- OpenTofu/Terraform State Storage
-- HTTP backend for remote state management
CREATE TABLE IF NOT EXISTS tofu_state (
    -- State identifier (e.g., "default" for default workspace)
    id TEXT PRIMARY KEY,

    -- State data (JSON blob from OpenTofu)
    state JSONB NOT NULL,

    -- Locking
    lock_id TEXT,           -- Current lock ID (null if unlocked)
    lock_info JSONB,        -- Lock metadata (who, when, operation)
    locked_at TIMESTAMP WITH TIME ZONE,

    -- Versioning
    serial INTEGER NOT NULL DEFAULT 1,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Updated timestamp trigger for state
CREATE OR REPLACE FUNCTION update_tofu_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tofu_state_updated_at ON tofu_state;
CREATE TRIGGER tofu_state_updated_at
    BEFORE UPDATE ON tofu_state
    FOR EACH ROW
    EXECUTE FUNCTION update_tofu_state_updated_at();
