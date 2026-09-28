resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.name}"
  retention_in_days = 14
}
resource "aws_iam_role" "lambda" {
  name               = "${local.name}-lambda"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }] })
}
resource "aws_iam_role_policy" "lambda" {
  role = aws_iam_role.lambda.id
  name = "application"
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.lambda.arn}:*" },
    { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem", "dynamodb:DescribeTable", "dynamodb:ConditionCheckItem"], Resource = aws_dynamodb_table.app.arn },
    { Effect = "Allow", Action = ["kms:Encrypt", "kms:Decrypt"], Resource = aws_kms_key.credentials.arn, Condition = { Null = { "kms:EncryptionContext:account" = "false" } } },
    { Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = aws_secretsmanager_secret.google.arn }
  ] })
}
resource "aws_lambda_function" "api" {
  function_name    = local.name
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = "${path.module}/../.build/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../.build/lambda.zip")
  memory_size      = 512
  timeout          = 30
  environment {
    variables = {
      NODE_ENV           = "production"
      APP_ORIGIN         = "https://${local.domain}"
      DYNAMODB_TABLE     = aws_dynamodb_table.app.name
      CREDENTIAL_KEY_ARN = aws_kms_key.credentials.arn
      GOOGLE_SECRET_ARN  = aws_secretsmanager_secret.google.arn
    }
  }
  depends_on = [aws_iam_role_policy.lambda, aws_cloudwatch_log_group.lambda]
}
resource "aws_apigatewayv2_api" "api" {
  name          = local.name
  protocol_type = "HTTP"
}
resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}
resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}
resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${local.name}"
  retention_in_days = 14
}
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 40
    throttling_rate_limit  = 20
  }
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format          = jsonencode({ requestId = "$context.requestId", status = "$context.status", route = "$context.routeKey", latency = "$context.responseLatency" })
  }
}
resource "aws_lambda_permission" "api" {
  statement_id  = "ApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
output "api_endpoint" { value = aws_apigatewayv2_api.api.api_endpoint }
