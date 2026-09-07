import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { RPGStack } from './stack';
const app = new App({ outdir: 'cdk.out' });
new RPGStack(app, 'oc-ai-rpg-demo', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID,
    region: process.env.AWS_REGION ?? 'ap-northeast-1',
  },
  synthesizer: new BootstraplessSynthesizer(),
});
app.synth();
