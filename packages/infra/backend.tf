# Remote state storage using HTTP backend via Engram API
# The API key is provided via environment variable:
#   TF_HTTP_USERNAME and TF_HTTP_PASSWORD (password is the API key)
#
# To initialize, override the backend URLs with your domain:
#   export TF_HTTP_USERNAME="tofu"
#   export TF_HTTP_PASSWORD="your-api-key-with-state:write-scope"
#   tofu init \
#     -backend-config="address=https://api.YOUR_DOMAIN/v1/tofu" \
#     -backend-config="lock_address=https://api.YOUR_DOMAIN/v1/tofu/lock" \
#     -backend-config="unlock_address=https://api.YOUR_DOMAIN/v1/tofu/lock"

terraform {
  backend "http" {
    # Placeholder URLs - override with -backend-config during init
    address        = "https://api.example.com/v1/tofu"
    lock_address   = "https://api.example.com/v1/tofu/lock"
    unlock_address = "https://api.example.com/v1/tofu/lock"
    lock_method    = "POST"
    unlock_method  = "POST"
  }
}
