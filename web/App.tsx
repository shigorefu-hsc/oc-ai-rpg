import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelKey, PublicWork, WorkSummary } from '../shared/domain';
import { MODELS, behaviorNames, usd } from '../shared/domain';
import { Bootstrap, request, setCsrf } from './api';
import Game from './Game';
import Chat from './Chat';
const modelOptions = (
  <>
    <option value="nova">Amazon Nova Lite</option>
    <option value="haiku">Claude Haiku 4.5</option>
  </>
);
const date = (n: number) =>
  new Date(n).toLocaleString('ja-JP', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const status = (w: WorkSummary) =>
  w.status === 'active' && (w.expiresAt ?? 0) > Date.now()
    ? '体験中'
    : w.status === 'ready'
      ? '準備中'
      : '保存済み';
const cost = (w: WorkSummary) => Object.values(w.usage).reduce((s, u) => s + u.costMicroUsd, 0);
export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null),
    [work, setWork] = useState<PublicWork | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [target, setTarget] = useState('seller'),
    [mode, setMode] = useState<'edit' | 'talk'>('edit'),
    [tab, setTab] = useState<'archive' | 'settings'>('archive'),
    [now, setNow] = useState(Date.now()),
    [invite, setInvite] = useState(''),
    [notice, setNotice] = useState(''),
    [muted, setMuted] = useState(true);
  const [title, setTitle] = useState(''),
    [chosen, setChosen] = useState<ModelKey>('nova');
  const audio = useRef<HTMLAudioElement | null>(null),
    actionLock = useRef(false),
    initializing = useRef<Promise<void> | null>(null);
  const reload = useCallback(async () => {
    const b: Bootstrap = await request('/bootstrap');
    setCsrf(b.csrf);
    setBoot(b);
    setWork(b.mode === 'demo' ? b.work! : null);
    if (b.settings) setChosen(b.settings.model);
    setInvite('');
  }, []);
  useEffect(() => {
    let cancelled = false;
    initializing.current ??= (async () => {
      const token = new URLSearchParams(location.hash.slice(1)).get('join');
      if (token) {
        history.replaceState(null, '', location.pathname);
        await request('/join', 'POST', { token });
      }
    })();
    void initializing.current
      .then(() => {
        if (!cancelled) return reload();
      })
      .catch(async (e) => {
        if (!cancelled) {
          setError(e.message);
          await reload().catch(() => {});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const isTeacher = boot?.mode === 'teacher',
    isDemo = boot?.mode === 'demo';
  const expired = boot?.mode === 'expired' || (isDemo && now >= (boot?.expiresAt ?? 0));
  useEffect(() => {
    if (!work || expired) return;
    const t = setInterval(() => {
      if (!actionLock.current)
        void request('/works/' + work.id)
          .then((v) => setWork(v.work))
          .catch((e) => {
            if (e.status === 401) {
              setBoot((b) => (b ? { ...b, mode: 'expired' } : b));
              setError('アクセス時間が終了しました。作品は保存されています。');
            }
          });
    }, 20000);
    return () => clearInterval(t);
  }, [work?.id, expired]);
  useEffect(() => {
    actionLock.current = busy;
  }, [busy]);
  useEffect(
    () => () => {
      audio.current?.pause();
      audio.current = null;
    },
    [],
  );
  useEffect(() => {
    if (expired || !work) {
      audio.current?.pause();
      setMuted(true);
    }
  }, [expired, work?.id]);
  async function act(fn: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  async function open(id: string) {
    await act(async () => {
      const v = await request('/works/' + id);
      setWork(v.work);
      setTarget('seller');
      setMode('edit');
      setInvite('');
    });
  }
  async function create() {
    await act(async () => {
      const v = await request('/works', 'POST', {
        title: title.trim() || '新しい冒険 ' + new Date().toLocaleDateString('ja-JP'),
        model: chosen,
      });
      setWork(v.work);
      setTitle('');
      setTarget('seller');
      setMode('edit');
    });
  }
  async function saveSettings(model: ModelKey, aiEnabled: boolean) {
    await act(async () => {
      const s = await request('/settings', 'PATCH', { model, aiEnabled });
      setBoot((b) => ({ ...b!, settings: s }));
      setChosen(model);
      setNotice('設定を保存しました。');
    });
  }
  async function changeModel(model: ModelKey) {
    await act(async () => {
      const v = await request('/works/' + work!.id + '/model', 'PATCH', { model });
      setWork(v.work);
      setNotice('この作品のモデルを変更しました。');
    });
  }
  async function toggleAudio() {
    try {
      if (!muted) {
        audio.current?.pause();
        setMuted(true);
        return;
      }
      if (!audio.current) {
        const a = await request('/assets');
        audio.current = new Audio(a.level);
        audio.current.loop = true;
        audio.current.volume = 0.25;
      }
      await audio.current.play();
      setMuted(false);
    } catch {
      setError('音楽を再生できませんでした。もう一度お試しください。');
    }
  }
  const selected = work?.npcs.find((n) => n.id === target),
    selectedName = target === 'hero' ? '主人公' : target === 'story' ? '物語' : selected?.name;
  const remaining = Math.max(0, Math.ceil(((boot?.expiresAt ?? 0) - now) / 1000));
  const clock =
    Math.floor(remaining / 60)
      .toString()
      .padStart(2, '0') +
    ':' +
    (remaining % 60).toString().padStart(2, '0');
  const blocked = !!(expired || busy || work?.busy);
  function select(id: string) {
    if (busy) return;
    setTarget(id);
    if (id === 'hero' || id === 'story') setMode('edit');
  }
  function exportWork() {
    if (!work) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(work, null, 2)], { type: 'application/json' }),
    );
    a.download = 'kotoba-' + work.id + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  useEffect(() => {
    type Tool = {
      name: string;
      description: string;
      inputSchema: object;
      annotations: object;
      execute: (input: unknown) => unknown;
    };
    const context = (
      document as Document & {
        modelContext?: { registerTool: (tool: Tool, options: { signal: AbortSignal }) => unknown };
      }
    ).modelContext;
    if (!context || !work || expired) return;
    const controller = new AbortController();
    const tools: Tool[] = [
      {
        name: 'read_current_work',
        description:
          'Read the work currently visible in the game, its NPC profiles and selected model.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: () => ({
          title: work.title,
          model: work.model,
          npcs: work.npcs,
          story: work.story,
        }),
      },
      {
        name: 'select_character',
        description:
          'Select a character in the visible editor. Does not edit a profile or call AI.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input) => {
          const i = input as { id?: unknown };
          if (
            !i ||
            typeof i.id !== 'string' ||
            Object.keys(i).length !== 1 ||
            (!['hero', 'story'].includes(i.id) && !work.npcs.some((n) => n.id === i.id))
          )
            throw new Error('Unknown character');
          if (busy) throw new Error('Conversation in progress');
          setTarget(i.id);
          if (['hero', 'story'].includes(i.id)) setMode('edit');
          return { selectedId: i.id };
        },
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(
          () => {},
        );
      } catch {}
    }
    return () => controller.abort();
  }, [work, busy, expired]);
  return (
    <div className="desk">
      <header className="mast">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            if (isDemo || busy) e.preventDefault();
          }}
        >
          <span className="brand-mark">✦</span>
          <span>
            ことばの街<small>AI CHARACTER STUDIO</small>
          </span>
        </a>
        <div className="mast-right">
          {boot?.local && <span className="local-pill">LOCAL · 動作確認用</span>}
          {isDemo && (
            <span className={'timer ' + (remaining < 300 ? 'urgent' : '')}>
              残り <strong>{clock}</strong>
            </span>
          )}
          {isTeacher && <span className="tag">先生のワークスペース</span>}
          {(isTeacher || isDemo) && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await request('/logout', 'POST', {});
                  await reload();
                })
              }
            >
              ログアウト
            </button>
          )}
        </div>
      </header>
      {error && (
        <div className="error global" role="alert">
          {error}
          <button aria-label="閉じる" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {!boot ? (
        <main className="welcome">
          <h1>街をひらいています…</h1>
        </main>
      ) : boot.mode === 'login' ? (
        <Login local={boot.local} onLogin={reload} />
      ) : expired ? (
        <main className="end-screen">
          <span className="large-star">✦</span>
          <p className="eyebrow">ADVENTURE SAVED</p>
          <h1>今日の冒険は、ここまで。</h1>
          <p>
            つくったキャラクターと会話は保存されています。
            <br />
            先生はログインして、続きから確認できます。
          </p>
          <button
            className="primary"
            onClick={() => {
              setWork(null);
              setBoot({ mode: 'login', local: boot.local });
            }}
          >
            先生のログインへ
          </button>
        </main>
      ) : !work && isTeacher ? (
        <main>
          <section className="welcome">
            <div>
              <p className="eyebrow">TEACHER'S DESK</p>
              <h1>
                ひとことから、
                <br />
                住人が変わる。
              </h1>
              <p>
                生徒のことばで性格をつくり、街で動きと会話を試す。
                <br />
                60分の体験が終わっても、作品はここに残ります。
              </p>
            </div>
            <div className="intro-art" aria-hidden="true">
              <div className="orbit" />
              <span>✦</span>
              <i className="mini-person p1" />
              <i className="mini-person p2" />
              <i className="mini-person p3" />
              <small>10 PEOPLE · YOUR STORY</small>
            </div>
          </section>
          <nav className="tabs" aria-label="先生メニュー">
            <button className={tab === 'archive' ? 'active' : ''} onClick={() => setTab('archive')}>
              作品のアーカイブ
            </button>
            <button
              className={tab === 'settings' ? 'active' : ''}
              onClick={() => setTab('settings')}
            >
              アプリの設定
            </button>
          </nav>
          {tab === 'settings' ? (
            <section className="settings-grid">
              <div className="card">
                <p className="eyebrow">AI MODEL</p>
                <h2>次の体験で使うモデル</h2>
                <p>作品を開いたあとにも切り替えられます。生徒にはモデルの変更権限はありません。</p>
                <label>
                  標準モデル
                  <select
                    value={boot.settings?.model}
                    disabled={busy}
                    onChange={(e) =>
                      void saveSettings(e.target.value as ModelKey, boot.settings!.aiEnabled)
                    }
                  >
                    {modelOptions}
                  </select>
                </label>
                <div className="model-cards">
                  {Object.values(MODELS).map((m) => (
                    <article key={m.key}>
                      <h3>{m.shortName}</h3>
                      <p>
                        {'$' + m.inputRate} / 入力100万 tokens
                        <br />
                        {'$' + m.outputRate} / 出力100万 tokens
                      </p>
                    </article>
                  ))}
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={boot.settings?.aiEnabled}
                    disabled={busy}
                    onChange={(e) => void saveSettings(boot.settings!.model, e.target.checked)}
                  />
                  AIとの会話を有効にする
                </label>
              </div>
              <div className="card">
                <p className="eyebrow">MONTHLY USAGE</p>
                <h2>今月のAI利用額</h2>
                <p className="money">{'$' + usd(boot.budget!.spentMicroUsd)}</p>
                <p>
                  アプリ上限 {'$' + usd(boot.budget!.limitMicroUsd)} / 月<br />
                  処理中の予約額 {'$' + usd(boot.budget!.reservedMicroUsd)}
                </p>
                <p className="fine">
                  東京リージョンの推定額。サーバー・保存・税は含みません。通信エラーで使用量を取得できない場合は上限相当額を計上します。
                </p>
                <p className="fine">1体験は60分・AI呼び出し最大60回。再試行も1回として数えます。</p>
              </div>
            </section>
          ) : (
            <>
              <section className="new-work card">
                <div>
                  <p className="eyebrow">NEW ADVENTURE</p>
                  <h2>体験を用意する</h2>
                  <p>名前に個人情報を含めず、作品名や番号を使ってください。</p>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void create();
                  }}
                >
                  <label>
                    作品名
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      maxLength={80}
                      placeholder="例：1組・冒険 01"
                    />
                  </label>
                  <label>
                    AIモデル
                    <select value={chosen} onChange={(e) => setChosen(e.target.value as ModelKey)}>
                      {modelOptions}
                    </select>
                  </label>
                  <button className="primary" disabled={busy}>
                    作品をつくる ＋
                  </button>
                </form>
              </section>
              <div className="section-title">
                <h2>
                  保存した作品 <span>{boot.works?.length ?? 0}</span>
                </h2>
                <button className="text-button" disabled={busy} onClick={() => void act(reload)}>
                  更新 ↻
                </button>
              </div>
              {!boot.works?.length ? (
                <div className="empty">
                  <span>✧</span>
                  <h3>最初の街をつくりましょう。</h3>
                  <p>上のフォームから体験を用意すると、ここに作品が並びます。</p>
                </div>
              ) : (
                <div className="work-grid">
                  {boot.works.map((w) => (
                    <button
                      className="work-card"
                      key={w.id}
                      onClick={() => void open(w.id)}
                      disabled={busy}
                    >
                      <div className="work-top">
                        <span className="work-icon">✦</span>
                        <span className={'status ' + (status(w) === '体験中' ? 'live' : '')}>
                          {status(w)}
                        </span>
                      </div>
                      <h3>{w.title}</h3>
                      <p>{date(w.updatedAt)}</p>
                      <div className="work-foot">
                        <span>{MODELS[w.model].shortName}</span>
                        <span>
                          {'$' + usd(cost(w))} <b>↗</b>
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {boot.cursor && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const p = await request('/works?cursor=' + encodeURIComponent(boot.cursor!));
                      setBoot((b) => ({
                        ...b!,
                        works: [...b!.works!, ...p.works],
                        cursor: p.cursor,
                      }));
                    })
                  }
                >
                  もっと見る
                </button>
              )}
            </>
          )}
        </main>
      ) : work ? (
        <main className="studio">
          <div className="studio-head">
            <div>
              {isTeacher && (
                <button
                  className="back text-button"
                  disabled={busy}
                  onClick={() => void act(reload)}
                >
                  ← 作品一覧
                </button>
              )}
              <h1>{work.title}</h1>
              <p>
                <span className="saved-dot" /> 自動保存 · {date(work.updatedAt)}　
                {isDemo
                  ? 'AI 残り ' + Math.max(0, 60 - work.sessionAttempts) + ' 回'
                  : MODELS[work.model].name}
              </p>
            </div>
            <div className="studio-actions">
              {isTeacher && (
                <>
                  <select
                    aria-label="この作品のAIモデル"
                    disabled={blocked}
                    value={work.model}
                    onChange={(e) => void changeModel(e.target.value as ModelKey)}
                  >
                    {modelOptions}
                  </select>
                  <button className="secondary" disabled={busy} onClick={exportWork}>
                    作品を書き出す
                  </button>
                  {work.status === 'active' && (work.expiresAt ?? 0) > now ? (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await request('/works/' + work.id + '/end', 'POST', {});
                          const v = await request('/works/' + work.id);
                          setWork(v.work);
                        })
                      }
                    >
                      体験を終了
                    </button>
                  ) : (
                    <button
                      className="primary"
                      disabled={blocked}
                      onClick={() =>
                        void act(async () => {
                          await request('/works/' + work.id + '/start', 'POST', {});
                          await reload();
                        })
                      }
                    >
                      生徒に渡す · 60分 →
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          {isTeacher && (
            <div className="handover-note">
              <span>
                「生徒に渡す」で先生のログインを解除し、この画面を60分の体験に切り替えます。
              </span>
              <button
                className="text-button"
                disabled={blocked || status(work) === '体験中'}
                onClick={() =>
                  void act(async () => {
                    const v = await request('/works/' + work.id + '/invite', 'POST', {});
                    setInvite(v.url);
                  })
                }
              >
                別の端末用リンク
              </button>
            </div>
          )}
          {invite && (
            <div className="invite">
              <label>
                1回限りの招待リンク · 発行から1時間有効
                <input readOnly value={invite} onFocus={(e) => e.target.select()} />
              </label>
              <button
                className="secondary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(invite)
                    .then(() => setNotice('リンクをコピーしました。'))
                    .catch(() => setNotice('リンク欄を選択してコピーしてください。'))
                }
              >
                コピー
              </button>
            </div>
          )}
          <div className="studio-grid">
            <section className="world-panel">
              <div className="world-title">
                <div>
                  <span className="eyebrow">{work.story.chapterTitle}</span>
                  <h2>{work.story.worldName}</h2>
                </div>
                <button
                  className="music-button"
                  onClick={() => void toggleAudio()}
                  aria-pressed={!muted}
                >
                  {muted ? '♪ 音楽をON' : '♪ 音楽をOFF'}
                </button>
              </div>
              <Game work={work} selected={target} onSelect={select} disabled={expired} />
              <div className="game-foot">
                <span>クリックで移動 · 矢印 / WASD · 住人を選択して会話</span>
                <span>
                  出会い <b>{work.talked.length} / 10</b>
                </span>
              </div>
              <div className="story-intro">
                <p>{work.story.intro}</p>
                {work.talked.length === 10 && (
                  <p className="completion">
                    ✦ 十人すべてと話しました。街の物語は、あなたのことばで続いていきます。
                  </p>
                )}
              </div>
              <div className="roster-title">
                <h3>街の住人</h3>
                <span>選んで、つくって、話してみよう</span>
              </div>
              <div className="roster">
                {work.npcs.map((n) => (
                  <button
                    className={target === n.id ? 'selected' : ''}
                    key={n.id}
                    onClick={() => select(n.id)}
                    disabled={busy}
                  >
                    <span className="avatar" style={{ background: n.color }}>
                      {n.role.slice(0, 1)}
                    </span>
                    <span>
                      {n.name}
                      <small>{behaviorNames[n.behavior]}</small>
                    </span>
                    {work.talked.includes(n.id) && <i>✦</i>}
                  </button>
                ))}
              </div>
              <div className="world-tools">
                <button
                  className={target === 'hero' ? 'selected' : ''}
                  disabled={busy}
                  onClick={() => select('hero')}
                >
                  ♙ 主人公をつくる
                </button>
                <button
                  className={target === 'story' ? 'selected' : ''}
                  disabled={busy}
                  onClick={() => select('story')}
                >
                  ▤ 物語をつくる
                </button>
              </div>
              {isTeacher && (
                <details className="usage">
                  <summary>この作品のモデル別利用量</summary>
                  <table>
                    <thead>
                      <tr>
                        <th>モデル</th>
                        <th>呼出</th>
                        <th>入力</th>
                        <th>出力</th>
                        <th>推定 USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(work.usage).map(([k, u]) => (
                        <tr key={k}>
                          <td>{MODELS[k as ModelKey].shortName}</td>
                          <td>{u.calls}</td>
                          <td>{u.inputTokens.toLocaleString()}</td>
                          <td>{u.outputTokens.toLocaleString()}</td>
                          <td>
                            {'$' + usd(u.costMicroUsd)}
                            {u.unknownCalls > 0 ? ' *' : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="fine">* 使用量不明の呼び出しは上限相当額で計上。</p>
                </details>
              )}
            </section>
            <section className="editor-panel">
              <div className="editor-head">
                <div>
                  <p className="eyebrow">CHARACTER NOTEBOOK</p>
                  <h2>{selectedName}</h2>
                </div>
                <span className="model-pill">{MODELS[work.model].shortName}</span>
              </div>
              <div className="mode-switch">
                <button
                  className={mode === 'edit' ? 'active' : ''}
                  disabled={busy}
                  onClick={() => setMode('edit')}
                >
                  ✎ つくる
                </button>
                <button
                  className={mode === 'talk' ? 'active' : ''}
                  disabled={busy || !selected}
                  onClick={() => setMode('talk')}
                >
                  ☏ 話す
                </button>
              </div>
              <details className="profile" key={target}>
                <summary>
                  現在の設定{' '}
                  {selected && (
                    <span>
                      {behaviorNames[selected.behavior]} · v{selected.version}
                    </span>
                  )}
                </summary>
                <dl>
                  {selected ? (
                    <>
                      <dt>性格</dt>
                      <dd>{selected.personality || '未設定'}</dd>
                      <dt>口調・一人称</dt>
                      <dd>
                        {selected.voice} / {selected.firstPerson}
                      </dd>
                      <dt>主人公への態度</dt>
                      <dd>{selected.attitude}</dd>
                      <dt>好きなこと・目的</dt>
                      <dd>
                        {selected.likes.join('、') || '未設定'} / {selected.goal}
                      </dd>
                      <dt>記憶</dt>
                      <dd>{selected.memory || 'まだ会話していません'}</dd>
                    </>
                  ) : target === 'hero' ? (
                    <>
                      <dt>名前・肩書き</dt>
                      <dd>
                        {work.hero.name} / {work.hero.title}
                      </dd>
                      <dt>性格・出身</dt>
                      <dd>
                        {work.hero.personality} / {work.hero.origin}
                      </dd>
                      <dt>目的</dt>
                      <dd>{work.hero.goal}</dd>
                    </>
                  ) : (
                    <>
                      <dt>世界・章</dt>
                      <dd>
                        {work.story.worldName} / {work.story.chapterTitle}
                      </dd>
                      <dt>導入</dt>
                      <dd>{work.story.intro}</dd>
                    </>
                  )}
                </dl>
                <button
                  className="text-button"
                  disabled={blocked}
                  onClick={() =>
                    void act(async () => {
                      const v = await request('/works/' + work.id + '/undo', 'POST', { target });
                      setWork(v.work);
                      setNotice('ひとつ前の設定に戻しました。');
                    })
                  }
                >
                  ↶ 設定をひとつ戻す
                </button>
              </details>
              <Chat
                key={work.id + target + mode}
                work={work}
                target={target}
                mode={mode}
                disabled={blocked}
                onWork={setWork}
                onBusy={setBusy}
              />
            </section>
          </div>
        </main>
      ) : null}
      <footer className="footer">
        <span>ことばの街 · 学びのための小さなRPG</span>
        <span>CREATE A CHARACTER. MEET A STORY.</span>
      </footer>
    </div>
  );
}
function Login({ local, onLogin }: { local: boolean; onLogin: () => Promise<void> }) {
  const [username, setUsername] = useState(local ? 'teacher' : ''),
    [password, setPassword] = useState(local ? 'local-demo-only' : ''),
    [newPassword, setNewPassword] = useState(''),
    [challenge, setChallenge] = useState<string>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const v = await request('/login', 'POST', {
        username,
        password,
        ...(challenge ? { challengeId: challenge, newPassword } : {}),
      });
      if (v.challengeId) setChallenge(v.challengeId);
      else {
        setPassword('');
        setNewPassword('');
        await onLogin();
      }
    } catch (e) {
      setError((e as Error).message);
      if (challenge) {
        setChallenge(undefined);
        setNewPassword('');
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-copy">
        <p className="eyebrow">A SMALL TOWN. ENDLESS POSSIBILITIES.</p>
        <h1>
          「臆病だけど、
          <br />
          やさしい人。」
          <br />
          <em>
            そのひとことが、
            <br />
            住人をつくる。
          </em>
        </h1>
        <p>
          性格も、話し方も、歩き方も。
          <br />
          チャットでつくって、街で確かめる授業用RPG。
        </p>
        <div className="facts">
          <span>
            <b>60</b> 分の体験
          </span>
          <span>
            <b>10</b> 人の住人
          </span>
          <span>
            <b>∞</b> ことばの可能性
          </span>
        </div>
      </section>
      <section className="login-card">
        <span className="large-star">✦</span>
        <p className="eyebrow">TEACHER ACCESS</p>
        <h2>{challenge ? 'パスワードを設定' : '先生のログイン'}</h2>
        <p>
          {challenge
            ? '12文字以上で英大文字・小文字・数字・記号を含めてください。'
            : 'ログインして体験を用意し、生徒に画面を渡してください。'}
        </p>
        {local && (
          <p className="local-note">
            この画面はローカルの動作確認用です。AIの応答はサンプルで、AWS料金は発生しません。
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label>
            ユーザー名
            <input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={busy || !!challenge}
            />
          </label>
          {!challenge ? (
            <label>
              パスワード
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={busy}
              />
            </label>
          ) : (
            <label>
              新しいパスワード
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={busy}
              />
            </label>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <button className="primary" disabled={busy}>
            {busy ? 'ログイン中…' : challenge ? '設定してはじめる →' : 'ワークスペースをひらく →'}
          </button>
        </form>
        <p className="fine">
          生徒のアカウント登録は不要です。
          <br />
          体験終了後も作品と会話は保存されます。
        </p>
      </section>
    </main>
  );
}
