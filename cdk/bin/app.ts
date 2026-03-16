#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { EGovSearchStack } from "../lib/e-gov-search-stack";

const app = new cdk.App();
new EGovSearchStack(app, "EGovSearchStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "ap-northeast-1",
  },
  description: "法令探索AI - e-Gov法令検索 (AppSync + Step Functions + Lambda)",
});
