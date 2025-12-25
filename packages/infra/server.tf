resource "hcloud_server" "engram" {
  name        = var.server_name
  server_type = var.server_type
  image       = var.image
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.engram.id]

  labels = {
    environment = "production"
    project     = "engram"
    managed-by  = "opentofu"
  }

  # Cloud-init for initial server setup
  user_data = <<-EOF
    #cloud-config
    users:
      - name: engram
        groups: sudo, docker
        shell: /bin/bash
        sudo: ALL=(ALL) NOPASSWD:ALL
        ssh_authorized_keys:
          - ${var.ssh_public_key}

    package_update: true
    package_upgrade: true

    packages:
      - docker.io
      - docker-compose-v2
      - ufw
      - htop
      - curl
      - wget
      - git
      - jq
      - unzip

    runcmd:
      # Enable and start Docker
      - systemctl enable docker
      - systemctl start docker

      # Configure firewall (UFW) - only HTTP/HTTPS, Caddy handles reverse proxying
      - ufw default deny incoming
      - ufw default allow outgoing
      - ufw allow OpenSSH
      - ufw allow 80/tcp    # HTTP (Caddy)
      - ufw allow 443/tcp   # HTTPS (Caddy)
      - ufw --force enable

      # Create application directory
      - mkdir -p /opt/engram
      - chown engram:engram /opt/engram

      # Add engram user to docker group
      - usermod -aG docker engram
  EOF

  lifecycle {
    ignore_changes = [user_data, image, ssh_keys]
  }
}
