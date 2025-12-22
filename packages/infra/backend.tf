# Remote state storage using HTTP backend via Engram API
# The API key is provided via environment variable:
#   TF_HTTP_USERNAME and TF_HTTP_PASSWORD (password is the API key)
#
# To initialize:
#   export TF_HTTP_USERNAME="tofu"
#   export TF_HTTP_PASSWORD="your-api-key-with-state:write-scope"
#   tofu init

terraform {
  backend "http" {
    address        = "https://api.statient.com/v1/tofu"
    lock_address   = "https://api.statient.com/v1/tofu/lock"
    unlock_address = "https://api.statient.com/v1/tofu/lock"
    lock_method    = "POST"
    unlock_method  = "POST"
  }
}
