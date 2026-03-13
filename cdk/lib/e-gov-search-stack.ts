import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as path from "path";

export class EGovSearchStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ================================
    // Secrets Manager: OpenAI API Key
    // ================================
    // デプロイ後に手動で値を設定する必要があります:
    //   aws secretsmanager put-secret-value \
    //     --secret-id e-gov-search/openai-api-key \
    //     --secret-string "sk-your-key"
    const openaiSecret = new secretsmanager.Secret(this, "OpenAIApiKey", {
      secretName: "e-gov-search/openai-api-key",
      description: "OpenAI API Key for 法令探索AI",
    });

    // ================================
    // S3 Bucket: 静的アセット
    // ================================
    const staticBucket = new s3.Bucket(this, "StaticAssets", {
      bucketName: undefined, // CDKが自動生成
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    // ================================
    // Lambda: Next.js SSR + API
    // ================================
    const nextjsFunction = new lambda.Function(this, "NextjsHandler", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "server-handler.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../.lambda-package"),
        {
          exclude: [".next/cache/**"],
        }
      ),
      memorySize: 1024,
      timeout: cdk.Duration.minutes(3), // SSE探索は最大120秒
      environment: {
        NODE_ENV: "production",
        // OPENAI_API_KEYはSecrets Managerから取得
        OPENAI_SECRET_ARN: openaiSecret.secretArn,
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
      description: "法令探索AI - Next.js SSR & API Handler",
    });

    // Lambda に Secrets Manager の読み取り権限を付与
    openaiSecret.grantRead(nextjsFunction);

    // Lambda Function URL (SSEストリーミング対応)
    const functionUrl = nextjsFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // CloudFront経由でアクセス
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM, // SSEストリーミング対応
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ["*"],
      },
    });

    // ================================
    // CloudFront Distribution
    // ================================

    // S3 Origin (静的アセット)
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(staticBucket);

    // Lambda Function URL Origin
    const lambdaOrigin = new origins.FunctionUrlOrigin(functionUrl, {
      readTimeout: cdk.Duration.minutes(3),
      keepaliveTimeout: cdk.Duration.seconds(60),
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "法令探索AI - e-Gov法令検索",
      defaultBehavior: {
        origin: lambdaOrigin,
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy:
          cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy:
          cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      additionalBehaviors: {
        // 静的アセットはS3から配信
        "_next/static/*": {
          origin: s3Origin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      minimumProtocolVersion:
        cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // ================================
    // S3 Deployment: 静的アセットをアップロード
    // ================================
    new s3deploy.BucketDeployment(this, "DeployStaticAssets", {
      sources: [
        s3deploy.Source.asset(
          path.join(__dirname, "../../.next/static"),
        ),
      ],
      destinationBucket: staticBucket,
      destinationKeyPrefix: "_next/static",
      distribution,
      distributionPaths: ["/_next/static/*"],
    });

    // ================================
    // Outputs
    // ================================
    new cdk.CfnOutput(this, "CloudFrontURL", {
      value: `https://${distribution.distributionDomainName}`,
      description: "法令探索AI - アプリケーションURL",
    });

    new cdk.CfnOutput(this, "LambdaFunctionURL", {
      value: functionUrl.url,
      description: "Lambda Function URL (直接アクセス用)",
    });

    new cdk.CfnOutput(this, "StaticBucketName", {
      value: staticBucket.bucketName,
      description: "静的アセット用S3バケット",
    });

    new cdk.CfnOutput(this, "OpenAISecretArn", {
      value: openaiSecret.secretArn,
      description: "OpenAI APIキーのSecrets Manager ARN（要手動設定）",
    });
  }
}
