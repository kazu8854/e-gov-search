#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { EGovSearchStack } from "../lib/e-gov-search-stack";

const app = new cdk.App();

new EGovSearchStack(app, "EGovSearchStack", {
  description: "法令探索AI - サーバレスNext.jsアプリケーション",
});
