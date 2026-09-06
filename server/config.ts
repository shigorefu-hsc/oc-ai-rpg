import type { Config } from './app';
export function config(local = false): Config {
  return {
    local,
    userPoolId: process.env.USER_POOL_ID ?? '',
    clientId: process.env.USER_POOL_CLIENT_ID ?? '',
    assetBucket: process.env.ASSET_BUCKET ?? '',
    monthlyBudgetMicroUsd: Number(process.env.MONTHLY_BUDGET_MICRO_USD ?? 10000000),
    sessionBudgetMicroUsd: Number(process.env.SESSION_BUDGET_MICRO_USD ?? 1000000),
    maxCalls: 60,
    sessionMs: 3600000,
    modelIds: {
      nova: 'amazon.nova-lite-v1:0',
      haiku: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
    },
  };
}
