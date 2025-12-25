resource "hcloud_ssh_key" "engram" {
  name       = var.ssh_key_name
  public_key = var.ssh_public_key
}
