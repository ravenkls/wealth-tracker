mock_provider "aws" {}
mock_provider "aws" { alias = "edge" }
run "production_security" {
  command = plan
  assert {
    condition     = aws_dynamodb_table.app.deletion_protection_enabled && aws_dynamodb_table.app.point_in_time_recovery[0].enabled
    error_message = "Production data must have deletion protection and point-in-time recovery."
  }
  assert {
    condition     = aws_lambda_function.api.runtime == "nodejs24.x" && aws_lambda_function.api.environment[0].variables.APP_ORIGIN == "https://wealth.kristiansmith.dev"
    error_message = "Lambda must use the expected runtime and secure app origin."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.web.block_public_policy && aws_kms_key.credentials.enable_key_rotation
    error_message = "Web assets must be private and credential encryption must rotate."
  }
  assert {
    condition     = toset([for behavior in aws_cloudfront_distribution.web.ordered_cache_behavior : behavior.path_pattern]) == toset(["/api/*", "/auth/*"])
    error_message = "API and authentication paths must bypass the SPA cache."
  }
  assert {
    condition     = aws_scheduler_schedule.endute_sync.schedule_expression == "rate(5 minutes)" && aws_scheduler_schedule.endute_sync.flexible_time_window[0].mode == "OFF"
    error_message = "Endute transactions must sync every five minutes."
  }
  assert {
    condition     = aws_lambda_function.endute_sync.handler == "index.syncHandler" && aws_lambda_function.endute_sync.timeout == 120
    error_message = "Transaction sync must use its private worker handler with a bounded timeout."
  }
}
