import { useEffect, useRef, useState } from 'react';
import type { PublicWork, Turn } from '../shared/domain';
import { MODELS } from '../shared/domain';
import { chat, request } from './api';
export default function Chat({
  work,
  target,
  mode,
  disabled,
  onWork,
  onBusy,
}: {
  work: PublicWork;
  target: string;
  mode: 'edit' | 'talk';
  disabled: boolean;
  onWork: (w: PublicWork) => void;
  onBusy: (b: boolean) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]),
    [draft, setDraft] = useState(''),
    [partial, setPartial] = useState(''),
    [pending, setPending] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [cursor, setCursor] = useState<string>();
  const abort = useRef<AbortController | null>(null),
    bottom = useRef<HTMLDivElement>(null);
  const base = '/works/' + work.id;
  useEffect(() => {
    let alive = true;
    request(base + '/history?target=' + target + '&mode=' + mode)
      .then((v) => {
        if (alive) {
          setTurns(v.turns);
          setCursor(v.cursor);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, [base, target, mode]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [turns, partial, pending]);
  async function send() {
    if (!draft.trim() || busy || disabled) return;
    const text = draft.trim();
    setError('');
    setBusy(true);
    onBusy(true);
    setPartial('');
    setPending(text);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await chat(
        work.id,
        { requestId: crypto.randomUUID(), target, mode, text },
        (e) => {
          if (e.event === 'delta') setPartial((p) => p + (e.data.text ?? ''));
          if (e.event === 'reset') setPartial('');
          if (e.event === 'done' && e.data.turn && e.data.work) {
            setTurns((t) => [
              ...t.filter((x) => x.requestId !== e.data.turn!.requestId),
              e.data.turn!,
            ]);
            onWork(e.data.work);
            setPending('');
            setPartial('');
            setDraft('');
          }
        },
        controller.signal,
      );
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : '通信できませんでした。');
      const v = await request(base).catch(() => null);
      if (v?.work) onWork(v.work);
      const history = await request(base + '/history?target=' + target + '&mode=' + mode).catch(
        () => null,
      );
      if (history) {
        setTurns(history.turns);
        setCursor(history.cursor);
      }
    } finally {
      setBusy(false);
      onBusy(false);
      setPending('');
      setPartial('');
    }
  }
  async function earlier() {
    try {
      const v = await request(
        base +
          '/history?target=' +
          target +
          '&mode=' +
          mode +
          '&cursor=' +
          encodeURIComponent(cursor!),
      );
      setTurns((t) => [...v.turns, ...t]);
      setCursor(v.cursor);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const name =
    target === 'hero'
      ? '主人公'
      : target === 'story'
        ? '物語'
        : work.npcs.find((n) => n.id === target)?.name;
  return (
    <div className="chat">
      <div className="messages" aria-label="会話履歴">
        {cursor && (
          <button className="text-button" onClick={earlier}>
            前の会話を読む
          </button>
        )}
        {loading ? (
          <p className="muted">履歴を読み込み中…</p>
        ) : (
          !turns.length && (
            <div className="chat-welcome">
              <span className="spark">✦</span>
              <h3>
                {mode === 'edit' ? name + 'を、ことばでつくろう。' : name + 'と話してみよう。'}
              </h3>
              <p>
                {mode === 'edit'
                  ? '性格や話し方、動き方を伝えてください。会話が保存されると、街の中の住人にも反映されます。'
                  : '今の性格で返事をします。設定を変えるときは「つくる」に切り替えてください。'}
              </p>
            </div>
          )
        )}
        {turns.map((t) => (
          <div className="turn" key={t.requestId}>
            <div className="bubble student">{t.text}</div>
            <div className="bubble assistant">{t.reply}</div>
            <div className="turn-meta">
              {MODELS[t.model].shortName} · {t.changed ? '設定に反映済み' : '会話を保存済み'}
            </div>
          </div>
        ))}
        {pending && (
          <div className="turn">
            <div className="bubble student">{pending}</div>
            <div className="bubble assistant streaming">{partial || '考えています…'}</div>
            <div className="turn-meta">応答を確認してから保存します</div>
          </div>
        )}
        <div ref={bottom} />
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {!turns.length && !busy && (
        <div className="suggestions">
          {(mode === 'talk'
            ? ['自己紹介してくれる？', 'この街のことを教えて']
            : target === 'story'
              ? ['星を探す冒険の物語にしたい']
              : target === 'hero'
                ? ['好奇心いっぱいの冒険者にしたい']
                : ['臆病で、人が近づくと離れる人にしたい', '親切で、主人公についてくる人にしたい']
          ).map((s) => (
            <button key={s} disabled={disabled} onClick={() => setDraft(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="message">
          メッセージ
        </label>
        <textarea
          id="message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={1200}
          rows={3}
          disabled={disabled || busy || loading}
          placeholder={mode === 'edit' ? 'どんな住人にしたい？' : '話しかけてみよう…'}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="composer-foot">
          <span>{draft.length} / 1200</span>
          <button className="primary" disabled={!draft.trim() || disabled || busy || loading}>
            {busy ? '応答中…' : '送信 ↑'}
          </button>
        </div>
      </form>
    </div>
  );
}
