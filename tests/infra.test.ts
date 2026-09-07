import test from 'node:test';
import assert from 'node:assert/strict';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { RPGStack } from '../infra/stack';
test('stack has Regional streaming gateway without CDN, VPC or always-on compute and separates data from expiring access', () => {
  const stack = new RPGStack(new App(), 'TestRPG', {
    env: { account: '111111111111', region: 'ap-northeast-1' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const t = Template.fromStack(stack);
  for (const type of [
    'AWS::CloudFront::Distribution',
    'AWS::ApiGatewayV2::Api',
    'AWS::EC2::VPC',
    'AWS::ECS::Service',
    'AWS::RDS::DBInstance',
  ])
    t.resourceCountIs(type, 0);
  t.resourceCountIs('AWS::ApiGateway::RestApi', 1);
  t.hasResourceProperties('AWS::ApiGateway::RestApi', {
    EndpointConfiguration: { Types: ['REGIONAL'] },
  });
  t.hasResourceProperties('AWS::ApiGateway::Method', {
    Integration: Match.objectLike({ ResponseTransferMode: 'STREAM', TimeoutInMillis: 90000 }),
  });
  t.resourceCountIs('AWS::DynamoDB::Table', 2);
  t.hasResourceProperties('AWS::DynamoDB::Table', {
    TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
  });
  const tables = Object.values(t.findResources('AWS::DynamoDB::Table')) as any[];
  assert.equal(tables.filter((v) => v.Properties.TimeToLiveSpecification).length, 1);
  assert.ok(tables.every((v) => v.DeletionPolicy === 'Retain'));
  t.hasResourceProperties('AWS::Cognito::UserPool', {
    AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    UserPoolTier: 'LITE',
  });
  t.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'NONE', InvokeMode: 'RESPONSE_STREAM' });
  t.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'nodejs22.x',
    MemorySize: 512,
    Timeout: 100,
  });
  const policies = Object.values(t.findResources('AWS::IAM::Policy')) as any[];
  const bedrock = policies
    .flatMap((p) => p.Properties.PolicyDocument.Statement)
    .find((p) => JSON.stringify(p.Action).includes('bedrock:'));
  assert.ok(bedrock);
  assert.ok(!JSON.stringify(bedrock.Resource).includes('foundation-model/*'));
  t.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: Match.objectLike({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
    }),
  });
});
