-- =============================================================================
-- Seed Service Clients for M2M Authentication
-- =============================================================================
-- Run this on production to register service clients for client_credentials flow.
--
-- USAGE:
--   1. Generate a strong secret and compute its SHA-256 hash:
--      export SECRET="$(openssl rand -hex 32)"
--      export SECRET_HASH="$(echo -n "$SECRET" | sha256sum | cut -d' ' -f1)"
--      echo "Secret: $SECRET"
--      echo "Hash: $SECRET_HASH"
--
--   2. Save the secret to your .env file for each service
--
--   3. Run this script with the hash:
--      docker exec -i engram-postgres-1 psql -U engram -d engram \
--        -v secret_hash="'$SECRET_HASH'" < scripts/seed-service-clients.sql
--
-- SECURITY: Never commit actual secrets. This script requires the hash as input.

\set ON_ERROR_STOP on

-- Verify secret_hash was provided
DO $$
BEGIN
    IF :'secret_hash' = ':secret_hash' OR :'secret_hash' IS NULL OR :'secret_hash' = '' THEN
        RAISE EXCEPTION 'secret_hash variable is required. Run with: psql -v secret_hash="''your_hash''"';
    END IF;
END $$;

-- Insert/update service clients
DO $$
DECLARE
    hash TEXT := :'secret_hash';
BEGIN
    -- engram-console: Infrastructure Console dashboard
    INSERT INTO oauth_clients (
        client_id, client_secret_hash, client_name,
        redirect_uris, grant_types, response_types,
        token_endpoint_auth_method, scope
    ) VALUES (
        'engram-console',
        hash,
        'Engram Console',
        ARRAY[]::TEXT[],
        ARRAY['client_credentials']::TEXT[],
        ARRAY[]::TEXT[],
        'client_secret_post',
        'memory:read memory:write query:read'
    ) ON CONFLICT (client_id) DO UPDATE SET
        client_secret_hash = EXCLUDED.client_secret_hash,
        scope = EXCLUDED.scope;

    -- engram-api: REST API Gateway
    INSERT INTO oauth_clients (
        client_id, client_secret_hash, client_name,
        redirect_uris, grant_types, response_types,
        token_endpoint_auth_method, scope
    ) VALUES (
        'engram-api',
        hash,
        'Engram API',
        ARRAY[]::TEXT[],
        ARRAY['client_credentials']::TEXT[],
        ARRAY[]::TEXT[],
        'client_secret_post',
        'memory:read memory:write query:read'
    ) ON CONFLICT (client_id) DO UPDATE SET
        client_secret_hash = EXCLUDED.client_secret_hash,
        scope = EXCLUDED.scope;

    -- engram-ingestion: Event Parsing Pipeline
    INSERT INTO oauth_clients (
        client_id, client_secret_hash, client_name,
        redirect_uris, grant_types, response_types,
        token_endpoint_auth_method, scope
    ) VALUES (
        'engram-ingestion',
        hash,
        'Engram Ingestion',
        ARRAY[]::TEXT[],
        ARRAY['client_credentials']::TEXT[],
        ARRAY[]::TEXT[],
        'client_secret_post',
        'memory:write'
    ) ON CONFLICT (client_id) DO UPDATE SET
        client_secret_hash = EXCLUDED.client_secret_hash,
        scope = EXCLUDED.scope;

    -- engram-memory: Graph Persistence Service
    INSERT INTO oauth_clients (
        client_id, client_secret_hash, client_name,
        redirect_uris, grant_types, response_types,
        token_endpoint_auth_method, scope
    ) VALUES (
        'engram-memory',
        hash,
        'Engram Memory',
        ARRAY[]::TEXT[],
        ARRAY['client_credentials']::TEXT[],
        ARRAY[]::TEXT[],
        'client_secret_post',
        'memory:read memory:write'
    ) ON CONFLICT (client_id) DO UPDATE SET
        client_secret_hash = EXCLUDED.client_secret_hash,
        scope = EXCLUDED.scope;

    -- engram-search: Vector Search Service
    INSERT INTO oauth_clients (
        client_id, client_secret_hash, client_name,
        redirect_uris, grant_types, response_types,
        token_endpoint_auth_method, scope
    ) VALUES (
        'engram-search',
        hash,
        'Engram Search',
        ARRAY[]::TEXT[],
        ARRAY['client_credentials']::TEXT[],
        ARRAY[]::TEXT[],
        'client_secret_post',
        'memory:read query:read'
    ) ON CONFLICT (client_id) DO UPDATE SET
        client_secret_hash = EXCLUDED.client_secret_hash,
        scope = EXCLUDED.scope;

    -- engram-tuner: Hyperparameter Optimization Service
    INSERT INTO oauth_clients (
        client_id, client_secret_hash, client_name,
        redirect_uris, grant_types, response_types,
        token_endpoint_auth_method, scope
    ) VALUES (
        'engram-tuner',
        hash,
        'Engram Tuner',
        ARRAY[]::TEXT[],
        ARRAY['client_credentials']::TEXT[],
        ARRAY[]::TEXT[],
        'client_secret_post',
        'memory:read query:read'
    ) ON CONFLICT (client_id) DO UPDATE SET
        client_secret_hash = EXCLUDED.client_secret_hash,
        scope = EXCLUDED.scope;

    -- engram-mcp-server: MCP Server
    INSERT INTO oauth_clients (
        client_id, client_secret_hash, client_name,
        redirect_uris, grant_types, response_types,
        token_endpoint_auth_method, scope
    ) VALUES (
        'engram-mcp-server',
        hash,
        'Engram MCP Server',
        ARRAY[]::TEXT[],
        ARRAY['client_credentials']::TEXT[],
        ARRAY[]::TEXT[],
        'client_secret_post',
        'memory:read memory:write query:read'
    ) ON CONFLICT (client_id) DO UPDATE SET
        client_secret_hash = EXCLUDED.client_secret_hash,
        scope = EXCLUDED.scope;

    RAISE NOTICE 'Service clients seeded successfully with hash: %...', LEFT(hash, 8);
END $$;

-- Verify the clients were created
SELECT client_id, client_name, scope, token_endpoint_auth_method
FROM oauth_clients
WHERE client_id LIKE 'engram-%'
ORDER BY client_id;
