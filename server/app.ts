import { z } from 'zod';
import { Store, Row, put, Conflict, Change } from './store';
import { Auth, AuthError, Session, secret, hash, equal, cookie } from './auth';
import { AI, Generated } from './bedrock';
import {
  Work,
  WorkSummary,
  ModelKey,
  MODELS,
  modelKey,
  initialWork,
  publicWork,
  summary,
  chatInputSchema,
  ChatInput,
  outputSchema,
  targetSchema,
  Turn,
  emptyUsage,
} from '../shared/domain';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
export type Config = {
  local: boolean;
  userPoolId: string;
  clientId: string;
  assetBucket: string;
  monthlyBudgetMicroUsd: number;
  sessionBudgetMicroUsd: number;
  maxCalls: number;
  sessionMs: number;
  modelIds: Record<ModelKey, string>;
};
type Settings = { model: ModelKey; aiEnabled: boolean };
type Budget = { spent: number; reserved: number };
type RequestRecord = {
  status: 'pending' | 'done' | 'failed';
  fingerprint: string;
  turn?: Turn;
  error?: string;
};
type Invite = { ownerId: string; username: string; workId: string; expiresAt: number };
type Identity = NonNullable<Awaited<ReturnType<Auth['session']>>>;
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  });
const error = (status: number, code: string, message: string) =>
  new AuthError(status, code, message);
const teacherKey = (id: string) => 'TEACHER#' + id;
const workKey = (id: string) => 'WORK#' + id;
const schemaBody = z
  .object({
    username: z.string().min(1).max(128),
    password: z.string().max(256),
    newPassword: z.string().min(12).max(256).optional(),
    challengeId: z.string().length(43).optional(),
  })
  .strict();
export class App {
  private auth: Auth;
  constructor(
    readonly store: Store,
    readonly ai: AI,
    readonly config: Config,
    readonly now = () => Date.now(),
  ) {
    if (config.local && process.env.AWS_LAMBDA_FUNCTION_NAME)
      throw new Error('Local mode is forbidden on Lambda');
    this.auth = new Auth(store, config, now);
  }
  private async body(req: Request) {
    if (!req.headers.get('content-type')?.startsWith('application/json'))
      throw error(415, 'JSON_REQUIRED', 'JSON形式で送信してください。');
    const text = await req.text();
    if (Buffer.byteLength(text) > 12000) throw error(413, 'TOO_LARGE', '入力が長すぎます。');
    try {
      return JSON.parse(text);
    } catch {
      throw error(400, 'BAD_JSON', '入力を確認してください。');
    }
  }
  private async settings(id: string) {
    return (
      (await this.store.get<Settings>('data', teacherKey(id), 'SETTINGS'))?.data ?? {
        model: 'nova' as const,
        aiEnabled: true,
      }
    );
  }
  private teacher(who: Identity) {
    if (who.session.kind !== 'teacher')
      throw error(403, 'TEACHER_ONLY', '先生のログインが必要です。');
  }
  private async authorizedWork(id: string, who: Identity): Promise<Row<Work>> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw error(404, 'NOT_FOUND', '体験が見つかりません。');
    const row = await this.store.get<Work>('data', workKey(id));
    if (!row || row.data.ownerId !== who.session.ownerId)
      throw error(404, 'NOT_FOUND', '体験が見つかりません。');
    if (
      who.session.kind === 'demo' &&
      (who.session.expiresAt <= this.now() ||
        who.session.workId !== id ||
        row.data.activeSessionHash !== hash(who.token) ||
        row.data.status !== 'active' ||
        (row.data.expiresAt ?? 0) <= this.now())
    )
      throw error(401, 'SESSION_EXPIRED', '体験時間が終了しました。作品は保存されています。');
    return row;
  }
  private async workChanges(work: Work, row: Row<Work>): Promise<Change[]> {
    const s = await this.store.get('data', teacherKey(work.ownerId), 'WORK#' + work.id);
    return [
      put('data', row.pk, row.sk, work, row),
      put('data', teacherKey(work.ownerId), 'WORK#' + work.id, summary(work), s),
    ];
  }
  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    for (let i = 0; i < 5; i++) {
      try {
        return await fn();
      } catch (e) {
        if (!(e instanceof Conflict)) throw e;
      }
    }
    throw error(409, 'CONFLICT', '別の変更を処理しています。少し待ってお試しください。');
  }
  async handle(req: Request, ip = 'local'): Promise<Response> {
    try {
      return await this.route(req, ip);
    } catch (e) {
      if (e instanceof AuthError) return json({ error: e.code, message: e.message }, e.status);
      if (e instanceof z.ZodError)
        return json({ error: 'VALIDATION', message: '入力内容を確認してください。' }, 400);
      if (e instanceof Conflict)
        return json(
          { error: 'CONFLICT', message: '変更が重なりました。もう一度お試しください。' },
          409,
        );
      console.error(
        JSON.stringify({ event: 'request_failed', type: e instanceof Error ? e.name : 'Unknown' }),
      );
      return json(
        { error: 'SERVER_ERROR', message: '処理できませんでした。保存済みの作品は残っています。' },
        500,
      );
    }
  }
  private async route(req: Request, ip: string): Promise<Response> {
    const url = new URL(req.url),
      path = url.pathname;
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (write && req.headers.get('origin') !== url.origin)
      throw error(403, 'ORIGIN', 'このサイトから操作してください。');
    if (path === '/api/health') return json({ ok: true });
    if (path === '/api/login' && req.method === 'POST') {
      await this.auth.limitLogin(ip);
      const b = schemaBody.parse(await this.body(req));
      const result = await this.auth.login(b.username, b.password, b.newPassword, b.challengeId);
      if ('challengeId' in result) return json(result);
      const old = await this.auth.session(req);
      if (old)
        await this.store.commit([
          {
            table: 'auth',
            pk: old.row.pk,
            sk: old.row.sk,
            expected: old.row.revision,
            remove: true,
          },
        ]);
      return json({ ok: true }, 200, {
        'set-cookie': cookie(result.token, 8 * 3600, this.config.local),
      });
    }
    const who = await this.auth.session(req);
    if (path === '/api/bootstrap' && req.method === 'GET') {
      if (!who) return json({ mode: 'login', local: this.config.local });
      if (who.session.kind === 'demo') {
        try {
          const row = await this.authorizedWork(who.session.workId!, who);
          return json({
            mode: 'demo',
            local: this.config.local,
            csrf: who.session.csrf,
            work: publicWork(row.data),
            expiresAt: who.session.expiresAt,
            maxCalls: this.config.maxCalls,
          });
        } catch {
          return json({ mode: 'expired', local: this.config.local }, 200, {
            'set-cookie': cookie('', 0, this.config.local),
          });
        }
      }
      const [settings, works, budget] = await Promise.all([
        this.settings(who.session.ownerId),
        this.store.query<WorkSummary>('data', teacherKey(who.session.ownerId), 'WORK#', 40),
        this.store.get<Budget>('data', this.budgetKey()),
      ]);
      return json({
        mode: 'teacher',
        local: this.config.local,
        csrf: who.session.csrf,
        username: who.session.username,
        settings,
        works: works.items.map((x) => x.data).sort((a, b) => b.createdAt - a.createdAt),
        cursor: works.cursor,
        budget: {
          spentMicroUsd: budget?.data.spent ?? 0,
          reservedMicroUsd: budget?.data.reserved ?? 0,
          limitMicroUsd: this.config.monthlyBudgetMicroUsd,
        },
        models: Object.values(MODELS),
      });
    }
    if (path === '/api/join' && req.method === 'POST') {
      const b = z
        .object({ token: z.string().length(43) })
        .strict()
        .parse(await this.body(req));
      const invite = await this.store.get<Invite>('auth', 'INVITE#' + hash(b.token));
      if (!invite || invite.data.expiresAt <= this.now())
        throw error(
          410,
          'INVITE_EXPIRED',
          'このリンクは使用済み、または期限切れです。先生に確認してください。',
        );
      const row = await this.store.get<Work>('data', workKey(invite.data.workId));
      if (!row) throw error(404, 'NOT_FOUND', '体験が見つかりません。');
      const token = await this.activate(row, invite.data.ownerId, invite.data.username, who, [
        { table: 'auth', pk: invite.pk, sk: invite.sk, expected: invite.revision, remove: true },
      ]);
      return json({ ok: true }, 200, { 'set-cookie': cookie(token, 3600, this.config.local) });
    }
    if (!who)
      throw error(
        401,
        'SESSION_EXPIRED',
        'ログインまたは体験時間の更新が必要です。作品は保存されています。',
      );
    if (write && !equal(req.headers.get('x-csrf-token') ?? '', who.session.csrf))
      throw error(403, 'CSRF', '画面を更新して、もう一度お試しください。');
    if (path === '/api/assets' && req.method === 'GET') {
      if (who.session.kind === 'demo') await this.authorizedWork(who.session.workId!, who);
      return json(await this.assets());
    }
    if (path === '/api/logout' && req.method === 'POST') {
      await this.store.commit([
        { table: 'auth', pk: who.row.pk, sk: who.row.sk, expected: who.row.revision, remove: true },
      ]);
      return json({ ok: true }, 200, { 'set-cookie': cookie('', 0, this.config.local) });
    }
    if (path === '/api/settings' && req.method === 'PATCH') {
      this.teacher(who);
      const b = z
        .object({ model: modelKey, aiEnabled: z.boolean() })
        .strict()
        .parse(await this.body(req));
      const row = await this.store.get('data', teacherKey(who.session.ownerId), 'SETTINGS');
      await this.store.commit([put('data', teacherKey(who.session.ownerId), 'SETTINGS', b, row)]);
      return json(b);
    }
    if (path === '/api/works' && req.method === 'GET') {
      this.teacher(who);
      const page = await this.store.query<WorkSummary>(
        'data',
        teacherKey(who.session.ownerId),
        'WORK#',
        40,
        url.searchParams.get('cursor') ?? undefined,
      );
      return json({ works: page.items.map((x) => x.data), cursor: page.cursor });
    }
    if (path === '/api/works' && req.method === 'POST') {
      this.teacher(who);
      const b = z
        .object({ title: z.string().trim().min(1).max(80), model: modelKey })
        .strict()
        .parse(await this.body(req));
      const work = initialWork(
        crypto.randomUUID(),
        who.session.ownerId,
        b.title,
        b.model,
        this.now(),
      );
      await this.store.commit([
        put('data', workKey(work.id), 'META', work, null),
        put('data', teacherKey(work.ownerId), 'WORK#' + work.id, summary(work), null),
      ]);
      return json({ work: publicWork(work) }, 201);
    }
    const match = path.match(
      /^\/api\/works\/([0-9a-f-]{36})(?:\/(start|invite|end|model|chat|history|undo))?$/,
    );
    if (!match) throw error(404, 'NOT_FOUND', 'ページが見つかりません。');
    const [, id, action] = match;
    const row = await this.authorizedWork(id, who);
    if (!action && req.method === 'GET') return json({ work: publicWork(row.data) });
    if (action === 'history' && req.method === 'GET') {
      const target = url.searchParams.get('target') ?? '',
        mode = url.searchParams.get('mode') ?? 'edit';
      this.validTarget(row.data, target, mode);
      const page = await this.store.query<Turn>(
        'data',
        workKey(id),
        'TURN#' + target + '#' + mode + '#',
        30,
        url.searchParams.get('cursor') ?? undefined,
        true,
      );
      return json({ turns: page.items.map((x) => x.data).reverse(), cursor: page.cursor });
    }
    if (action === 'model' && req.method === 'PATCH') {
      this.teacher(who);
      const b = z
        .object({ model: modelKey })
        .strict()
        .parse(await this.body(req));
      this.notBusy(row.data);
      row.data.model = b.model;
      row.data.updatedAt = this.now();
      await this.store.commit(await this.workChanges(row.data, row));
      return json({ work: publicWork(row.data) });
    }
    if (action === 'start' && req.method === 'POST') {
      this.teacher(who);
      const token = await this.activate(row, who.session.ownerId, who.session.username, who, []);
      return json({ ok: true }, 200, { 'set-cookie': cookie(token, 3600, this.config.local) });
    }
    if (action === 'invite' && req.method === 'POST') {
      this.teacher(who);
      this.notBusy(row.data);
      const token = secret(),
        expiresAt = this.now() + 3600000;
      await this.store.commit([
        put(
          'auth',
          'INVITE#' + hash(token),
          'META',
          { ownerId: who.session.ownerId, username: who.session.username, workId: id, expiresAt },
          null,
          Math.floor(expiresAt / 1000),
        ),
      ]);
      return json({ url: url.origin + '/#join=' + token, expiresAt });
    }
    if (action === 'end' && req.method === 'POST') {
      row.data.status = 'finished';
      row.data.expiresAt = this.now();
      row.data.activeSessionHash = null;
      row.data.updatedAt = this.now();
      row.data.generation++;
      const changes = await this.workChanges(row.data, row);
      if (who.session.kind === 'demo')
        changes.push({
          table: 'auth',
          pk: who.row.pk,
          sk: who.row.sk,
          expected: who.row.revision,
          remove: true,
        });
      await this.store.commit(changes);
      return json(
        { ok: true },
        200,
        who.session.kind === 'demo' ? { 'set-cookie': cookie('', 0, this.config.local) } : {},
      );
    }
    if (action === 'undo' && req.method === 'POST') {
      const { target } = z
        .object({ target: z.string().max(30) })
        .strict()
        .parse(await this.body(req));
      this.notBusy(row.data);
      this.validTarget(row.data, target, 'edit');
      const rev = await this.store.query<{ target: string; value: unknown }>(
        'data',
        workKey(id),
        'REV#' + target + '#',
        1,
        undefined,
        true,
      );
      if (!rev.items.length) throw error(400, 'NO_UNDO', '元に戻せる変更がありません。');
      const old = rev.items[0];
      this.applyUpdate(row.data, target, old.data.value as Record<string, unknown>);
      row.data.updatedAt = this.now();
      await this.store.commit([
        ...(await this.workChanges(row.data, row)),
        { table: 'data', pk: old.pk, sk: old.sk, expected: old.revision, remove: true },
      ]);
      return json({ work: publicWork(row.data) });
    }
    if (action === 'chat' && req.method === 'POST') {
      const input = chatInputSchema.parse(await this.body(req));
      this.validTarget(row.data, input.target, input.mode);
      if (!(await this.settings(who.session.ownerId)).aiEnabled)
        throw error(403, 'AI_PAUSED', '先生がAIを一時停止しています。');
      const existing = await this.store.get<RequestRecord>(
        'data',
        workKey(id),
        'REQ#' + input.requestId,
      );
      const fingerprint = hash(JSON.stringify(input));
      if (existing) {
        if (existing.data.fingerprint !== fingerprint)
          throw error(409, 'REQUEST_MISMATCH', 'リクエストIDが重複しています。');
        if (existing.data.status === 'done')
          return this.events(async (emit) => {
            emit('done', { turn: existing.data.turn, work: publicWork(row.data) });
          });
        throw error(
          409,
          'REQUEST_ALREADY_USED',
          existing.data.status === 'pending'
            ? '応答を処理しています。少し待って履歴を確認してください。'
            : 'このリクエストは終了しました。履歴を確認してから再送してください。',
        );
      }
      this.notBusy(row.data);
      if (who.session.kind === 'demo' && who.session.expiresAt - this.now() < 3000)
        throw error(401, 'SESSION_EXPIRED', '体験時間が終了しました。');
      row.data.pending = { requestId: input.requestId, until: this.now() + 90000 };
      await this.store.commit([
        ...(await this.workChanges(row.data, row)),
        put(
          'data',
          workKey(id),
          'REQ#' + input.requestId,
          { status: 'pending', fingerprint },
          null,
        ),
      ]);
      return this.events(async (emit, signal) =>
        this.chat(id, who, input, fingerprint, emit, signal),
      );
    }
    throw error(405, 'METHOD', 'この操作は利用できません。');
  }
  private notBusy(work: Work) {
    if (work.pending && work.pending.until > this.now())
      throw error(409, 'BUSY', '会話の保存が終わるまでお待ちください。');
  }
  private validTarget(work: Work, target: string, mode: string) {
    if (
      !['edit', 'talk'].includes(mode) ||
      (!['hero', 'story'].includes(target) && !work.npcs.some((n) => n.id === target)) ||
      (mode === 'talk' && ['hero', 'story'].includes(target))
    )
      throw error(400, 'TARGET', 'キャラクターを選んでください。');
  }
  private async activate(
    row: Row<Work>,
    ownerId: string,
    username: string,
    old: Identity | null,
    extra: Change[],
  ) {
    this.notBusy(row.data);
    if (row.data.status === 'active' && (row.data.expiresAt ?? 0) > this.now())
      throw error(
        409,
        'ACTIVE',
        'この作品は体験中です。終了してから新しい体験を開始してください。',
      );
    const token = secret(),
      expiresAt = this.now() + this.config.sessionMs;
    const session: Session = {
      kind: 'demo',
      ownerId,
      username,
      workId: row.data.id,
      expiresAt,
      csrf: secret(),
    };
    row.data.activeSessionHash = hash(token);
    row.data.status = 'active';
    row.data.expiresAt = expiresAt;
    row.data.sessionAttempts = 0;
    row.data.sessionCostMicroUsd = 0;
    row.data.generation++;
    row.data.updatedAt = this.now();
    const changes = [
      ...(await this.workChanges(row.data, row)),
      put('auth', 'SESSION#' + hash(token), 'META', session, null, Math.floor(expiresAt / 1000)),
      ...extra,
    ];
    if (old)
      changes.push({
        table: 'auth',
        pk: old.row.pk,
        sk: old.row.sk,
        expected: old.row.revision,
        remove: true,
      });
    await this.store.commit(changes);
    return token;
  }
  private budgetKey() {
    return 'BUDGET#' + new Date(this.now() + 9 * 3600000).toISOString().slice(0, 7);
  }
  private events(
    run: (emit: (event: string, data: unknown) => void, signal: AbortSignal) => Promise<void>,
  ): Response {
    const abort = new AbortController(),
      encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (event: string, data: unknown) => {
          if (!closed)
            controller.enqueue(
              encoder.encode('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'),
            );
        };
        emit('status', { message: '考えています…' });
        const pulse = setInterval(() => emit('ping', {}), 10000);
        void run(emit, abort.signal)
          .catch((e) =>
            emit('error', {
              code: e instanceof AuthError ? e.code : 'AI_FAILED',
              message:
                e instanceof AuthError
                  ? e.message
                  : '応答を保存できませんでした。履歴を確認してからお試しください。',
            }),
          )
          .finally(() => {
            clearInterval(pulse);
            if (!closed) {
              closed = true;
              controller.close();
            }
          });
      },
      cancel() {
        closed = true;
        abort.abort(new Error('CLIENT_DISCONNECTED'));
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }
  private async chat(
    id: string,
    who: Identity,
    input: ChatInput,
    fingerprint: string,
    emit: (e: string, d: unknown) => void,
    clientSignal: AbortSignal,
  ) {
    const pk = workKey(id);
    const total = emptyUsage();
    const deadline = Math.min(75000, who.session.expiresAt - this.now());
    const signal = AbortSignal.any([clientSignal, AbortSignal.timeout(Math.max(1, deadline))]);
    let last: Generated | undefined;
    try {
      const history = await this.store.query<Turn>(
        'data',
        pk,
        'TURN#' + input.target + '#' + input.mode + '#',
        6,
        undefined,
        true,
      );
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = await this.authorizedWork(id, who);
        if (current.data.pending?.requestId !== input.requestId)
          throw error(409, 'LEASE', '会話の処理時間が終了しました。');
        const prepared = this.ai.prepare(
          current.data,
          input,
          history.items.map((x) => x.data).reverse(),
        );
        const budgetKey = this.budgetKey();
        const generation = current.data.generation;
        await this.retry(async () => {
          const [w, b] = await Promise.all([
            this.authorizedWork(id, who),
            this.store.get<Budget>('data', budgetKey),
          ]);
          if (w.data.pending?.requestId !== input.requestId || w.data.generation !== generation)
            throw error(409, 'LEASE', '体験の状態が変わりました。');
          const budget = b?.data ?? { spent: 0, reserved: 0 };
          if (w.data.sessionAttempts >= this.config.maxCalls)
            throw error(
              429,
              'CALL_LIMIT',
              'この体験のAI利用回数に達しました。作品は保存されています。',
            );
          if (
            w.data.sessionCostMicroUsd + prepared.reservationMicroUsd >
            this.config.sessionBudgetMicroUsd
          )
            throw error(429, 'SESSION_BUDGET', 'この体験のAI利用上限に達しました。');
          if (
            budget.spent + budget.reserved + prepared.reservationMicroUsd >
            this.config.monthlyBudgetMicroUsd
          )
            throw error(
              429,
              'MONTHLY_BUDGET',
              '今月のAI利用上限に達しました。先生に確認してください。',
            );
          w.data.attempts++;
          w.data.sessionAttempts++;
          w.data.usage[prepared.model].calls++;
          budget.reserved += prepared.reservationMicroUsd;
          await this.store.commit([
            ...(await this.workChanges(w.data, w)),
            put('data', budgetKey, 'META', budget, b),
          ]);
        });
        total.calls++;
        let generated: Generated | undefined,
          unknown = false;
        try {
          generated = await this.ai.generate(prepared, signal, (t) => emit('delta', { text: t }));
          last = generated;
        } catch (e) {
          unknown = true;
          throw e;
        } finally {
          const cost = generated
            ? Math.ceil(
                generated.inputTokens * MODELS[prepared.model].inputRate +
                  generated.outputTokens * MODELS[prepared.model].outputRate,
              )
            : prepared.reservationMicroUsd;
          total.costMicroUsd += cost;
          total.inputTokens += generated?.inputTokens ?? 0;
          total.outputTokens += generated?.outputTokens ?? 0;
          if (unknown) total.unknownCalls++;
          await this.retry(async () => {
            const [w, b] = await Promise.all([
              this.store.get<Work>('data', pk),
              this.store.get<Budget>('data', budgetKey),
            ]);
            if (!w || !b) throw new Error('ACCOUNTING_RECORD_MISSING');
            b.data.reserved -= prepared.reservationMicroUsd;
            b.data.spent += cost;
            const u = w.data.usage[prepared.model];
            u.inputTokens += generated?.inputTokens ?? 0;
            u.outputTokens += generated?.outputTokens ?? 0;
            u.costMicroUsd += cost;
            if (unknown) u.unknownCalls++;
            if (w.data.generation === generation) w.data.sessionCostMicroUsd += cost;
            await this.store.commit([
              ...(await this.workChanges(w.data, w)),
              put('data', budgetKey, 'META', b.data, b),
            ]);
          });
        }
        if (!generated) throw new Error('NO_RESPONSE');
        if (['content_filtered', 'guardrail_intervened'].includes(generated.stopReason))
          throw error(422, 'CONTENT_FILTERED', '授業に合う別の表現で、もう一度書いてみましょう。');
        let output: z.infer<ReturnType<typeof outputSchema>>;
        try {
          if (generated.stopReason !== 'end_turn') throw new Error('INCOMPLETE');
          output = outputSchema(input.target, input.mode).parse(
            JSON.parse(generated.raw.trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/g, '')),
          );
        } catch (e) {
          console.warn(
            JSON.stringify({
              event: 'model_output_invalid',
              model: prepared.model,
              stopReason: generated.stopReason,
              issues:
                e instanceof z.ZodError
                  ? e.issues.map((i) => ({ path: i.path, code: i.code }))
                  : undefined,
            }),
          );
          if (attempt === 0 && !signal.aborted) {
            emit('reset', { message: '応答を確認しています…' });
            continue;
          }
          throw error(
            502,
            'INVALID_OUTPUT',
            'AIの応答を確認できませんでした。設定は変更していません。',
          );
        }
        if (signal.aborted) throw signal.reason;
        await this.retry(async () => {
          const w = await this.authorizedWork(id, who),
            req = await this.store.get<RequestRecord>('data', pk, 'REQ#' + input.requestId);
          if (
            w.data.pending?.requestId !== input.requestId ||
            w.data.generation !== generation ||
            !req
          )
            throw error(409, 'LEASE', '体験の状態が変わりました。設定は変更していません。');
          const changes: Change[] = [];
          const changed = output.update !== null && Object.keys(output.update).length > 0;
          if (changed) {
            changes.push(
              put(
                'data',
                pk,
                'REV#' +
                  input.target +
                  '#' +
                  String(this.now()).padStart(16, '0') +
                  '#' +
                  input.requestId,
                { target: input.target, value: this.currentProfile(w.data, input.target) },
                null,
              ),
            );
            this.applyUpdate(w.data, input.target, output.update!);
          }
          const npc = w.data.npcs.find((n) => n.id === input.target);
          if (input.mode === 'talk' && npc) {
            npc.memory = output.memory;
            npc.emotion = output.emotion;
            if (!w.data.talked.includes(npc.id)) w.data.talked.push(npc.id);
          }
          w.data.pending = null;
          w.data.updatedAt = this.now();
          const turn: Turn = {
            requestId: input.requestId,
            target: input.target,
            mode: input.mode,
            text: input.text,
            reply: output.reply,
            model: prepared.model,
            modelId: prepared.modelId,
            createdAt: this.now(),
            usage: total,
            changed,
            revision: npc?.version ?? null,
          };
          changes.push(
            ...(await this.workChanges(w.data, w)),
            put('data', pk, 'REQ#' + input.requestId, { status: 'done', fingerprint, turn }, req),
            put(
              'data',
              pk,
              'TURN#' +
                input.target +
                '#' +
                input.mode +
                '#' +
                String(turn.createdAt).padStart(16, '0') +
                '#' +
                input.requestId,
              turn,
              null,
            ),
          );
          await this.store.commit(changes);
          emit('done', { turn, work: publicWork(w.data) });
        });
        console.log(
          JSON.stringify({
            event: 'chat_completed',
            workId: id,
            model: prepared.model,
            modelId: prepared.modelId,
            ...total,
          }),
        );
        return;
      }
    } catch (e) {
      await this.retry(async () => {
        const [w, r] = await Promise.all([
          this.store.get<Work>('data', pk),
          this.store.get<RequestRecord>('data', pk, 'REQ#' + input.requestId),
        ]);
        if (!w || !r) return;
        const changes: Change[] = [];
        if (w.data.pending?.requestId === input.requestId) {
          w.data.pending = null;
          changes.push(...(await this.workChanges(w.data, w)));
        }
        if (r.data.status === 'pending')
          changes.push(
            put(
              'data',
              pk,
              r.sk,
              {
                status: 'failed',
                fingerprint,
                error: e instanceof AuthError ? e.code : 'AI_FAILED',
              },
              r,
            ),
          );
        if (changes.length) await this.store.commit(changes);
      });
      console.error(
        JSON.stringify({
          event: 'chat_failed',
          workId: id,
          type: e instanceof Error ? e.name : 'Unknown',
          modelId: last?.modelId,
        }),
      );
      if (signal.aborted)
        throw error(408, 'TIMEOUT', '応答時間が終了しました。保存済みの作品は残っています。');
      throw e;
    }
  }
  private currentProfile(work: Work, target: string) {
    const value =
      target === 'hero'
        ? work.hero
        : target === 'story'
          ? work.story
          : work.npcs.find((n) => n.id === target)!;
    return Object.fromEntries(
      Object.keys(targetSchema(target).shape).map((k) => [
        k,
        (value as unknown as Record<string, unknown>)[k],
      ]),
    );
  }
  private applyUpdate(work: Work, target: string, patch: Record<string, unknown>) {
    const next = targetSchema(target).parse({ ...this.currentProfile(work, target), ...patch });
    if (target === 'hero') work.hero = next as Work['hero'];
    else if (target === 'story') work.story = next as Work['story'];
    else {
      const n = work.npcs.find((n) => n.id === target)!;
      Object.assign(n, next);
      n.version++;
    }
  }
  async assets(): Promise<Record<string, string>> {
    if (this.config.local)
      return { intro: '/audio/intro.mp3', level: '/audio/level.mp3', mumble: '/audio/mumble.wav' };
    const s3 = new S3Client({});
    return Object.fromEntries(
      await Promise.all(
        ['intro.mp3', 'level.mp3', 'mumble.wav'].map(async (f) => [
          f.split('.')[0],
          await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: this.config.assetBucket, Key: 'audio/' + f }),
            { expiresIn: 3600 },
          ),
        ]),
      ),
    );
  }
}
