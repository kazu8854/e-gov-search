import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2_integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
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
    // DynamoDB: WebSocket接続管理
    // ================================
    const connectionsTable = new dynamodb.Table(this, "ConnectionsTable", {
      partitionKey: { name: "connectionId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

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
      bundling: {
        // shared ディレクトリを含める
      },
    };

    const sharedLayer = new lambda.LayerVersion(this, "SharedLayer", {
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/shared")),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: "e-Gov API, OpenAI client, WebSocket notify utilities",
    });

    // ================================
    // WebSocket API Gateway
    // ================================
    const webSocketApi = new apigatewayv2.WebSocketApi(this, "SearchWebSocket", {
      apiName: "e-gov-search-ws",
      description: "法令探索AI WebSocket API",
    });

    const webSocketStage = new apigatewayv2.WebSocketStage(this, "WebSocketStage", {
      webSocketApi,
      stageName: "prod",
      autoDeploy: true,
    });

    // WebSocket endpoint for Management API
    const wsEndpoint = `https://${webSocketApi.apiId}.execute-api.${this.region}.amazonaws.com/${webSocketStage.stageName}`;

    // ================================
    // Lambda: WebSocket接続管理
    // ================================
    const connectFn = new lambda.Function(this, "ConnectFn", {
      ...lambdaDefaults,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/connect")),
      environment: {
        CONNECTIONS_TABLE: connectionsTable.tableName,
      },
      description: "WebSocket $connect handler",
    });
    connectionsTable.grantWriteData(connectFn);

    const disconnectFn = new lambda.Function(this, "DisconnectFn", {
      ...lambdaDefaults,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/disconnect")),
      environment: {
        CONNECTIONS_TABLE: connectionsTable.tableName,
      },
      description: "WebSocket $disconnect handler",
    });
    connectionsTable.grantWriteData(disconnectFn);

    // ================================
    // Lambda: 探索ワーカー群
    // ================================

    // AI系Lambda（OpenAI呼び出しあり、タイムアウト長め）
    const aiLambdaDefaults = {
      ...lambdaDefaults,
      memorySize: 512,
      timeout: cdk.Duration.minutes(2),
      layers: [sharedLayer],
      environment: {
        OPENAI_SECRET_ARN: openaiSecret.secretArn,
        WEBSOCKET_ENDPOINT: wsEndpoint,
      },
    };

    const analyzeQueryFn = new lambda.Function(this, "AnalyzeQueryFn", {
      ...aiLambdaDefaults,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/analyze-query")),
      description: "Phase 1: クエリ分析",
    });

    const searchLawsFn = new lambda.Function(this, "SearchLawsFn", {
      ...lambdaDefaults,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      layers: [sharedLayer],
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/search-laws")),
      environment: {
        WEBSOCKET_ENDPOINT: wsEndpoint,
      },
      description: "Phase 2: 法令検索（並列実行）",
    });

    const selectLawsFn = new lambda.Function(this, "SelectLawsFn", {
      ...aiLambdaDefaults,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/select-laws")),
      description: "Phase 3: 関連度判定",
    });

    const readArticlesFn = new lambda.Function(this, "ReadArticlesFn", {
      ...aiLambdaDefaults,
      timeout: cdk.Duration.minutes(3),
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/read-articles")),
      description: "Phase 4: 条文深掘り（並列実行）",
    });

    const generateConclusionFn = new lambda.Function(this, "GenerateConclusionFn", {
      ...aiLambdaDefaults,
      timeout: cdk.Duration.minutes(3),
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/generate-conclusion")),
      description: "Phase 5: 結論生成",
    });

    // Secrets Manager読み取り権限
    [analyzeQueryFn, selectLawsFn, readArticlesFn, generateConclusionFn].forEach((fn) => {
      openaiSecret.grantRead(fn);
    });

    // WebSocket Management API 送信権限
    const wsManagePolicy = new iam.PolicyStatement({
      actions: ["execute-api:ManageConnections"],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${webSocketStage.stageName}/POST/@connections/*`,
      ],
    });
    [analyzeQueryFn, searchLawsFn, selectLawsFn, readArticlesFn, generateConclusionFn].forEach((fn) => {
      fn.addToRolePolicy(wsManagePolicy);
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

    // Phase 2: 法令検索（並列）— 検索入力を準備
    const prepareSearchInputs = new sfn.Pass(this, "PrepareSearchInputs", {
      comment: "検索入力の準備",
      parameters: {
        "connectionId.$": "$.connectionId",
        "query.$": "$.query",
        "searchItems.$": "States.Array($.analysis.keywords, $.analysis.searchTerms)",
        "analysis.$": "$.analysis",
      },
    });

    // キーワード検索Map
    const searchByNameMap = new sfn.Map(this, "SearchByNameMap", {
      comment: "Phase 2a: 法令名検索（並列）",
      maxConcurrency: 5,
      itemsPath: "$.analysis.keywords",
      parameters: {
        "connectionId.$": "$.connectionId",
        "keyword.$": "$.Map.Item.Value",
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

    // 横断検索Map
    const searchByKeywordMap = new sfn.Map(this, "SearchByKeywordMap", {
      comment: "Phase 2b: 条文横断検索（並列）",
      maxConcurrency: 3,
      itemsPath: "$.analysis.searchTerms",
      parameters: {
        "connectionId.$": "$.connectionId",
        "keyword.$": "$.Map.Item.Value",
        "searchType": "keyword",
      },
      resultPath: "$.keywordResults",
    });
    searchByKeywordMap.itemProcessor(
      new tasks.LambdaInvoke(this, "SearchLawsByKeyword", {
        lambdaFunction: searchLawsFn,
        outputPath: "$.Payload",
      })
    );

    // 検索結果を結合
    const mergeSearchResults = new sfn.Pass(this, "MergeSearchResults", {
      comment: "検索結果の結合",
      parameters: {
        "connectionId.$": "$.connectionId",
        "query.$": "$.query",
        "searchResults.$": "States.ArrayPartition(States.Array($.nameResults, $.keywordResults), 100)",
      },
    });

    // 検索結果をフラット化するPass
    const flattenResults = new sfn.Pass(this, "FlattenResults", {
      comment: "検索結果のフラット化",
      parameters: {
        "connectionId.$": "$.connectionId",
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
        "connectionId.$": "$.connectionId",
        "query.$": "$.query",
        "law.$": "$.Map.Item.Value",
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
      comment: "法令探索AI - イベントドリブン探索ワークフロー",
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
    // Lambda: 検索開始（WebSocketメッセージ受信）
    // ================================
    const startSearchFn = new lambda.Function(this, "StartSearchFn", {
      ...lambdaDefaults,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/start-search")),
      environment: {
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
      },
      description: "WebSocket search message → Step Functions開始",
    });
    stateMachine.grantStartExecution(startSearchFn);

    // ================================
    // WebSocket Routes
    // ================================
    webSocketApi.addRoute("$connect", {
      integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
        "ConnectIntegration",
        connectFn
      ),
    });

    webSocketApi.addRoute("$disconnect", {
      integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
        "DisconnectIntegration",
        disconnectFn
      ),
    });

    webSocketApi.addRoute("search", {
      integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
        "SearchIntegration",
        startSearchFn
      ),
    });

    // $default route (fallback)
    webSocketApi.addRoute("$default", {
      integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
        "DefaultIntegration",
        startSearchFn
      ),
    });

    // ================================
    // CloudFront Distribution（静的フロントのみ）
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

    new cdk.CfnOutput(this, "WebSocketURL", {
      value: webSocketStage.url,
      description: "WebSocket API URL",
    });

    new cdk.CfnOutput(this, "StepFunctionsConsole", {
      value: `https://${this.region}.console.aws.amazon.com/states/home?region=${this.region}#/statemachines/view/${stateMachine.stateMachineArn}`,
      description: "Step Functions コンソール（探索ワークフロー可視化）",
    });

    new cdk.CfnOutput(this, "OpenAISecretArn", {
      value: openaiSecret.secretArn,
      description: "OpenAI APIキーのSecrets Manager ARN（要手動設定）",
    });
  }
}

