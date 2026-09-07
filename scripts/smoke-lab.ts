import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
const d = JSON.parse(await readFile('.local/deployment.json', 'utf8')),
  base = (process.env.SMOKE_URL ?? d.GatewayURL ?? d.URL).replace(/\/$/, '');
const cognito = new CognitoIdentityProviderClient({ region: d.region }),
  db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: d.region }));
const username = 'smoke-' + randomBytes(6).toString('hex'),
  password = randomBytes(18).toString('base64url') + 'aA1!',
  permanent = randomBytes(18).toString('base64url') + 'bB2!';
let cookie = '',
  csrf = '',
  owner = '',
  workId = '';
const sessionTokens = new Set<string>();
async function call(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(base + '/api' + path, {
    method,
    headers: {
      origin: new URL(base).origin,
      cookie,
      'content-type': 'application/json',
      'x-csrf-token': csrf,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const c = r.headers.get('set-cookie');
  if (c) {
    cookie = c.split(';')[0];
    const token = cookie.split('=')[1];
    if (token) sessionTokens.add(token);
  }
  return r;
}
async function json(path: string, method = 'GET', body?: unknown) {
  const r = await call(path, method, body);
  const v = await r.json();
  assert.ok(r.ok, JSON.stringify(v));
  if (v.csrf) csrf = v.csrf;
  return v;
}
async function chat(text: string, mode: 'edit' | 'talk' = 'edit') {
  const r = await call('/works/' + workId + '/chat', 'POST', {
    requestId: crypto.randomUUID(),
    target: 'seller',
    mode,
    text,
  });
  const raw = await r.text();
  assert.equal(r.status, 200, raw);
  const done = raw.split('\n\n').find((f) => f.startsWith('event: done\n'));
  assert.ok(done, raw);
  return JSON.parse(done.split('\ndata: ')[1]);
}
async function deletePartition(table: string, pk: string) {
  let cursor: Record<string, unknown> | undefined;
  do {
    const r = await db.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'pk = :p',
        ExpressionAttributeValues: { ':p': pk },
        ExclusiveStartKey: cursor,
        ProjectionExpression: 'pk, sk',
      }),
    );
    for (let i = 0; i < (r.Items ?? []).length; i += 25) {
      let pending = (r.Items ?? []).slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
      while (pending.length) {
        const b = await db.send(new BatchWriteCommand({ RequestItems: { [table]: pending } }));
        pending = (b.UnprocessedItems?.[table] ?? []) as typeof pending;
        if (pending.length) await new Promise((r) => setTimeout(r, 200));
      }
    }
    cursor = r.LastEvaluatedKey;
  } while (cursor);
}

const defaultConfig = {
  mode: 'agent',
  model: 'nova',
  scenario: 'original',
  prompt:
    '落とし物の鍵を探して、持ち主に返してください。住人の話と観察の結果を確かめ、見つからなければ別の場所を調べてください。',
  memory: true,
  tools: ['look', 'move', 'ask', 'take', 'give', 'finish'],
  prediction: '実際のモデル検証',
};
async function step(
  run: any,
  input: { runId: string; requestId: string; text?: string } = {
    runId: run.id,
    requestId: crypto.randomUUID(),
  },
): Promise<any> {
  const response = await call('/works/' + workId + '/lab-step', 'POST', input);
  const raw = await response.text();
  assert.equal(response.status, 200, raw);
  assert.ok(response.headers.get('content-type')?.includes('text/event-stream'));
  const frame = raw.split('\n\n').find((f) => f.startsWith('event: done\n'));
  assert.ok(frame, raw);
  return JSON.parse(frame.split('\ndata: ')[1]);
}

try {
  for (const entry of [base, d.URL.replace(/\/$/, '')]) {
    const response = await fetch(entry + '/');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes('AIたいけん'));
    for (const match of html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)) {
      assert.equal((await fetch(new URL(match[1], entry + '/'))).status, 200);
    }
    if (entry.includes('execute-api')) assert.ok(html.includes('<base href="/demo/">'));
  }
  const created = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: d.UserPoolId,
      Username: username,
      TemporaryPassword: password,
      MessageAction: 'SUPPRESS',
    }),
  );
  owner = created.User!.Attributes!.find((a) => a.Name === 'sub')!.Value!;
  const challenge = await json('/login', 'POST', { username, password });
  assert.ok(challenge.challengeId);
  await json('/login', 'POST', {
    username,
    password,
    newPassword: permanent,
    challengeId: challenge.challengeId,
  });
  assert.ok(cookie.startsWith('__Host-rpg='));
  assert.equal((await json('/bootstrap')).mode, 'teacher');
  const w = await json('/works', 'POST', { title: 'Automated deployment check', model: 'nova' });
  workId = w.work.id;

  for (const scenario of ['original', 'moved'] as const) {
    let run = (
      await json('/works/' + workId + '/lab-start', 'POST', {
        ...defaultConfig,
        mode: 'program',
        scenario,
      })
    ).run;
    while (run.status === 'running') run = (await step(run)).run;
    assert.equal(run.world.delivered, scenario === 'original');
    assert.equal(run.usage.calls, 0);
    console.log(
      JSON.stringify({
        check: 'fixed program',
        scenario,
        status: run.status,
        steps: run.steps.length,
      }),
    );
  }
  for (const model of ['nova', 'haiku'] as const) {
    let run = (
      await json('/works/' + workId + '/lab-start', 'POST', {
        ...defaultConfig,
        mode: 'agent',
        model,
        scenario: 'moved',
      })
    ).run;
    let first = true;
    while (run.status === 'running') {
      const input: { runId: string; requestId: string; text?: string } = {
        runId: run.id,
        requestId: crypto.randomUUID(),
      };
      const result = await step(run, input);
      run = result.run;
      console.log(
        JSON.stringify({
          model,
          step: run.steps.length,
          action: run.steps.at(-1).action,
          result: run.steps.at(-1).result,
        }),
      );
      if (first) {
        const duplicate = await step(run, input);
        assert.equal(duplicate.work.attempts, result.work.attempts);
        first = false;
      }
    }
    assert.ok(run.usage.calls > 0);
    assert.ok(run.usage.inputTokens > 0);
    assert.equal(run.usage.unknownCalls, 0);
    assert.equal(
      run.steps[0].modelId,
      model === 'nova' ? 'amazon.nova-lite-v1:0' : 'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
    );
    console.log(
      JSON.stringify({
        check: 'real agent complete',
        model,
        status: run.status,
        steps: run.steps.length,
        usage: run.usage,
      }),
    );
    if (run.status !== 'success')
      console.warn(
        'Model did not finish within the action limit; valid game outcome, inspect action log.',
      );
  }
  let run = (
    await json('/works/' + workId + '/lab-start', 'POST', { ...defaultConfig, mode: 'chat' })
  ).run;
  const originalWorld = run.world;
  run = (
    await step(run, {
      runId: run.id,
      requestId: crypto.randomUUID(),
      text: '最初に何をすればよいですか？',
    })
  ).run;
  assert.deepEqual(run.world, originalWorld);
  assert.equal(run.steps[0].action, null);
  await json('/works/' + workId + '/lab-reflection', 'POST', {
    runId: run.id,
    reflection: 'チャットは相談、エージェントは道具を実行する。',
  });
  const invite = await json('/works/' + workId + '/invite', 'POST', {});
  assert.equal(new URL(invite.url).pathname, new URL(base + '/').pathname);
  const oldCookie = cookie;
  await json('/works/' + workId + '/start', 'POST', {});
  assert.equal((await json('/bootstrap')).mode, 'demo');
  assert.equal((await call('/settings', 'PATCH', { model: 'haiku', aiEnabled: true })).status, 403);
  const old = await fetch(base + '/api/bootstrap', { headers: { cookie: oldCookie } });
  assert.equal((await old.json()).mode, 'login');
  assert.equal((await json('/works/' + workId + '/lab-runs')).runs.length, 5);
  await json('/works/' + workId + '/end', 'POST', {});
  assert.equal((await call('/works/' + workId + '/lab-runs')).status, 401);
  await json('/login', 'POST', { username, password: permanent });
  await json('/bootstrap');
  const saved = await json('/works/' + workId + '/lab-runs');
  assert.equal(saved.runs.length, 5);
  assert.ok(saved.runs.some((r: any) => r.reflection));
  await json('/logout', 'POST', {});
  console.log(
    'PASS: HTTPS/streaming, root and stage assets, Cognito login, fixed-world experiments, actual Nova/Haiku agent actions, chat-only mode, billing/idempotency, invites, handover, expiry authorization and archived reflections.',
  );
} finally {
  if (workId) await deletePartition(d.DataTable, 'WORK#' + workId);
  if (owner) await deletePartition(d.DataTable, 'TEACHER#' + owner);
  for (const token of sessionTokens)
    await deletePartition(
      d.AuthTable,
      'SESSION#' + createHash('sha256').update(token).digest('hex'),
    );
  if (owner)
    await cognito
      .send(new AdminDeleteUserCommand({ UserPoolId: d.UserPoolId, Username: username }))
      .catch(() => {});
  console.log(
    'Removed only the temporary smoke-test account and its work. Monthly AI accounting retained.',
  );
}
