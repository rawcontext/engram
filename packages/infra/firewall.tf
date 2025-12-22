# Hetzner Cloud-level firewall
# Only expose SSH, HTTP, and HTTPS - Caddy handles reverse proxying

resource "hcloud_firewall" "engram" {
  name = "engram-firewall"

  # SSH
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # HTTP (Caddy)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # HTTPS (Caddy)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # ICMP (ping)
  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  labels = {
    project    = "engram"
    managed-by = "opentofu"
  }
}

resource "hcloud_firewall_attachment" "engram" {
  firewall_id = hcloud_firewall.engram.id
  server_ids  = [hcloud_server.engram.id]
}
