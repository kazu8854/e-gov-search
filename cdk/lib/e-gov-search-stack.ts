import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";
import * as path from "path";

export class EGovSearchStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ================================
    // Secrets Manager: OpenAI API Key
    // ================================
    const openaiSecret = new secretsmanager.Secret(this, "OpenAIApiKey", {
      secretName: "e-gov-search/openai-api-key",
      description: "OpenAI API Key for 法令探索AI",
    });

    // ================================
    // AppSync Event API
    // ================================
    const eventApi = new appsync.EventApi(this, "SearchEventApi", {
      apiName: "e-gov-search-events",
      authorizationConfig: {
        authProviders: [
          { authorizationType: appsync.AppSyncAuthorizationType.API_KEY },
          { authorizationType: appsync.AppSyncAuthorizationType.IAM },
        ],
        connectionAuthModeTypes: [appsync.AppSyncAuthorizationType.API_KEY],
        defaultSubscribeAuthModeTypes: [appsync.AppSyncAuthorizationType.API_KEY],
        defaultPublishAuthModeTypes: [appsync.AppSyncAuthorizationType.IAM],
      },
      logConfig: {
        fieldLogLevel: appsync.AppSyncFieldLogLevel.INFO,
        retention: logs.RetentionDays.TWO_WEEKS,
      },
    });

    eventApi.addChannelNamespace("search");

    // ================================
    // S3: 静的フロントエンド
    // ================================
    const staticBucket = new s3.Bucket(this, "StaticAssets", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    // ================================
    // Lambda 共通設定
    // ================================
    // 全Lambda関数をlambda/ディレクトリ全体からバンドル（shared/を含める）
    const lambdaCodeAsset = lambda.Code.fromAsset(
      path.join(__dirname, "../../lambda")
    );

    const lambdaDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      logRetention: logs.RetentionDays.TWO_WEEKS,
      code: lambdaCodeAsset,
    };

    const appsyncHttpEndpoint = eventApi.httpDns;
    const appsyncRealtimeEndpoint = eventApi.realtimeDns;

    const aiLambdaEnv = {
      OPENAI_SECRET_ARN: openaiSecret.secretArn,
      APPSYNC_HTTP_ENDPOINT: `https://${appsyncHttpEndpoint}/event`,
    };

    // ================================
    // Lambda: 探索ワーカー群
    // ================================
    const analyzeQueryFn = new lambda.Function(this, "AnalyzeQueryFn", {
      ...lambdaDefaults,
      memorySize: 512,
      timeout: cdk.Duration.minutes(2),
      handler: "analyze-query/index.handler",
      environment: aiLambdaEnv,
      description: "Phase 1: クエリ分析",
    });

    const searchLawsFn = new lambda.Function(this, "SearchLawsFn", {
      ...lambdaDefaults,
      handler: "search-laws/index.handler",
      environment: {
        APPSYNC_HTTP_ENDPOINT: `https://${appsyncHttpEndpoint}/event`,
      },
      description: "Phase 2: 法令検索（並列実行）",
    });

    const selectLawsFn = new lambda.Function(this, "SelectLawsFn", {
      ...lambdaDefaults,
      memorySize: 512,
      timeout: cdk.Duration.minutes(2),
      handler: "select-laws/index.handler",
      environment: aiLambdaEnv,
      description: "Phase 3: 関連度判定",
    });

    const readArticlesFn = new lambda.Function(this, "ReadArticlesFn", {
      ...lambdaDefaults,
      memorySize: 512,
      timeout: cdk.Duration.minutes(3),
      handler: "read-articles/index.handler",
      environment: aiLambdaEnv,
      description: "Phase 4: 条文深掘り（並列実行）",
    });

    const generateConclusionFn = new lambda.Function(this, "GenerateConclusionFn", {
      ...lambdaDefaults,
      memorySize: 512,
      timeout: cdk.Duration.minutes(3),
      handler: "generate-conclusion/index.handler",
      environment: aiLambdaEnv,
      description: "Phase 5: 結論生成",
    });

    // Secrets Manager読み取り権限
    for (const fn of [analyzeQueryFn, selectLawsFn, readArticlesFn, generateConclusionFn]) {
      openaiSecret.grantRead(fn);
    }

    // AppSync Event API publish権限（IAM認証）
    const allWorkerLambdas = [analyzeQueryFn, searchLawsFn, selectLawsFn, readArticlesFn, generateConclusionFn];
    for (const fn of allWorkerLambdas) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["appsync:EventPublish"],
          resources: [`${eventApi.apiArn}/channelNamespace/search`],
        })
      );
    }

    // ================================
    // Step Functions: 探索ワークフロー
    // ================================
    const analyzeTask = new tasks.LambdaInvoke(this, "AnalyzeQuery", {
      lambdaFunction: analyzeQueryFn,
      outputPath: "$.Payload",
    });

    const searchByNameMap = new sfn.Map(this, "SearchByNameMap", {
      maxConcurrency: 5,
      itemsPath: "$.analysis.keywords",
      parameters: {
        "searchId.$": "$.searchId",
        "keyword.$": "$$.Map.Item.Value",
        "searchType": "name",
      },
      resultPath: "$.nameResults",
    });
    searchByNameMap.itemProcessor(
      new tasks.LambdaInvoke(this, "SearchLawsByName", {
        lambdaFunction: searchLawsFn,
        outputPath: "$.Payload",
      })
    );

    const flattenResults = new sfn.Pass(this, "FlattenResults", {
      parameters: {
        "searchId.$": "$.searchId",
        "query.$": "$.query",
        "searchResults.$": "$.nameResults",
      },
    });

    const selectTask = new tasks.LambdaInvoke(this, "SelectLaws", {
      lambdaFunction: selectLawsFn,
      outputPath: "$.Payload",
    });

    const readArticlesMap = new sfn.Map(this, "ReadArticlesMap", {
      maxConcurrency: 3,
      itemsPath: "$.selectedLaws",
      parameters: {
        "searchId.$": "$.searchId",
        "query.$": "$.query",
        "law.$": "$$.Map.Item.Value",
      },
      resultPath: "$.articleResults",
    });
    readArticlesMap.itemProcessor(
      new tasks.LambdaInvoke(this, "ReadArticles", {
        lambdaFunction: readArticlesFn,
        outputPath: "$.Payload",
      })
    );

    const conclusionTask = new tasks.LambdaInvoke(this, "GenerateConclusion", {
      lambdaFunction: generateConclusionFn,
      outputPath: "$.Payload",
    });

    const definition = analyzeTask
      .next(searchByNameMap)
      .next(flattenResults)
      .next(selectTask)
      .next(readArticlesMap)
      .next(conclusionTask);

    const stateMachine = new sfn.StateMachine(this, "SearchWorkflow", {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      stateMachineName: "e-gov-search-workflow",
      timeout: cdk.Duration.minutes(10),
      tracingEnabled: true,
      logs: {
        destination: new logs.LogGroup(this, "StateMachineLogs", {
          retention: logs.RetentionDays.TWO_WEEKS,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: sfn.LogLevel.ERROR,
      },
    });

    // ================================
    // API Gateway: 検索開始エンドポイント
    // ================================
    const startSearchFn = new lambda.Function(this, "StartSearchFn", {
      ...lambdaDefaults,
      handler: "start-search/index.handler",
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
      },
      description: "REST API → Step Functions開始",
    });
    stateMachine.grantStartExecution(startSearchFn);

    const restApi = new apigateway.RestApi(this, "SearchRestApi", {
      restApiName: "e-gov-search-api",
      description: "法令探索AI - 検索開始API",
      deployOptions: {
        stageName: "prod",
        throttlingRateLimit: 10,
        throttlingBurstLimit: 20,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ["POST", "OPTIONS"],
        allowHeaders: ["Content-Type"],
      },
    });

    restApi.root.addResource("search").addMethod(
      "POST",
      new apigateway.LambdaIntegration(startSearchFn)
    );

    // ================================
    // CloudFront Distribution
    // ================================
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(staticBucket);

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "法令探索AI - フロントエンド配信",
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      defaultRootObject: "index.html",
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: cdk.Duration.minutes(5) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: cdk.Duration.minutes(5) },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    new s3deploy.BucketDeployment(this, "DeployFrontend", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "../../out"))],
      destinationBucket: staticBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    // ================================
    // Outputs
    // ================================
    new cdk.CfnOutput(this, "FrontendURL", {
      value: `https://${distribution.distributionDomainName}`,
    });
    new cdk.CfnOutput(this, "RestApiURL", { value: restApi.url });
    new cdk.CfnOutput(this, "AppSyncRealtimeEndpoint", {
      value: `wss://${appsyncRealtimeEndpoint}`,
    });
    new cdk.CfnOutput(this, "OpenAISecretArn", {
      value: openaiSecret.secretArn,
      description: "OpenAI APIキーのSecrets Manager ARN（要手動設定）",
    });
  }
}
