import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketEncryptionCommand,
  PutBucketPolicyCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  CloudFormationClient,
  DescribeStacksCommand,
  CreateStackCommand,
  UpdateStackCommand,
} from '@aws-sdk/client-cloudformation';
const region = process.env.AWS_REGION ?? 'ap-northeast-1';
if (region !== 'ap-northeast-1') throw new Error('This demo is configured for Tokyo only.');
const run = (cmd: string, args: string[], cwd?: string) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: 'inherit',
      cwd,
      env: { ...process.env, AWS_REGION: region },
    });
    p.on('error', reject);
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(cmd + ' failed: ' + c))));
  });
const identity = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
if (!identity.Account) throw new Error('AWS account unavailable');
console.log('Deploying isolated RPG stack to account ' + identity.Account + ' in ' + region);
process.env.AWS_ACCOUNT_ID = identity.Account;
process.env.AWS_REGION = region;
await run('npm', ['run', 'check']);
await run('npx', ['tsx', 'infra/app.ts']);
await mkdir('.local', { recursive: true });
await run('python3', [
  '-c',
  "import pathlib,zipfile\nwith zipfile.ZipFile('.local/lambda.zip','w',zipfile.ZIP_DEFLATED) as z:\n for p in pathlib.Path('dist/lambda').rglob('*'):\n  if p.is_file():z.write(p,p.relative_to('dist/lambda'))",
]);
const s3 = new S3Client({ region }),
  cf = new CloudFormationClient({ region });
const bucket = 'oc-ai-rpg-builds-' + identity.Account + '-' + region;
try {
  await s3.send(new HeadBucketCommand({ Bucket: bucket, ExpectedBucketOwner: identity.Account }));
} catch (e) {
  if ((e as { $metadata?: { httpStatusCode: number } }).$metadata?.httpStatusCode !== 404) throw e;
  await s3.send(
    new CreateBucketCommand({
      Bucket: bucket,
      CreateBucketConfiguration: { LocationConstraint: 'ap-northeast-1' },
    }),
  );
}
await s3.send(
  new PutPublicAccessBlockCommand({
    Bucket: bucket,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true,
    },
  }),
);
await s3.send(
  new PutBucketEncryptionCommand({
    Bucket: bucket,
    ServerSideEncryptionConfiguration: {
      Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
    },
  }),
);
await s3.send(
  new PutBucketPolicyCommand({
    Bucket: bucket,
    Policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Deny',
          Principal: '*',
          Action: 's3:*',
          Resource: ['arn:aws:s3:::' + bucket, 'arn:aws:s3:::' + bucket + '/*'],
          Condition: { Bool: { 'aws:SecureTransport': 'false' } },
        },
      ],
    }),
  }),
);
await s3.send(
  new PutBucketLifecycleConfigurationCommand({
    Bucket: bucket,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: 'Old-builds',
          Status: 'Enabled',
          Filter: { Prefix: 'builds/' },
          Expiration: { Days: 90 },
        },
      ],
    },
  }),
);
const zip = await readFile('.local/lambda.zip'),
  key = 'builds/' + createHash('sha256').update(zip).digest('hex') + '.zip';
await s3.send(
  new PutObjectCommand({ Bucket: bucket, Key: key, Body: zip, ContentType: 'application/zip' }),
);
const stack = 'oc-ai-rpg-demo';
let exists = true;
try {
  await cf.send(new DescribeStacksCommand({ StackName: stack }));
} catch (e) {
  if ((e as Error).message.includes('does not exist')) exists = false;
  else throw e;
}
const input = {
  StackName: stack,
  TemplateBody: await readFile('cdk.out/oc-ai-rpg-demo.template.json', 'utf8'),
  Capabilities: ['CAPABILITY_IAM' as const],
  Parameters: [
    { ParameterKey: 'CodeBucket', ParameterValue: bucket },
    { ParameterKey: 'CodeKey', ParameterValue: key },
    {
      ParameterKey: 'MonthlyBudgetMicroUsd',
      ...(exists ? { UsePreviousValue: true } : { ParameterValue: '10000000' }),
    },
  ],
};
let unchanged = false;
if (exists) {
  try {
    await cf.send(new UpdateStackCommand(input));
  } catch (e) {
    if ((e as Error).message.includes('No updates are to be performed')) unchanged = true;
    else throw e;
  }
} else await cf.send(new CreateStackCommand({ ...input, EnableTerminationProtection: true }));
if (!unchanged) {
  let previous = '';
  while (true) {
    const s = (await cf.send(new DescribeStacksCommand({ StackName: stack }))).Stacks![0],
      state = s.StackStatus!;
    if (state !== previous) {
      console.log('CloudFormation: ' + state);
      previous = state;
    }
    if (['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(state)) break;
    if (!state.endsWith('_IN_PROGRESS')) throw new Error('Deployment ended: ' + state);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
const state = (await cf.send(new DescribeStacksCommand({ StackName: stack }))).Stacks![0];
const outputs = Object.fromEntries(state.Outputs!.map((x) => [x.OutputKey!, x.OutputValue!]));
for (const f of ['intro.mp3', 'level.mp3', 'mumble.wav'])
  await s3.send(
    new PutObjectCommand({
      Bucket: outputs.AudioBucket,
      Key: 'audio/' + f,
      Body: await readFile('source/' + f),
      ContentType: f.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav',
    }),
  );
await writeFile(
  '.local/deployment.json',
  JSON.stringify(
    { account: identity.Account, region, stack, buildBucket: bucket, ...outputs },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log('Application deployed: ' + outputs.URL);
