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
  base = d.URL.replace(/\/$/, '');
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
    headers: { origin: base, cookie, 'content-type': 'application/json', 'x-csrf-token': csrf },
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
try {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('ことばの街'));
  for (const asset of [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))
    assert.equal((await fetch(base + asset)).status, 200);
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
  let result = await chat('臆病だけどやさしい商人にして。人が近づくと距離をとる。');
  console.log(
    JSON.stringify({
      reply: result.turn.reply,
      changed: result.turn.changed,
      behavior: result.work.npcs[0].behavior,
      model: result.turn.model,
    }),
  );
  assert.equal(result.work.npcs[0].behavior, 'avoid');
  assert.equal(result.turn.model, 'nova');
  console.log(JSON.stringify({ check: 'Nova edit persisted', ...result.turn.usage }));
  await json('/works/' + workId + '/model', 'PATCH', { model: 'haiku' });
  result = await chat('親切な商人にして。主人公についてくる。');
  assert.equal(result.work.npcs[0].behavior, 'follow');
  assert.equal(result.turn.model, 'haiku');
  console.log(JSON.stringify({ check: 'Haiku edit persisted', ...result.turn.usage }));
  result = await chat('私の名前はソラです。よろしく。', 'talk');
  assert.equal(result.turn.changed, false);
  assert.ok(result.work.npcs[0].memory);
  assert.equal(result.work.npcs[0].behavior, 'follow');
  const audio = await json('/assets');
  assert.equal((await fetch(audio.level, { headers: { range: 'bytes=0-10' } })).status, 206);
  const oldCookie = cookie;
  await json('/works/' + workId + '/start', 'POST', {});
  assert.equal((await json('/bootstrap')).mode, 'demo');
  assert.equal((await call('/settings', 'PATCH', { model: 'nova', aiEnabled: true })).status, 403);
  const old = await fetch(base + '/api/bootstrap', { headers: { cookie: oldCookie } });
  assert.equal((await old.json()).mode, 'login');
  await json('/works/' + workId + '/end', 'POST', {});
  assert.equal((await call('/works/' + workId)).status, 401);
  await json('/login', 'POST', { username, password: permanent });
  await json('/bootstrap');
  const saved = await json('/works/' + workId);
  assert.equal(saved.work.npcs[0].behavior, 'follow');
  await json('/logout', 'POST', {});
  console.log(
    'PASS: HTTPS, assets, Cognito first-password login, both models, memory, audio, handover, access restrictions, end-session persistence.',
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
