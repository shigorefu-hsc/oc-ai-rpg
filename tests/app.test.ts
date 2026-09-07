import test from 'node:test';
import assert from 'node:assert/strict';
import { App, Config } from '../server/app';
import { MemoryStore } from '../server/store';
import { LocalAI, Generated, Prepared } from '../server/bedrock';
import { config } from '../server/config';
import { Work } from '../shared/domain';
import { hash } from '../server/auth';
const origin = 'http://test.local';
class Client {
  cookie = '';
  csrf = '';
  constructor(readonly app: App) {}
  async call(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
    const r = await this.app.handle(
      new Request(origin + '/api' + path, {
        method,
        headers: {
          origin,
          cookie: this.cookie,
          'content-type': 'application/json',
          'x-csrf-token': this.csrf,
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    if (r.headers.has('set-cookie')) this.cookie = r.headers.get('set-cookie')!.split(';')[0];
    return r;
  }
  async json(path: string, method = 'GET', body?: unknown) {
    const r = await this.call(path, method, body);
    const b = await r.json();
    assert.ok(r.ok, JSON.stringify(b));
    if (b.csrf) this.csrf = b.csrf;
    return b;
  }
  async login() {
    await this.json('/login', 'POST', { username: 'teacher', password: 'local-demo-only' });
    await this.json('/bootstrap');
  }
  async create(model = 'nova') {
    return (await this.json('/works', 'POST', { title: 'Test classroom', model })).work;
  }
}
const message = (text = '臆病で人から離れる', mode = 'edit', target = 'seller') => ({
  requestId: crypto.randomUUID(),
  text,
  mode,
  target,
});
async function events(r: Response) {
  const text = await r.text();
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => ({
      event: frame.match(/^event: (.+)/m)![1],
      data: JSON.parse(frame.match(/^data: (.+)/m)![1]),
    }));
}
const completed = async (r: Response) => {
  const e = await events(r);
  const done = e.find((x) => x.event === 'done');
  assert.ok(done, JSON.stringify(e));
  return done.data;
};
function fixture(ai: LocalAI = new LocalAI(), options: Partial<Config> = {}) {
  let time = Date.now();
  const store = new MemoryStore(),
    app = new App(store, ai, { ...config(true), ...options }, () => time),
    teacher = new Client(app);
  return {
    store,
    app,
    teacher,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
test('handover revokes teacher cookie, restricts student, expires without deleting work or history', async () => {
  const f = fixture();
  await f.teacher.login();
  const w = await f.teacher.create();
  const other = await f.teacher.create();
  const old = new Client(f.app);
  old.cookie = f.teacher.cookie;
  old.csrf = f.teacher.csrf;
  await f.teacher.json('/works/' + w.id + '/start', 'POST', {});
  const b = await f.teacher.json('/bootstrap');
  assert.equal(b.mode, 'demo');
  assert.equal((await old.json('/bootstrap')).mode, 'login');
  assert.equal(
    (await f.teacher.call('/settings', 'PATCH', { model: 'haiku', aiEnabled: true })).status,
    403,
  );
  assert.equal((await f.teacher.call('/works/' + other.id)).status, 401);
  assert.equal(
    (await f.teacher.call('/works/' + w.id + '/model', 'PATCH', { model: 'haiku' })).status,
    403,
  );
  const result = await completed(
    await f.teacher.call('/works/' + w.id + '/chat', 'POST', message()),
  );
  assert.equal(result.work.npcs[0].behavior, 'avoid');
  f.advance(3600000);
  assert.equal((await f.teacher.call('/works/' + w.id)).status, 401);
  const saved = await f.store.get<Work>('data', 'WORK#' + w.id);
  assert.equal(saved!.data.npcs[0].behavior, 'avoid');
  assert.equal(saved!.ttl, undefined);
  const turns = await f.store.query('data', 'WORK#' + w.id, 'TURN#');
  assert.equal(turns.items.length, 1);
  await old.login();
  assert.equal((await old.json('/works/' + w.id)).work.npcs[0].behavior, 'avoid');
});
test('invite is one-use and starts the hour when redeemed', async () => {
  const f = fixture();
  await f.teacher.login();
  const w = await f.teacher.create();
  const invite = await f.teacher.json('/works/' + w.id + '/invite', 'POST', {});
  const token = new URL(invite.url).hash.slice(6);
  f.advance(1200000);
  const student = new Client(f.app);
  await student.json('/join', 'POST', { token });
  const boot = await student.json('/bootstrap');
  assert.equal(boot.mode, 'demo');
  assert.equal(boot.expiresAt, boot.work.expiresAt);
  assert.equal((await new Client(f.app).call('/join', 'POST', { token })).status, 410);
  assert.equal((await f.teacher.json('/bootstrap')).mode, 'teacher');
  f.advance(2400001);
  assert.equal((await student.call('/works/' + w.id)).status, 200);
  f.advance(1200000);
  assert.equal((await student.call('/works/' + w.id)).status, 401);
});
test('model selection is retained per turn and repeated request IDs do not generate twice', async () => {
  const f = fixture();
  await f.teacher.login();
  const w = await f.teacher.create('nova');
  const input = message();
  const first = await completed(await f.teacher.call('/works/' + w.id + '/chat', 'POST', input));
  const duplicate = await completed(
    await f.teacher.call('/works/' + w.id + '/chat', 'POST', input),
  );
  assert.equal(first.turn.requestId, duplicate.turn.requestId);
  assert.equal(duplicate.work.attempts, 1);
  assert.equal(
    (await f.teacher.call('/works/' + w.id + '/chat', 'POST', { ...input, text: 'different' }))
      .status,
    409,
  );
  await f.teacher.json('/works/' + w.id + '/model', 'PATCH', { model: 'haiku' });
  const second = await completed(
    await f.teacher.call('/works/' + w.id + '/chat', 'POST', message('友好的')),
  );
  assert.equal(second.turn.model, 'haiku');
  assert.equal(second.turn.modelId, 'local-fixture-haiku');
  assert.equal(second.work.usage.nova.calls, 1);
  assert.equal(second.work.usage.haiku.calls, 1);
});
test('talk changes memory only and undo restores the preceding valid profile', async () => {
  const f = fixture();
  await f.teacher.login();
  const w = await f.teacher.create();
  await completed(await f.teacher.call('/works/' + w.id + '/chat', 'POST', message()));
  const talk = await completed(
    await f.teacher.call('/works/' + w.id + '/chat', 'POST', message('私は空が好き', 'talk')),
  );
  assert.equal(talk.work.npcs[0].behavior, 'avoid');
  assert.equal(talk.work.npcs[0].memory, '私は空が好き');
  assert.deepEqual(talk.work.talked, ['seller']);
  const undo = await f.teacher.json('/works/' + w.id + '/undo', 'POST', { target: 'seller' });
  assert.equal(undo.work.npcs[0].behavior, 'wander');
  assert.equal(undo.work.npcs[0].memory, '私は空が好き');
  assert.equal(undo.work.npcs[0].version, 2);
});
class BadAI extends LocalAI {
  calls = 0;
  override async generate(p: Prepared): Promise<Generated> {
    this.calls++;
    return {
      raw: JSON.stringify({
        reply: 'unsafe edit',
        update: { ownerId: 'attacker', speed: 99999 },
        emotion: 'happy',
        memory: '',
      }),
      inputTokens: 100,
      outputTokens: 20,
      modelId: p.modelId,
      stopReason: 'end_turn',
    };
  }
}
test('invalid model output has exactly one retry, is billed, never overwrites NPC', async () => {
  const ai = new BadAI(),
    f = fixture(ai);
  await f.teacher.login();
  const w = await f.teacher.create();
  const e = await events(await f.teacher.call('/works/' + w.id + '/chat', 'POST', message()));
  assert.equal(e.at(-1)!.data.code, 'INVALID_OUTPUT');
  assert.equal(ai.calls, 2);
  const saved = (await f.teacher.json('/works/' + w.id)).work;
  assert.deepEqual(saved.npcs, w.npcs);
  assert.equal(saved.usage.nova.calls, 2);
  assert.equal(saved.usage.nova.inputTokens, 200);
  assert.equal(saved.busy, false);
});
test('CSRF, cross-origin writes, paused AI and input model injection are rejected', async () => {
  const f = fixture();
  await f.teacher.login();
  const w = await f.teacher.create();
  assert.equal(
    (
      await f.teacher.call(
        '/works',
        'POST',
        { title: 'x', model: 'nova' },
        { origin: 'https://evil.example' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.teacher.call(
        '/works',
        'POST',
        { title: 'x', model: 'nova' },
        { 'x-csrf-token': 'wrong' },
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.teacher.call('/works/' + w.id + '/chat', 'POST', { ...message(), model: 'haiku' }))
      .status,
    400,
  );
  await f.teacher.json('/settings', 'PATCH', { model: 'nova', aiEnabled: false });
  assert.equal((await f.teacher.call('/works/' + w.id + '/chat', 'POST', message())).status, 403);
});
test('per-session call limit includes invalid retries', async () => {
  const ai = new BadAI(),
    f = fixture(ai, { maxCalls: 1 });
  await f.teacher.login();
  const w = await f.teacher.create();
  const e = await events(await f.teacher.call('/works/' + w.id + '/chat', 'POST', message()));
  assert.equal(e.at(-1)!.data.code, 'CALL_LIMIT');
  assert.equal(ai.calls, 1);
});
class GateAI extends LocalAI {
  entered!: () => void;
  release!: () => void;
  started = new Promise<void>((r) => {
    this.entered = r;
  });
  gate = new Promise<void>((r) => {
    this.release = r;
  });
  override prepare(...args: Parameters<LocalAI['prepare']>) {
    return { ...super.prepare(...args), reservationMicroUsd: 100000 };
  }
  override async generate(p: Prepared, signal: AbortSignal, onDelta: (s: string) => void) {
    this.entered();
    await this.gate;
    return super.generate(p, signal, onDelta);
  }
}
test('simultaneous works cannot exceed the shared reserved budget; same work is locked', async () => {
  const ai = new GateAI(),
    f = fixture(ai, { monthlyBudgetMicroUsd: 150000 });
  await f.teacher.login();
  const a = await f.teacher.create(),
    b = await f.teacher.create();
  const running = await f.teacher.call('/works/' + a.id + '/chat', 'POST', message());
  await ai.started;
  assert.equal((await f.teacher.call('/works/' + a.id + '/chat', 'POST', message())).status, 409);
  const denied = await events(await f.teacher.call('/works/' + b.id + '/chat', 'POST', message()));
  assert.equal(denied.at(-1)!.data.code, 'MONTHLY_BUDGET');
  ai.release();
  await completed(running);
  const budget = await f.store.get<{ reserved: number; spent: number }>(
    'data',
    'BUDGET#' + new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7),
  );
  assert.equal(budget!.data.reserved, 0);
  assert.equal(budget!.data.spent, 0);
});
test('session ending during generation prevents a late profile write', async () => {
  const ai = new GateAI(),
    f = fixture(ai);
  await f.teacher.login();
  const w = await f.teacher.create();
  await f.teacher.json('/works/' + w.id + '/start', 'POST', {});
  await f.teacher.json('/bootstrap');
  const running = await f.teacher.call('/works/' + w.id + '/chat', 'POST', message());
  await ai.started;
  f.advance(3600000);
  ai.release();
  const e = await events(running);
  assert.equal(e.at(-1)!.data.code, 'SESSION_EXPIRED');
  const saved = await f.store.get<Work>('data', 'WORK#' + w.id);
  assert.deepEqual(saved!.data.npcs, w.npcs);
});
test('opaque session rows have TTL but saved work rows never do', async () => {
  const f = fixture();
  await f.teacher.login();
  const token = f.teacher.cookie.split('=')[1];
  const session = await f.store.get('auth', 'SESSION#' + hash(token));
  assert.ok(session!.ttl);
  assert.notEqual(session!.pk, token);
  const w = await f.teacher.create();
  assert.equal((await f.store.get('data', 'WORK#' + w.id))!.ttl, undefined);
});

test('30 simultaneous students can reserve and settle without losing calls', async () => {
  const f = fixture();
  await f.teacher.login();
  const works = await Promise.all(Array.from({ length: 30 }, () => f.teacher.create()));
  const results = await Promise.all(
    works.map(async (w) =>
      events(await f.teacher.call('/works/' + w.id + '/chat', 'POST', message())),
    ),
  );
  assert.equal(
    results.filter((e) => e.some((x) => x.event === 'done')).length,
    30,
    JSON.stringify(results.filter((e) => !e.some((x) => x.event === 'done'))),
  );
  for (const w of works) {
    const saved = (await f.teacher.json('/works/' + w.id)).work;
    assert.equal(saved.usage.nova.calls, 1);
    assert.equal(saved.sessionAttempts, 1);
    assert.equal(saved.busy, false);
  }
});

import {
  DEFAULT_PROMPT,
  toolKeys,
  program,
  newRun,
  executeAction,
  labContext,
  type LabConfig,
  type LabRun,
} from '../shared/lab';
const labConfig = (overrides: Partial<LabConfig> = {}): LabConfig => ({
  mode: 'agent',
  model: 'nova',
  scenario: 'original',
  prompt: DEFAULT_PROMPT,
  memory: true,
  tools: [...toolKeys],
  prediction: 'テスト',
  ...overrides,
});
async function startLab(
  f: ReturnType<typeof fixture>,
  id: string,
  options: Partial<LabConfig> = {},
) {
  return (await f.teacher.json('/works/' + id + '/lab-start', 'POST', labConfig(options)))
    .run as LabRun;
}
const labMessage = (run: LabRun) => ({ requestId: crypto.randomUUID(), runId: run.id });
test('fixed program succeeds in A, fails in B; success requires actual key transfer and look', () => {
  for (const scenario of ['original', 'moved'] as const) {
    const run = newRun('x', labConfig({ scenario }), 0);
    let world = run.world;
    for (const a of program) world = executeAction(world, a, toolKeys).world;
    assert.equal(world.delivered, scenario === 'original');
  }
  let world = newRun('x', labConfig(), 0).world;
  world = executeAction(world, { tool: 'finish' }, toolKeys).world;
  assert.equal(world.delivered, false);
  world = executeAction(world, { tool: 'move', place: 'fountain' }, toolKeys).world;
  world = executeAction(world, { tool: 'take' }, toolKeys).world;
  assert.equal(world.carrying, false);
  world = executeAction(
    world,
    { tool: 'look' },
    toolKeys.filter((t) => t !== 'look'),
  ).world;
  assert.equal(world.found, false);
});
test('hidden key location is never sent to AI; memory off removes prior observations', () => {
  const r = newRun('x', labConfig({ scenario: 'moved' }), 0);
  assert.ok(!JSON.stringify(labContext(r)).includes('keyLocation'));
  assert.ok(!JSON.stringify(labContext(r)).includes('moved'));
  r.steps.push({
    reply: 'secret previous reply',
    result: 'earlier observation',
    action: null,
  } as any);
  assert.ok(JSON.stringify(labContext(r)).includes('earlier observation'));
  r.config.memory = false;
  assert.deepEqual(labContext(r).memory, []);
  assert.ok(!JSON.stringify(labContext(r)).includes('earlier observation'));
});
test('agent adapts to moved key in eight steps; repeated step is idempotent and new experiments preserve old runs', async () => {
  const f = fixture();
  await f.teacher.login();
  const w = await f.teacher.create();
  let run = await startLab(f, w.id, { scenario: 'moved', model: 'haiku' });
  const first = labMessage(run);
  let done = await completed(await f.teacher.call('/works/' + w.id + '/lab-step', 'POST', first));
  const duplicate = await completed(
    await f.teacher.call('/works/' + w.id + '/lab-step', 'POST', first),
  );
  assert.equal(duplicate.work.attempts, 1);
  assert.equal(duplicate.run.steps.length, 1);
  run = done.run;
  while (run.status === 'running')
    run = (
      await completed(await f.teacher.call('/works/' + w.id + '/lab-step', 'POST', labMessage(run)))
    ).run;
  assert.equal(run.status, 'success');
  assert.equal(run.steps.length, 8);
  assert.equal(run.usage.calls, 8);
  assert.equal(
    (await f.teacher.call('/works/' + w.id + '/lab-step', 'POST', labMessage(run))).status,
    409,
  );
  await f.teacher.json('/works/' + w.id + '/lab-reflection', 'POST', {
    runId: run.id,
    reflection: '道具の結果で次の行動が変わった。',
  });
  await startLab(f, w.id);
  const all = await f.teacher.json('/works/' + w.id + '/lab-runs');
  assert.equal(all.runs.length, 2);
  assert.ok(all.runs.some((r: LabRun) => r.reflection.includes('道具')));
});
test('chat never changes game world; program uses no paid model calls', async () => {
  const f = fixture();
  await f.teacher.login();
  const w = await f.teacher.create();
  let run = await startLab(f, w.id, { mode: 'chat' });
  const initial = run.world;
  run = (
    await completed(await f.teacher.call('/works/' + w.id + '/lab-step', 'POST', labMessage(run)))
  ).run;
  assert.deepEqual(run.world, initial);
  assert.equal(run.steps[0].action, null);
  assert.equal(run.usage.calls, 1);
  run = await startLab(f, w.id, { mode: 'program' });
  while (run.status === 'running')
    run = (
      await completed(await f.teacher.call('/works/' + w.id + '/lab-step', 'POST', labMessage(run)))
    ).run;
  assert.equal(run.status, 'success');
  assert.equal(run.usage.calls, 0);
  assert.equal((await f.teacher.json('/works/' + w.id)).work.attempts, 1);
});
test('agent disabled tools cannot run and repeated requests cannot bypass call limit', async () => {
  const f = fixture(undefined, { maxCalls: 1 });
  await f.teacher.login();
  const w = await f.teacher.create();
  let run = await startLab(f, w.id, { tools: ['look'] });
  run = (
    await completed(await f.teacher.call('/works/' + w.id + '/lab-step', 'POST', labMessage(run)))
  ).run;
  assert.match(run.steps[0].result, /許可されていません/);
  const e = await events(
    await f.teacher.call('/works/' + w.id + '/lab-step', 'POST', labMessage(run)),
  );
  assert.equal(e.at(-1)!.data.code, 'CALL_LIMIT');
  assert.equal((await f.teacher.json('/works/' + w.id)).work.attempts, 1);
});
test('stopping an in-flight agent prevents world updates but preserves billing', async () => {
  const ai = new GateAI(),
    f = fixture(ai);
  await f.teacher.login();
  const w = await f.teacher.create();
  const run = await startLab(f, w.id);
  const running = await f.teacher.call('/works/' + w.id + '/lab-step', 'POST', labMessage(run));
  await ai.started;
  await f.teacher.json('/works/' + w.id + '/lab-stop', 'POST', { runId: run.id });
  ai.release();
  const e = await events(running);
  assert.equal(e.at(-1)!.data.code, 'STOPPED');
  const saved = (await f.teacher.json('/works/' + w.id + '/lab-runs')).runs[0];
  assert.equal(saved.status, 'stopped');
  assert.equal(saved.steps.length, 0);
  assert.equal(saved.usage.calls, 1);
  assert.equal((await f.teacher.json('/works/' + w.id)).work.busy, false);
});
test('expiring student session during an agent step blocks the action and retains experiment', async () => {
  const ai = new GateAI(),
    f = fixture(ai);
  await f.teacher.login();
  const w = await f.teacher.create();
  await f.teacher.json('/works/' + w.id + '/start', 'POST', {});
  await f.teacher.json('/bootstrap');
  const run = await startLab(f, w.id);
  const response = await f.teacher.call('/works/' + w.id + '/lab-step', 'POST', labMessage(run));
  await ai.started;
  f.advance(3600000);
  ai.release();
  const e = await events(response);
  assert.equal(e.at(-1)!.data.code, 'SESSION_EXPIRED');
  const rows = await f.store.query<LabRun>('data', 'WORK#' + w.id, 'LABRUN#');
  assert.equal(rows.items[0].data.steps.length, 0);
  assert.equal(rows.items[0].ttl, undefined);
  assert.equal((await f.teacher.call('/works/' + w.id + '/lab-runs')).status, 401);
});
test('invalid agent output is charged once and never executes', async () => {
  const f = fixture(new BadAI());
  await f.teacher.login();
  const w = await f.teacher.create();
  const run = await startLab(f, w.id);
  const e = await events(
    await f.teacher.call('/works/' + w.id + '/lab-step', 'POST', labMessage(run)),
  );
  assert.equal(e.at(-1)!.data.code, 'INVALID_OUTPUT');
  const saved = (await f.teacher.json('/works/' + w.id + '/lab-runs')).runs[0];
  assert.deepEqual(saved.world, run.world);
  assert.equal(saved.usage.calls, 1);
  assert.equal(saved.steps.length, 0);
});
