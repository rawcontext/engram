# DNS records for Engram services
# Managed via Vercel DNS, pointing to Hetzner server
# Domain structure: *.engram.rawcontext.com

# Apex subdomain - engram.rawcontext.com
resource "vercel_dns_record" "apex" {
  domain = var.domain
  name   = "engram"
  type   = "A"
  ttl    = 60
  value  = hcloud_server.engram.ipv4_address
}

resource "vercel_dns_record" "api" {
  domain = var.domain
  name   = "api.engram"
  type   = "A"
  ttl    = 60
  value  = hcloud_server.engram.ipv4_address
}

resource "vercel_dns_record" "observatory" {
  domain = var.domain
  name   = "observatory.engram"
  type   = "A"
  ttl    = 60
  value  = hcloud_server.engram.ipv4_address
}

resource "vercel_dns_record" "console" {
  domain = var.domain
  name   = "console.engram"
  type   = "A"
  ttl    = 60
  value  = hcloud_server.engram.ipv4_address
}
