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
    const apiKeyProvider: appsync.AppSyncAuthProvider = {
      authorizationType: appsync.AppSyncAuthorizationType.API_KEY,
    };

    const iamProvider: appsync.AppSyncAuthProvider = {
      authorizationType: appsync.AppSyncAuthorizationType.IAM,
    };

    const eventApi = new appsync.EventApi(this, "SearchEventApi", {
      apiName: "e-gov-search-events",
      authorizationConfig: {
        authProviders: [apiKeyProvider, iamProvider],
        // ブラウザからの接続・サブスクライブはAPI Key
        connectionAuthModeTypes: [appsync.AppSyncAuthorizationType.API_KEY],
        defaultSubscribeAuthModeTypes: [appsync.AppSyncAuthorizationType.API_KEY],
        // Lambda→AppSync へのパブリッシュはIAM
        defaultPublishAuthModeTypes: [appsync.AppSyncAuthorizationType.IAM],
      },
      logConfig: {
        fieldLogLevel: appsync.AppSyncFieldLogLevel.INFO,
        retention: logs.RetentionDays.TWO_WEEKS,
      },
    });

    // チャネル名前空間: /search/* （searchIdごとにチャネルを作る）
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
    const lambdaDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      logRetention: logs.RetentionDays.TWO_WEEKS,
    };

    // ================================
    // Lambda: 探索ワーカー群
    // ================================
    // AppSync HTTP endpoint と API Key を環境変数で渡す
    const appsyncHttpEndpoint = eventApi.httpDns;
    const appsyncRealtimeEndpoint = eventApi.realtimeDns;

    // AI系Lambda（OpenAI呼び出しあり、タイムアウト長め）
    const aiLambdaEnv = {
      OPENAI_SECRET_ARN: openaiSecret.secretArn,
      APPSYNC_HTTP_ENDPOINT: `https://${appsyncHttpEndpoint}/event`,
    };

    const analyzeQueryFn = new lambda.Function(this, "AnalyzeQueryFn", {
      ...lambdaDefaults,
      memorySize: 512,
      timeout: cdk.Duration.minutes(2),
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/analyze-query")),
      environment: aiLambdaEnv,
      description: "Phase 1: クエリ分析",
    });

    const searchLawsFn = new lambda.Function(this, "SearchLawsFn", {
      ...lambdaDefaults,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/search-laws")),
      environment: {
        APPSYNC_HTTP_ENDPOINT: `https://${appsyncHttpEndpoint}/event`,
      },
      description: "Phase 2: 法令検索（並列実行）",
    });

    const selectLawsFn = new lambda.Function(this, "SelectLawsFn", {
      ...lambdaDefaults,
      memorySize: 512,
      timeout: cdk.Duration.minutes(2),
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/select-laws")),
      environment: aiLambdaEnv,
      description: "Phase 3: 関連度判定",
    });

    const readArticlesFn = new lambda.Function(this, "ReadArticlesFn", {
      ...lambdaDefaults,
      memorySize: 512,
      timeout: cdk.Duration.minutes(3),
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/read-articles")),
      environment: aiLambdaEnv,
      description: "Phase 4: 条文深掘り（並列実行）",
    });

    const generateConclusionFn = new lambda.Function(this, "GenerateConclusionFn", {
      ...lambdaDefaults,
      memorySize: 512,
      timeout: cdk.Duration.minutes(3),
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/generate-conclusion")),
      environment: aiLambdaEnv,
      description: "Phase 5: 結論生成",
    });

    // Secrets Manager読み取り権限
    const aiLambdas = [analyzeQueryFn, selectLawsFn, readArticlesFn, generateConclusionFn];
    aiLambdas.forEach((fn) => openaiSecret.grantRead(fn));

    // 全LambdaにAppSync Event APIへのpublish権限（IAM認証）
    const allWorkerLambdas = [analyzeQueryFn, searchLawsFn, selectLawsFn, readArticlesFn, generateConclusionFn];
    allWorkerLambdas.forEach((fn) => {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["appsync:EventPublish"],
          resources: [
            `${eventApi.apiArn}/channelNamespace/search`,
          ],
        })
      );
    });

    // ================================
    // Step Functions: 探索ワークフロー
    // ================================

    // Phase 1: クエリ分析
    const analyzeTask = new tasks.LambdaInvoke(this, "AnalyzeQuery", {
      lambdaFunction: analyzeQueryFn,
      outputPath: "$.Payload",
      comment: "Phase 1: 自然言語クエリを分析してキーワード抽出",
    });

    // Phase 2: 法令名検索（並列）
    const searchByNameMap = new sfn.Map(this, "SearchByNameMap", {
      comment: "Phase 2: 法令検索（並列）",
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

    // 検索結果をフラット化
    const flattenResults = new sfn.Pass(this, "FlattenResults", {
      comment: "検索結果のフラット化",
      parameters: {
        "searchId.$": "$.searchId",
        "query.$": "$.query",
        "searchResults.$": "$.nameResults",
      },
    });

    // Phase 3: 関連度判定
    const selectTask = new tasks.LambdaInvoke(this, "SelectLaws", {
      lambdaFunction: selectLawsFn,
      outputPath: "$.Payload",
      comment: "Phase 3: AIで関連法令を選別",
    });

    // Phase 4: 条文深掘り（並列）
    const readArticlesMap = new sfn.Map(this, "ReadArticlesMap", {
      comment: "Phase 4: 条文深掘り（法令ごとに並列実行）",
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

    // Phase 5: 結論生成
    const conclusionTask = new tasks.LambdaInvoke(this, "GenerateConclusion", {
      lambdaFunction: generateConclusionFn,
      outputPath: "$.Payload",
      comment: "Phase 5: 調査結果を統合して結論生成",
    });

    // ワークフロー定義
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
      comment: "法令探索AI - AppSync Event API + Step Functions",
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
    // API Gateway (REST): 検索開始エンドポイント
    // ================================
    const startSearchFn = new lambda.Function(this, "StartSearchFn", {
      ...lambdaDefaults,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/start-search")),
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

    const searchResource = restApi.root.addResource("search");
    searchResource.addMethod(
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
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.minutes(5),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // 静的アセットデプロイ
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
      description: "法令探索AI - フロントエンドURL",
    });

    new cdk.CfnOutput(this, "RestApiURL", {
      value: restApi.url,
      description: "REST API URL（検索開始）",
    });

    new cdk.CfnOutput(this, "AppSyncHttpEndpoint", {
      value: `https://${appsyncHttpEndpoint}`,
      description: "AppSync Event API - HTTP endpoint",
    });

    new cdk.CfnOutput(this, "AppSyncRealtimeEndpoint", {
      value: `wss://${appsyncRealtimeEndpoint}`,
      description: "AppSync Event API - Realtime (WebSocket) endpoint",
    });

    new cdk.CfnOutput(this, "AppSyncApiKey", {
      value: eventApi.apiKeys?.[0]?.attrApiKey || "Check AppSync Console",
      description: "AppSync API Key",
    });

    new cdk.CfnOutput(this, "StepFunctionsConsole", {
      value: `https://${this.region}.console.aws.amazon.com/states/home?region=${this.region}#/statemachines/view/${stateMachine.stateMachineArn}`,
      description: "Step Functions コンソール",
    });

    new cdk.CfnOutput(this, "OpenAISecretArn", {
      value: openaiSecret.secretArn,
      description: "OpenAI APIキーのSecrets Manager ARN（要手動設定）",
    });
  }
}
