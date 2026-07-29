# Infrastructure Provisioning Runbook

How to provision and manage AWS infrastructure for DiveDay using the AWS CDK (Cloud Development Kit).

All infrastructure is defined as code under the [infra/](../../infra/) directory in TypeScript.

---

## Overview

We use AWS CDK to model, deploy, and update our cloud resources. Currently, the infrastructure consists of the `InfraStack` stack, which provisions:
- An S3 bucket for storing visual regression testing (VRT) baselines and HTML reports.
- A `reg-suit-bot` IAM user with specific S3 read/write permissions.
- A dedicated `cdk-deployer` IAM user with `AdministratorAccess` intended to manage all future CDK deployments.

---

## 1. AWS Credentials & Authentication

To provision or modify infrastructure, you must authenticate with AWS.

### Installing Prerequisites
Ensure the [AWS CLI](https://aws.amazon.com/cli/) is installed on your local machine.

### Option A: Local AWS Profile (Recommended for first-time setup)
If bootstrapping the account for the first time, configure your credentials using the CLI:
```bash
aws configure
```
Enter your Administrator Access Key ID, Secret Access Key, Default region name (e.g., `us-east-1`), and Default output format (`json`).

### Option B: Session Environment Variables
Alternatively, you can export credentials in your current terminal session:
```bash
export AWS_ACCESS_KEY_ID="your-access-key-id"
export AWS_SECRET_ACCESS_KEY="your-secret-access-key"
export AWS_DEFAULT_REGION="us-east-1"
```

---

## 2. Bootstrapping the Environment

AWS CDK requires one-time bootstrapping of an AWS environment (combination of account and region) before you can deploy any stacks. This process provisions resources CDK needs to operate (like an S3 bucket for staging assets).

To bootstrap the default account/region:
```bash
pnpm infra:bootstrap
```

> [!NOTE]
> If your environment requires an explicit account pin, set the `AWS_ACCOUNT_ID` environment variable:
> `AWS_ACCOUNT_ID=123456789012 pnpm infra:bootstrap`

---

## 3. Managing and Deploying Stacks

Once bootstrapped, you can use the package scripts to synthesize, inspect, and deploy your CDK stacks.

### Synthesizing CloudFormation Templates
To translate your TypeScript CDK definitions into raw AWS CloudFormation templates:
```bash
pnpm infra:synth
```

### Comparing Changes (Diff)
Before deploying, always run a diff to preview how your changes will affect the active environment:
```bash
pnpm infra:diff
```

### Deploying Stacks
To deploy the stack to AWS:
```bash
pnpm infra:deploy
```

> [!IMPORTANT]
> The `infra:deploy` script is configured with `--require-approval never` to execute non-interactively. Ensure you have run `pnpm infra:diff` to inspect changes beforehand.

---

## 4. Context Variables & Custom Configuration

You can customize stack properties dynamically during synthesis and deployment using CDK Context.

In our stack:
- `bucketName`: Sets the custom name for the created S3 bucket (default: `diveday-vrt`).
- `userName`: Sets the name for the IAM bot user (default: `reg-suit-bot`).

Pass these values during deployment or synthesis using the `--context` flag:
```bash
pnpm infra:deploy --context bucketName=my-custom-prod-bucket --context userName=my-custom-bot-user
```

---

## 5. Outputs and Environment Configuration

Upon successful deployment, the CDK CLI outputs key resources and credentials. Map these to your `.env.local` to allow the application or CI runner to communicate with AWS:

- **CDK Deployer User (`cdk-deployer`):** Use the outputted credentials (`CdkDeployerAccessKeyId`/`CdkDeployerSecretAccessKey`) for subsequent CI/CD deployments to avoid using root credentials.
- **S3 Bucket Details:** Use `S3BucketName` and `IAMUserAccessKey` / `IAMUserSecretKey` for S3 upload plugins.
