resource "aws_s3_bucket" "web" { bucket = "wealth-tracker-web-235607286117" }
resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_cloudfront_origin_access_control" "web" {
  name                              = local.name
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
resource "aws_acm_certificate" "web" {
  provider          = aws.edge
  domain_name       = local.domain
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}
resource "aws_route53_record" "validation" {
  zone_id = local.zone_id
  name    = tolist(aws_acm_certificate.web.domain_validation_options)[0].resource_record_name
  type    = tolist(aws_acm_certificate.web.domain_validation_options)[0].resource_record_type
  records = [tolist(aws_acm_certificate.web.domain_validation_options)[0].resource_record_value]
  ttl     = 60
}
resource "aws_acm_certificate_validation" "web" {
  provider                = aws.edge
  certificate_arn         = aws_acm_certificate.web.arn
  validation_record_fqdns = [aws_route53_record.validation.fqdn]
}
data "aws_cloudfront_cache_policy" "api" { name = "Managed-CachingDisabled" }
data "aws_cloudfront_origin_request_policy" "api" { name = "Managed-AllViewerExceptHostHeader" }
resource "aws_cloudfront_function" "spa" {
  name    = "${local.name}-spa"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      if (request.uri.indexOf('.') === -1) request.uri = '/index.html';
      return request;
    }
  JS
}
resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  aliases             = [local.domain]
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }
  origin {
    origin_id   = "api"
    domain_name = replace(aws_apigatewayv2_api.api.api_endpoint, "https://", "")
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }
  default_cache_behavior {
    target_origin_id       = "web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.web.id
    compress               = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }
  dynamic "ordered_cache_behavior" {
    for_each = ["/api/*", "/auth/*"]
    content {
      path_pattern             = ordered_cache_behavior.value
      target_origin_id         = "api"
      viewer_protocol_policy   = "https-only"
      allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods           = ["GET", "HEAD"]
      cache_policy_id          = data.aws_cloudfront_cache_policy.api.id
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.api.id
      compress                 = true
    }
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.web.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect    = "Allow", Principal = { Service = "cloudfront.amazonaws.com" },
    Action    = "s3:GetObject", Resource = "${aws_s3_bucket.web.arn}/*",
    Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.web.arn } }
  }] })
}
resource "aws_route53_record" "web" {
  for_each = toset(["A", "AAAA"])
  zone_id  = local.zone_id
  name     = local.domain
  type     = each.value
  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}
output "site_url" { value = "https://${local.domain}" }
output "web_bucket" { value = aws_s3_bucket.web.id }
output "distribution_id" { value = aws_cloudfront_distribution.web.id }

resource "aws_cloudfront_cache_policy" "web" {
  name        = "${local.name}-web"
  min_ttl     = 0
  default_ttl = 3600
  max_ttl     = 31536000
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
    cookies_config { cookie_behavior = "none" }
    headers_config { header_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
  }
}
