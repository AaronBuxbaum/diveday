#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { EmailStack } from "../lib/email-stack";
import { InfraStack } from "../lib/infra-stack";
import {
  EMAIL_STACK_ID,
  EMAIL_STACK_NAME,
  MAIN_STACK_ID,
  MAIN_STACK_NAME,
  SES_REGION,
} from "../lib/stack-config";

const app = new cdk.App();

const tags = {
  Project: "diveday",
  ManagedBy: "cdk",
};

new InfraStack(app, MAIN_STACK_ID, {
  stackName: MAIN_STACK_NAME,
  tags,
});

// Pinned to its own region, and account-agnostic on purpose: `cdk synth` runs
// with no credentials at all in .github/workflows/infra.yml's diff job, so
// naming an account here would make a template that only builds for somebody
// logged in. Region-specific plus account-agnostic is a shape CDK supports, and
// the region is the only half that has to be a decision rather than an
// accident -- see infra/lib/stack-config.ts for why it is us-east-2 today.
new EmailStack(app, EMAIL_STACK_ID, {
  stackName: EMAIL_STACK_NAME,
  env: { region: SES_REGION },
  tags,
});
