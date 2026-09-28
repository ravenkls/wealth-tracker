terraform {
  required_version = ">= 1.9.0, < 2.0.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket         = "wealth-tracker-terraform-235607286117"
    key            = "production/terraform.tfstate"
    region         = "eu-west-2"
    dynamodb_table = "wealth-tracker-terraform-locks"
    encrypt        = true
  }
}
provider "aws" {
  region              = "eu-west-2"
  allowed_account_ids = ["235607286117"]
  default_tags { tags = { Project = "wealth-tracker", Environment = "production", ManagedBy = "Terraform" } }
}
provider "aws" {
  alias               = "edge"
  region              = "us-east-1"
  allowed_account_ids = ["235607286117"]
  default_tags { tags = { Project = "wealth-tracker", Environment = "production", ManagedBy = "Terraform" } }
}
locals {
  name    = "wealth-tracker-production"
  domain  = "wealth.kristiansmith.dev"
  zone_id = "Z02397952QM7A2G800YC0"
}
