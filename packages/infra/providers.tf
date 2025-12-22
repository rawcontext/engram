provider "hcloud" {
  token = var.hcloud_token
}

provider "vercel" {
  api_token = var.vercel_api_token
  team      = var.vercel_team_id
}
