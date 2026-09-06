import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithCapacityRetry } from '../web/capacity';
test('Lambda admission throttles replay the same request; app budget rejections are not replayed', async () => {
  let calls = 0;
  const bodies: unknown[] = [];
  const fake = async (_url: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    bodies.push(init?.body);
    return calls === 1
      ? Response.json({ message: 'TooManyRequestsException' }, { status: 429 })
      : Response.json({ ok: true });
  };
  const r = await fetchWithCapacityRetry(
    '/api/test',
    { method: 'POST', body: 'same-request-id' },
    fake,
    async () => {},
  );
  assert.equal(r.status, 200);
  assert.deepEqual(bodies, ['same-request-id', 'same-request-id']);
  calls = 0;
  const limited = await fetchWithCapacityRetry(
    '/api/test',
    {},
    async () => {
      calls++;
      return Response.json({ error: 'MONTHLY_BUDGET' }, { status: 429 });
    },
    async () => {},
  );
  assert.equal(limited.status, 429);
  assert.equal(calls, 1);
});
test('uncertain transport failure is never automatically replayed', async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithCapacityRetry(
      '/api/test',
      {},
      async () => {
        calls++;
        throw new Error('Connection lost');
      },
      async () => {},
    ),
  );
  assert.equal(calls, 1);
});
