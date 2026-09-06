import { fetchWithCapacityRetry } from './capacity';
import type { PublicWork, WorkSummary, ModelKey, Turn } from '../shared/domain';
export type Bootstrap = {
  mode: 'login' | 'expired' | 'teacher' | 'demo';
  local: boolean;
  csrf?: string;
  work?: PublicWork;
  works?: WorkSummary[];
  cursor?: string;
  username?: string;
  expiresAt?: number;
  maxCalls?: number;
  settings?: { model: ModelKey; aiEnabled: boolean };
  budget?: { spentMicroUsd: number; reservedMicroUsd: number; limitMicroUsd: number };
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
let csrf = '';
export function setCsrf(value?: string) {
  csrf = value ?? '';
}
export async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetchWithCapacityRetry('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok)
    throw new ApiError(response.status, value.error, value.message ?? '通信できませんでした。');
  return value;
}
export type ChatEvent = {
  event: string;
  data: { text?: string; message?: string; code?: string; turn?: Turn; work?: PublicWork };
};
export async function chat(
  workId: string,
  input: unknown,
  onEvent: (event: ChatEvent) => void,
  signal: AbortSignal,
) {
  const response = await fetchWithCapacityRetry('/api/works/' + workId + '/chat', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) {
    const v = await response.json();
    throw new ApiError(
      response.status,
      v.error,
      v.message ?? '混み合っています。少し待ってからお試しください。',
    );
  }
  if (!response.body) throw new Error('応答を受信できませんでした。');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = '',
    done = false;
  try {
    while (true) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      let idx: number;
      while ((idx = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, idx);
        pending = pending.slice(idx + 2);
        const event = frame
          .split('\n')
          .find((x) => x.startsWith('event: '))
          ?.slice(7);
        const data = frame
          .split('\n')
          .find((x) => x.startsWith('data: '))
          ?.slice(6);
        if (event && data) {
          const parsed = JSON.parse(data);
          if (event === 'error') throw new ApiError(502, parsed.code, parsed.message);
          if (event === 'done') done = true;
          onEvent({ event, data: parsed });
        }
      }
      if (chunk.done) break;
    }
    if (!done) throw new Error('通信が途切れました。履歴を確認してから再送してください。');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
