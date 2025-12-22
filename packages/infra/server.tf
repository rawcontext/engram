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
          - ${file(pathexpand(var.ssh_public_key_path))}

    package_update: true
    package_upgrade: true

    packages:
      - docker.io
      - docker-compose-plugin
      - ufw
      - htop
      - curl
      - wget
      - git

    runcmd:
      # Enable and start Docker
      - systemctl enable docker
      - systemctl start docker

      # Configure firewall (UFW)
      - ufw default deny incoming
      - ufw default allow outgoing
      - ufw allow OpenSSH
      - ufw allow 80/tcp    # HTTP
      - ufw allow 443/tcp   # HTTPS
      - ufw allow 8080/tcp  # API
      - ufw allow 5002/tcp  # Search
      - ufw allow 8000/tcp  # Tuner
      - ufw --force enable

      # Create application directory
      - mkdir -p /opt/engram
      - chown engram:engram /opt/engram

      # Add engram user to docker group
      - usermod -aG docker engram
  EOF
}
