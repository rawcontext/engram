# OAuth client credentials for service-to-service authentication
# These are used by services deployed via docker-compose.prod.yml on the Hetzner server
# to authenticate with the Observatory OAuth server.

locals {
  oauth_config = {
    tuner = {
      client_id     = "engram-tuner"
      client_secret = var.engram_tuner_client_secret
    }
    search = {
      client_id     = "engram-search"
      client_secret = var.engram_search_client_secret
    }
    console = {
      client_id     = "engram-console"
      client_secret = var.engram_console_client_secret
    }
    ingestion = {
      client_id     = "engram-ingestion"
      client_secret = var.engram_ingestion_client_secret
    }
  }

  # Environment variables for each service
  oauth_env = {
    tuner = {
      ENGRAM_AUTH_SERVER_URL = "https://observatory.${var.domain}"
      ENGRAM_CLIENT_ID       = local.oauth_config.tuner.client_id
      ENGRAM_CLIENT_SECRET   = local.oauth_config.tuner.client_secret
    }
    search = {
      ENGRAM_AUTH_SERVER_URL = "https://observatory.${var.domain}"
      ENGRAM_CLIENT_ID       = local.oauth_config.search.client_id
      ENGRAM_CLIENT_SECRET   = local.oauth_config.search.client_secret
    }
    console = {
      ENGRAM_AUTH_SERVER_URL = "https://observatory.${var.domain}"
      ENGRAM_CLIENT_ID       = local.oauth_config.console.client_id
      ENGRAM_CLIENT_SECRET   = local.oauth_config.console.client_secret
    }
    ingestion = {
      ENGRAM_AUTH_SERVER_URL = "https://observatory.${var.domain}"
      ENGRAM_CLIENT_ID       = local.oauth_config.ingestion.client_id
      ENGRAM_CLIENT_SECRET   = local.oauth_config.ingestion.client_secret
    }
  }
}
