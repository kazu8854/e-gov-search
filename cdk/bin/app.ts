#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { EGovSearchStack } from "../lib/e-gov-search-stack";

const app = new cdk.App();
new EGovSearchStack(app, "EGovSearchStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "ap-northeast-1",
  },
  description: "法令探索AI - AppSync Event API + Step Functions",
});
