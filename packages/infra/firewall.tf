# Optional: Hetzner Cloud-level firewall
# This adds network-level protection in addition to UFW on the server

resource "hcloud_firewall" "engram" {
  name = "engram-firewall"

  # SSH
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # HTTP
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # HTTPS
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # API (8080)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "8080"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # Search (5002)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "5002"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # Tuner (8000)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "8000"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # Observatory (5000)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "5000"
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
