-- Seed the default API key
-- Key: engram_live_ce0c732e33778dbbe650634e75ebbdca
-- Hash: d6adf763be4a40f3dabdf1abc124c45d5c6ac55bdf715d8517b1d147d10b5274

INSERT INTO api_keys (
    id,
    key_hash,
    key_prefix,
    key_type,
    user_id,
    name,
    description,
    scopes,
    rate_limit_rpm,
    is_active,
    metadata
) VALUES (
    '01JFW4DXNGE80HPMZZJB8DHVDV',
    'd6adf763be4a40f3dabdf1abc124c45d5c6ac55bdf715d8517b1d147d10b5274',
    'engram_live_ce0c732e...',
    'live',
    NULL,
    'Default API Key',
    'Auto-generated API key for development and testing',
    ARRAY['memory:read', 'memory:write', 'query:read', 'search:read', 'search:write'],
    1000,
    true,
    '{}'::jsonb
)
ON CONFLICT (key_hash) DO UPDATE SET
    is_active = true,
    updated_at = NOW();
