# Remote state storage using HTTP backend via Engram API
# Auth is provided via environment variables:
#   TF_HTTP_USERNAME=tofu
#   TF_HTTP_PASSWORD=<oauth-token-with-state:write-scope>
#
# To initialize locally:
#   export TF_HTTP_USERNAME="tofu"
#   export TF_HTTP_PASSWORD="engram_oauth_xxxxx"
#   tofu init

terraform {
  backend "http" {
    address        = "https://api.statient.com/v1/tofu"
    lock_address   = "https://api.statient.com/v1/tofu/lock"
    unlock_address = "https://api.statient.com/v1/tofu/lock"
  }
}
