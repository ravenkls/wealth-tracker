resource "aws_cloudwatch_log_group" "endute_sync" {
  name              = "/aws/lambda/${local.name}-endute-sync"
  retention_in_days = 14
}
resource "aws_lambda_function" "endute_sync" {
  function_name    = "${local.name}-endute-sync"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = "index.syncHandler"
  filename         = "${path.module}/../.build/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../.build/lambda.zip")
  memory_size      = 512
  timeout          = 120
  environment {
    variables = aws_lambda_function.api.environment[0].variables
  }
  depends_on = [aws_iam_role_policy.lambda, aws_cloudwatch_log_group.endute_sync]
}
resource "aws_iam_role_policy" "endute_dispatch" {
  role = aws_iam_role.lambda.id
  name = "endute-worker-dispatch"
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = "lambda:InvokeFunction", Resource = aws_lambda_function.endute_sync.arn },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.endute_sync.arn}:*" }
  ] })
}
resource "aws_lambda_function_event_invoke_config" "endute_sync" {
  function_name                = aws_lambda_function.endute_sync.function_name
  maximum_event_age_in_seconds = 300
  maximum_retry_attempts       = 1
}
resource "aws_iam_role" "endute_scheduler" {
  name = "${local.name}-endute-scheduler"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "scheduler.amazonaws.com" },
    Condition = { StringEquals = { "aws:SourceAccount" = "235607286117" }, ArnEquals = { "aws:SourceArn" = "arn:aws:scheduler:eu-west-2:235607286117:schedule-group/default" } } }
  ] })
}
resource "aws_iam_role_policy" "endute_scheduler" {
  role = aws_iam_role.endute_scheduler.id
  name = "invoke-endute-worker"
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = "lambda:InvokeFunction", Resource = aws_lambda_function.endute_sync.arn }
  ] })
}
resource "aws_scheduler_schedule" "endute_sync" {
  name                = "${local.name}-endute-sync"
  description         = "Import connected Endute bank transactions every five minutes"
  schedule_expression = "rate(5 minutes)"
  flexible_time_window { mode = "OFF" }
  target {
    arn      = aws_lambda_function.endute_sync.arn
    role_arn = aws_iam_role.endute_scheduler.arn
    input    = jsonencode({ kind = "dispatch" })
    retry_policy {
      maximum_event_age_in_seconds = 300
      maximum_retry_attempts       = 1
    }
  }
  depends_on = [aws_iam_role_policy.endute_scheduler, aws_iam_role_policy.endute_dispatch]
}
