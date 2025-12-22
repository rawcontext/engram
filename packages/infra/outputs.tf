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
