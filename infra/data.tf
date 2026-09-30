resource "aws_dynamodb_table" "app" {
  name                        = local.name
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  range_key                   = "sk"
  deletion_protection_enabled = true
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
  point_in_time_recovery { enabled = true }
  server_side_encryption { enabled = true }
  lifecycle { prevent_destroy = true }
}
resource "aws_kms_key" "credentials" {
  description             = "Trading 212 credentials for Wealth production"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  lifecycle { prevent_destroy = true }
}
resource "aws_kms_alias" "credentials" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.credentials.key_id
}
resource "aws_secretsmanager_secret" "google" {
  name                    = "wealth-tracker/production/google"
  description             = "Google OAuth client; value managed outside Terraform"
  recovery_window_in_days = 30
  lifecycle { prevent_destroy = true }
}
output "table_name" { value = aws_dynamodb_table.app.name }
output "credential_key_arn" { value = aws_kms_key.credentials.arn }
output "google_secret_arn" { value = aws_secretsmanager_secret.google.arn }
resource "aws_secretsmanager_secret" "gemini" {
  name                    = "wealth-tracker/production/gemini"
  description             = "Server-managed Gemini API key; value managed outside Terraform"
  recovery_window_in_days = 30
  lifecycle { prevent_destroy = true }
}
output "gemini_secret_arn" { value = aws_secretsmanager_secret.gemini.arn }
