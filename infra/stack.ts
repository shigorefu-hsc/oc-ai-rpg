import {
  Stack,
  StackProps,
  CfnOutput,
  CfnParameter,
  Duration,
  RemovalPolicy,
  Tags,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamo from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
export class RPGStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    Tags.of(this).add('Project', 'oc-ai-rpg');
    Tags.of(this).add('Environment', 'demo');
    const codeBucket = new CfnParameter(this, 'CodeBucket', { type: 'String' }),
      codeKey = new CfnParameter(this, 'CodeKey', { type: 'String' });
    const monthly = new CfnParameter(this, 'MonthlyBudgetMicroUsd', {
      type: 'Number',
      default: 10000000,
      minValue: 100000,
      maxValue: 100000000,
    });
    const table = (name: string, transient = false) =>
      new dynamo.Table(this, name, {
        partitionKey: { name: 'pk', type: dynamo.AttributeType.STRING },
        sortKey: { name: 'sk', type: dynamo.AttributeType.STRING },
        billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
        encryption: dynamo.TableEncryption.AWS_MANAGED,
        removalPolicy: RemovalPolicy.RETAIN,
        ...(transient ? { timeToLiveAttribute: 'ttl' } : {}),
      });
    const data = table('Works'),
      auth = table('Access', true);
    const assets = new s3.Bucket(this, 'Audio', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
    });
    const pool = new cognito.UserPool(this, 'Teachers', {
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      signInCaseSensitive: false,
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.NONE,
      removalPolicy: RemovalPolicy.RETAIN,
      featurePlan: cognito.FeaturePlan.LITE,
    });
    const client = pool.addClient('WebLogin', {
      generateSecret: false,
      authFlows: { userPassword: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(1),
    });
    const group = new logs.LogGroup(this, 'Logs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const fn = new lambda.Function(this, 'Web', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.X86_64,
      handler: 'index.handler',
      code: lambda.Code.fromBucket(
        s3.Bucket.fromBucketName(this, 'BuildBucket', codeBucket.valueAsString),
        codeKey.valueAsString,
      ),
      memorySize: 512,
      timeout: Duration.seconds(100),
      logGroup: group,
      environment: {
        AUTH_TABLE: auth.tableName,
        DATA_TABLE: data.tableName,
        USER_POOL_ID: pool.userPoolId,
        USER_POOL_CLIENT_ID: client.userPoolClientId,
        ASSET_BUCKET: assets.bucketName,
        MONTHLY_BUDGET_MICRO_USD: monthly.valueAsString,
        SESSION_BUDGET_MICRO_USD: '1000000',
        NODE_OPTIONS: '--enable-source-maps',
      },
    });
    data.grantReadWriteData(fn);
    auth.grantReadWriteData(fn);
    assets.grantRead(fn, 'audio/*');
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          this.formatArn({
            service: 'bedrock',
            account: '',
            resource: 'foundation-model',
            resourceName: 'amazon.nova-lite-v1:0',
          }),
          this.formatArn({
            service: 'bedrock',
            resource: 'inference-profile',
            resourceName: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
          }),
          ...['ap-northeast-1', 'ap-northeast-3'].map((region) =>
            this.formatArn({
              service: 'bedrock',
              region,
              account: '',
              resource: 'foundation-model',
              resourceName: 'anthropic.claude-haiku-4-5-20251001-v1:0',
            }),
          ),
        ],
      }),
    );
    const url = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });
    new CfnOutput(this, 'URL', { value: url.url });
    new CfnOutput(this, 'FunctionName', { value: fn.functionName });
    new CfnOutput(this, 'UserPoolId', { value: pool.userPoolId });
    new CfnOutput(this, 'ClientId', { value: client.userPoolClientId });
    new CfnOutput(this, 'AudioBucket', { value: assets.bucketName });
    new CfnOutput(this, 'DataTable', { value: data.tableName });
    new CfnOutput(this, 'AuthTable', { value: auth.tableName });
    new CfnOutput(this, 'LogGroup', { value: group.logGroupName });
  }
}
