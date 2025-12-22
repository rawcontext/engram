# Remote state storage using PostgreSQL
# The database connection string is provided via environment variable:
#   TF_VAR_pg_conn_str or via backend config
#
# To initialize with the backend:
#   tofu init -backend-config="conn_str=$DATABASE_URL"
#
# Or set the environment variable:
#   export TF_HTTP_ADDRESS="..." for HTTP backend alternative

terraform {
  backend "pg" {
    schema_name = "tofu_state"
  }
}
