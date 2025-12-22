variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

variable "server_name" {
  description = "Name of the server"
  type        = string
  default     = "engram"
}

variable "server_type" {
  description = "Hetzner server type (cpx31 = 4 vCPU, 8GB RAM)"
  type        = string
  default     = "cpx31"
}

variable "location" {
  description = "Hetzner datacenter location"
  type        = string
  default     = "ash" # Ashburn, VA
}

variable "image" {
  description = "Server OS image"
  type        = string
  default     = "ubuntu-24.04"
}

variable "ssh_public_key_path" {
  description = "Path to SSH public key"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "ssh_key_name" {
  description = "Name for the SSH key in Hetzner"
  type        = string
  default     = "engram-key"
}

# Vercel DNS configuration
variable "vercel_api_token" {
  description = "Vercel API token for DNS management"
  type        = string
  sensitive   = true
}

variable "vercel_team_id" {
  description = "Vercel team ID (optional)"
  type        = string
  default     = null
}

variable "domain" {
  description = "Domain name for DNS records"
  type        = string
  default     = "statient.com"
}
