output "server_id" {
  description = "Hetzner server ID"
  value       = hcloud_server.engram.id
}

output "server_ip" {
  description = "Public IPv4 address of the server"
  value       = hcloud_server.engram.ipv4_address
}

output "server_ipv6" {
  description = "Public IPv6 address of the server"
  value       = hcloud_server.engram.ipv6_address
}

output "server_status" {
  description = "Server status"
  value       = hcloud_server.engram.status
}

output "ssh_command" {
  description = "SSH command to connect to the server"
  value       = "ssh engram@${hcloud_server.engram.ipv4_address}"
}

output "deploy_command" {
  description = "Deploy command"
  value       = "./scripts/deploy-hetzner.sh"
}

# DNS outputs
output "api_url" {
  description = "API service URL (all services consolidated)"
  value       = "https://api.${var.domain}"
}

output "search_url" {
  description = "Search service URL (path-based routing)"
  value       = "https://api.${var.domain}/v1/search"
}

output "tuner_url" {
  description = "Tuner service URL (path-based routing)"
  value       = "https://api.${var.domain}/v1/tuner"
}

output "observatory_url" {
  description = "Observatory UI URL"
  value       = "https://observatory.${var.domain}"
}

# OAuth configuration outputs
output "oauth_tuner_client_id" {
  description = "OAuth client ID for tuner service"
  value       = local.oauth_config.tuner.client_id
}

output "oauth_search_client_id" {
  description = "OAuth client ID for search service"
  value       = local.oauth_config.search.client_id
}

output "oauth_console_client_id" {
  description = "OAuth client ID for console service"
  value       = local.oauth_config.console.client_id
}

output "oauth_ingestion_client_id" {
  description = "OAuth client ID for ingestion service"
  value       = local.oauth_config.ingestion.client_id
}

output "oauth_auth_server_url" {
  description = "OAuth authorization server URL"
  value       = "https://observatory.${var.domain}"
}

# Sensitive outputs (use: tofu output -json | jq -r '.oauth_env_tuner.value')
output "oauth_env_tuner" {
  description = "OAuth environment variables for tuner service"
  value       = local.oauth_env.tuner
  sensitive   = true
}

output "oauth_env_search" {
  description = "OAuth environment variables for search service"
  value       = local.oauth_env.search
  sensitive   = true
}

output "oauth_env_console" {
  description = "OAuth environment variables for console service"
  value       = local.oauth_env.console
  sensitive   = true
}

output "oauth_env_ingestion" {
  description = "OAuth environment variables for ingestion service"
  value       = local.oauth_env.ingestion
  sensitive   = true
}
