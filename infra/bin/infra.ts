#!/usr/bin/env node
import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as dotenv from "dotenv";
import { InfraStack } from "../lib/infra-stack";

// Load .env.local first (local overrides), then fall back to .env
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const app = new cdk.App();

// If AWS_ACCOUNT_ID is specified in .env.local, use it to pin the environment.
// Otherwise, leave env undefined to synthesize an environment-agnostic stack,
// letting the CDK CLI resolve the account and region at deploy time.
const env = process.env.AWS_ACCOUNT_ID
  ? {
      account: process.env.AWS_ACCOUNT_ID,
      region: process.env.AWS_DEFAULT_REGION || "us-east-1",
    }
  : undefined;

new InfraStack(app, "InfraStack", { env });
