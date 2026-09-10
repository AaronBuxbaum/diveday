#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { EmailStack } from "../lib/email-stack";
import { GlobalStack } from "../lib/global-stack";
import { InfraStack } from "../lib/infra-stack";
import {
  EMAIL_STACK_ID,
  EMAIL_STACK_NAME,
  GLOBAL_STACK_ID,
  GLOBAL_STACK_NAME,
  MAIN_STACK_ID,
  MAIN_STACK_NAME,
  PRIMARY_REGION,
  ROUTE53_METRICS_REGION,
  SES_REGION,
} from "../lib/stack-config";

const app = new cdk.App();

const tags = {
  Project: "diveday",
  ManagedBy: "cdk",
};

// Every stack names its region and none names its account. Region-specific plus
// account-agnostic is a shape CDK supports, and both halves are deliberate:
// `cdk synth` runs with no credentials at all in .github/workflows/infra.yml's
// diff job, so naming an account here would make a template that only builds
// for somebody logged in -- while leaving the region off would make the region
// whatever `AWS_REGION` the deploying shell happened to carry, which is not a
// property of a deployment anybody reviews. See config/aws-regions.mjs for what
// each of these three is and what changing one costs.
new InfraStack(app, MAIN_STACK_ID, {
  stackName: MAIN_STACK_NAME,
  env: { region: PRIMARY_REGION },
  tags,
});

new EmailStack(app, EMAIL_STACK_ID, {
  stackName: EMAIL_STACK_NAME,
  env: { region: SES_REGION },
  tags,
});

new GlobalStack(app, GLOBAL_STACK_ID, {
  stackName: GLOBAL_STACK_NAME,
  env: { region: ROUTE53_METRICS_REGION },
  tags,
});
