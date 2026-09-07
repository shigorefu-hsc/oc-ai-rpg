import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {
  CloudFormationClient,
  DescribeStacksCommand,
  CreateStackCommand,
  UpdateStackCommand,
} from '@aws-sdk/client-cloudformation';
const d = JSON.parse(await readFile('.local/deployment.json', 'utf8'));
const domain = 'ai-taiken.shigorefu.com';
const certificateArn =
  process.env.DOMAIN_CERTIFICATE_ARN ??
  'arn:aws:acm:ap-northeast-1:997868087180:certificate/20f5a5db-ac15-47f5-a4e5-b8b50aa12a0d';
if (!certificateArn.includes(':' + d.region + ':' + d.account + ':'))
  throw new Error('Certificate account/region mismatch');
const certificate = JSON.parse(
  execFileSync(
    'aws',
    [
      'acm',
      'describe-certificate',
      '--region',
      d.region,
      '--certificate-arn',
      certificateArn,
      '--output',
      'json',
    ],
    { encoding: 'utf8' },
  ),
).Certificate;
if (certificate.DomainName !== domain) throw new Error('Certificate domain mismatch');
await mkdir('.local', { recursive: true });
const info: any = {
  domain,
  certificateArn,
  status: certificate.Status,
  validation: certificate.DomainValidationOptions?.[0]?.ResourceRecord,
};
if (certificate.Status !== 'ISSUED') {
  await writeFile('.local/domain.json', JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));
  console.log(
    'Add the validation CNAME, then run this command again. Existing application remains online.',
  );
  process.exit(0);
}
if (!d.GatewayId) throw new Error('Deploy the Regional API Gateway first');
const cf = new CloudFormationClient({ region: d.region }),
  stack = d.stack + '-domain';
const template = {
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'Regional HTTPS domain for AI classroom; external DNS managed by owner',
  Resources: {
    Domain: {
      Type: 'AWS::ApiGateway::DomainName',
      Properties: {
        DomainName: domain,
        RegionalCertificateArn: certificateArn,
        EndpointConfiguration: { Types: ['REGIONAL'] },
        SecurityPolicy: 'TLS_1_2',
        Tags: [{ Key: 'Project', Value: 'oc-ai-rpg' }],
      },
    },
    Mapping: {
      Type: 'AWS::ApiGateway::BasePathMapping',
      Properties: { DomainName: { Ref: 'Domain' }, RestApiId: d.GatewayId, Stage: 'demo' },
    },
  },
  Outputs: {
    CnameTarget: { Value: { 'Fn::GetAtt': ['Domain', 'RegionalDomainName'] } },
    URL: { Value: 'https://' + domain + '/' },
  },
};
let exists = true;
try {
  await cf.send(new DescribeStacksCommand({ StackName: stack }));
} catch (e) {
  if ((e as Error).message.includes('does not exist')) exists = false;
  else throw e;
}
const args = { StackName: stack, TemplateBody: JSON.stringify(template) };
try {
  if (exists) await cf.send(new UpdateStackCommand(args));
  else await cf.send(new CreateStackCommand({ ...args, EnableTerminationProtection: true }));
} catch (e) {
  if (!(e as Error).message.includes('No updates are to be performed')) throw e;
}
while (true) {
  const s = (await cf.send(new DescribeStacksCommand({ StackName: stack }))).Stacks![0];
  if (['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(s.StackStatus!)) {
    info.status = 'READY_FOR_DNS';
    info.siteRecord = {
      Name: domain,
      Type: 'CNAME',
      Value: s.Outputs!.find((o) => o.OutputKey === 'CnameTarget')!.OutputValue,
    };
    await writeFile('.local/domain.json', JSON.stringify(info, null, 2));
    console.log(JSON.stringify(info, null, 2));
    break;
  }
  if (!s.StackStatus!.endsWith('_IN_PROGRESS'))
    throw new Error('Domain deployment ended: ' + s.StackStatus);
  await new Promise((r) => setTimeout(r, 5000));
}
