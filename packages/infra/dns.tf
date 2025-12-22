# DNS records for Engram services
# Managed via Vercel DNS, pointing to Hetzner server

resource "vercel_dns_record" "api" {
  domain = var.domain
  name   = "api"
  type   = "A"
  ttl    = 60
  value  = hcloud_server.engram.ipv4_address
}

resource "vercel_dns_record" "search" {
  domain = var.domain
  name   = "search"
  type   = "A"
  ttl    = 60
  value  = hcloud_server.engram.ipv4_address
}

resource "vercel_dns_record" "tuner" {
  domain = var.domain
  name   = "tuner"
  type   = "A"
  ttl    = 60
  value  = hcloud_server.engram.ipv4_address
}

resource "vercel_dns_record" "observatory" {
  domain = var.domain
  name   = "observatory"
  type   = "A"
  ttl    = 60
  value  = hcloud_server.engram.ipv4_address
}
