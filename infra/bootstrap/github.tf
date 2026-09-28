data "aws_iam_openid_connect_provider" "github" {
  arn = "arn:aws:iam::235607286117:oidc-provider/token.actions.githubusercontent.com"
}

resource "aws_iam_role" "github_deploy" {
  name        = "wealth-tracker-github-deploy"
  description = "Deploy wealth-tracker from ravenkls/wealth-tracker main via GitHub Actions OIDC"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = data.aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = [
            "repo:ravenkls/wealth-tracker:ref:refs/heads/main",
            "repo:ravenkls@22757645/wealth-tracker@1393800762:ref:refs/heads/main"
          ]
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "wealth-tracker-deployment"
  role = aws_iam_role.github_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "InfrastructureServices"
        Effect   = "Allow"
        Action   = ["apigateway:*", "acm:*", "cloudfront:*"]
        Resource = "*"
      },
      {
        Sid    = "WealthDataAndRuntime"
        Effect = "Allow"
        Action = ["dynamodb:*", "lambda:*", "logs:*"]
        Resource = [
          "arn:aws:dynamodb:eu-west-2:235607286117:table/wealth-tracker-*",
          "arn:aws:lambda:eu-west-2:235607286117:function:wealth-tracker-*",
          "arn:aws:logs:eu-west-2:235607286117:log-group:/aws/lambda/wealth-tracker-*",
          "arn:aws:logs:eu-west-2:235607286117:log-group:/aws/apigateway/wealth-tracker-*"
        ]
      },
      {
        Sid      = "ReadServiceMetadata"
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups", "lambda:GetAccountSettings", "kms:ListAliases"]
        Resource = "*"
      },
      {
        Sid       = "CreateCredentialKey"
        Effect    = "Allow"
        Action    = "kms:CreateKey"
        Resource  = "*"
        Condition = { StringEquals = { "aws:RequestTag/Project" = "wealth-tracker" } }
      },
      {
        Sid       = "ManageCredentialKey"
        Effect    = "Allow"
        Action    = ["kms:DescribeKey", "kms:GetKeyPolicy", "kms:PutKeyPolicy", "kms:GetKeyRotationStatus", "kms:EnableKeyRotation", "kms:ListResourceTags", "kms:TagResource", "kms:UntagResource", "kms:CreateAlias", "kms:UpdateAlias", "kms:DeleteAlias"]
        Resource  = "arn:aws:kms:eu-west-2:235607286117:key/*"
        Condition = { StringEquals = { "aws:ResourceTag/Project" = "wealth-tracker" } }
      },
      {
        Sid      = "CredentialAlias"
        Effect   = "Allow"
        Action   = ["kms:CreateAlias", "kms:UpdateAlias", "kms:DeleteAlias"]
        Resource = "arn:aws:kms:eu-west-2:235607286117:alias/wealth-tracker-*"
      },
      {
        Sid      = "GoogleSecretMetadata"
        Effect   = "Allow"
        Action   = ["secretsmanager:CreateSecret", "secretsmanager:DescribeSecret", "secretsmanager:GetResourcePolicy", "secretsmanager:TagResource", "secretsmanager:UntagResource", "secretsmanager:UpdateSecret"]
        Resource = "arn:aws:secretsmanager:eu-west-2:235607286117:secret:wealth-tracker/*"
      },
      {
        Sid      = "IdentifyAccount"
        Effect   = "Allow"
        Action   = "sts:GetCallerIdentity"
        Resource = "*"
      },
      {
        Sid    = "ManageWealthBucketsAndState"
        Effect = "Allow"
        Action = "s3:*"
        Resource = [
          "arn:aws:s3:::wealth-tracker-terraform-235607286117",
          "arn:aws:s3:::wealth-tracker-terraform-235607286117/*",
          "arn:aws:s3:::wealth-tracker-web-235607286117",
          "arn:aws:s3:::wealth-tracker-web-235607286117/*"
        ]
      },
      {
        Sid    = "ManageWealthRoles"
        Effect = "Allow"
        Action = [
          "iam:AttachRolePolicy",
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:DeleteRolePolicy",
          "iam:DetachRolePolicy",
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole",
          "iam:ListRolePolicies",
          "iam:PassRole",
          "iam:PutRolePolicy",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:UpdateAssumeRolePolicy",
          "iam:UpdateRoleDescription"
        ]
        Resource = "arn:aws:iam::235607286117:role/wealth-tracker-production-lambda"
      },
      {
        Sid    = "ManageWealthDns"
        Effect = "Allow"
        Action = [
          "route53:GetHostedZone",
          "route53:ListResourceRecordSets"
        ]
        Resource = "arn:aws:route53:::hostedzone/Z02397952QM7A2G800YC0"
      },
      {
        Sid       = "ChangeWealthDns"
        Effect    = "Allow"
        Action    = "route53:ChangeResourceRecordSets"
        Resource  = "arn:aws:route53:::hostedzone/Z02397952QM7A2G800YC0"
        Condition = { "ForAllValues:StringLike" = { "route53:ChangeResourceRecordSetsNormalizedRecordNames" = ["wealth.kristiansmith.dev", "*.wealth.kristiansmith.dev"] } }
      },
      {
        Sid      = "ReadDnsMetadata"
        Effect   = "Allow"
        Action   = ["route53:GetChange", "route53:ListHostedZones"]
        Resource = "*"
      }
    ]
  })
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}
