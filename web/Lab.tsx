import { useEffect, useRef, useState } from 'react';
import { MODELS, usd, type PublicWork } from '../shared/domain';
import {
  DEFAULT_PROMPT,
  MAX_STEPS,
  places,
  placeNames,
  toolKeys,
  toolNames,
  program,
  type LabConfig,
  type LabRun,
} from '../shared/lab';
import { request, stream } from './api';
import './lab.css';
const modes = [
  ['program', '01', 'プログラム', '決めた順番で動く'],
  ['chat', '02', 'AIチャット', 'ことばで相談する'],
  ['agent', '03', 'AIエージェント', '道具を選んで動く'],
] as const;
const runStatus = {
  running: '実験中',
  stopped: '停止',
  success: '返却できた',
  exhausted: '上限まで試した',
};
const formatAction = (a: (typeof program)[number]) =>
  toolNames[a.tool] +
  ('place' in a
    ? ' → ' + placeNames[a.place]
    : 'person' in a
      ? ' → ' + (a.person === 'merchant' ? '商人' : '庭師')
      : '');
export default function Lab({
  work,
  disabled,
  onWork,
  onBusy,
}: {
  work: PublicWork;
  disabled: boolean;
  onWork: (w: PublicWork) => void;
  onBusy: (b: boolean) => void;
}) {
  const [config, setConfig] = useState<LabConfig>({
    mode: 'program',
    model: work.model,
    scenario: 'original',
    prompt: DEFAULT_PROMPT,
    memory: true,
    tools: [...toolKeys],
    prediction: '',
  });
  const [runs, setRuns] = useState<LabRun[]>([]),
    [run, setRun] = useState<LabRun | null>(null),
    [busy, setBusy] = useState(false),
    [auto, setAuto] = useState(false),
    [error, setError] = useState(''),
    [draft, setDraft] = useState(''),
    [reply, setReply] = useState(''),
    [reflection, setReflection] = useState(''),
    [saved, setSaved] = useState(false),
    [cursor, setCursor] = useState<string>(),
    [loaded, setLoaded] = useState(false);
  const timeline = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight;
  }, [run?.steps.length, reply]);
  const autoRef = useRef(false),
    lock = useRef(false),
    abort = useRef<AbortController | null>(null),
    mounted = useRef(true);
  const path = '/works/' + work.id;
  function accept(next: LabRun) {
    setRun(next);
    setRuns((prev) =>
      [next, ...prev.filter((r) => r.id !== next.id)].sort((a, b) => b.id.localeCompare(a.id)),
    );
  }
  async function refresh() {
    const v = await request(path + '/lab-runs');
    setRuns(v.runs);
    setCursor(v.cursor);
    setLoaded(true);
    const current = v.runs.find((r: LabRun) => r.id === work.labRunId) ?? v.runs[0];
    if (current) {
      setRun(current);
      setConfig(current.config);
      setReflection(current.reflection);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((e) => setError(e.message));
    return () => {
      mounted.current = false;
      autoRef.current = false;
      abort.current?.abort();
      onBusy(false);
    };
  }, [work.id]);
  useEffect(() => {
    if (disabled) {
      autoRef.current = false;
      setAuto(false);
    }
  }, [disabled]);
  function markBusy(b: boolean) {
    lock.current = b;
    setBusy(b);
    onBusy(b);
  }
  async function perform(fn: () => Promise<void>) {
    if (lock.current || disabled) return;
    markBusy(true);
    setError('');
    setSaved(false);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (mounted.current) markBusy(false);
    }
  }
  async function start() {
    await perform(async () => {
      const v = await request(path + '/lab-start', 'POST', config);
      accept(v.run);
      onWork(v.work);
      setReflection('');
      setReply('');
    });
  }
  async function oneStep(current: LabRun): Promise<LabRun> {
    abort.current = new AbortController();
    setReply('');
    let next: LabRun | undefined;
    await stream(
      path + '/lab-step',
      {
        runId: current.id,
        requestId: crypto.randomUUID(),
        ...(current.config.mode === 'chat' ? { text: draft } : {}),
      },
      (e) => {
        if (e.event === 'delta') setReply((s) => s + (e.data.text ?? ''));
        if (e.event === 'done' && e.data.run) {
          next = e.data.run;
          accept(next);
          if (e.data.work) onWork(e.data.work);
        }
      },
      abort.current.signal,
    );
    if (!next) throw new Error('実験履歴を開き直してください。');
    setReply('');
    setDraft('');
    return next;
  }
  async function advance(continuous = false) {
    if (!run) return;
    await perform(async () => {
      autoRef.current = continuous;
      setAuto(continuous);
      let current = run;
      try {
        do {
          current = await oneStep(current);
        } while (autoRef.current && current.status === 'running' && current.config.mode !== 'chat');
      } finally {
        autoRef.current = false;
        setAuto(false);
      }
    });
  }
  async function stop() {
    autoRef.current = false;
    setAuto(false);
    if (!run) return;
    try {
      const v = await request(path + '/lab-stop', 'POST', { runId: run.id });
      accept(v.run);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const dirty = !!run && JSON.stringify(config) !== JSON.stringify(run.config);
  const locked = disabled || busy || !loaded;
  const canStep = run?.status === 'running' && !dirty && !locked;
  const active = run?.world.location ?? 'market';
  const patch = (value: Partial<LabConfig>) => {
    setConfig((c) => ({ ...c, ...value }));
    setSaved(false);
  };
  const selection = run?.config ?? config;
  return (
    <div className="lab">
      <section className="lab-intro">
        <div>
          <p className="eyebrow">AI TAIKEN / EXPERIMENT 01</p>
          <h2>「鍵を返して」で、動ける？</h2>
          <p>同じ街、同じミッション。動かし方を変えて、AIにできることを発見しよう。</p>
        </div>
        <div className="lab-lesson">
          <span>予想する</span>
          <b>→</b>
          <span>試す</span>
          <b>→</b>
          <span>比べる</span>
          <b>→</b>
          <span>説明する</span>
        </div>
      </section>
      <nav className="lab-modes" aria-label="実験モード">
        {modes.map(([key, num, label, detail]) => (
          <button
            key={key}
            disabled={locked}
            aria-pressed={config.mode === key}
            className={config.mode === key ? 'selected' : ''}
            onClick={() => patch({ mode: key })}
          >
            <b>{num}</b>
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
          </button>
        ))}
      </nav>
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void refresh().catch((e) => setError(e.message))}
          >
            保存済みの実験を読み直す
          </button>
        </div>
      )}
      <div className="lab-grid">
        <section className="lab-workbench">
          <div
            className="lab-map"
            role="img"
            aria-label={
              '現在地：' +
              placeNames[active] +
              '。' +
              (run?.world.delivered
                ? '鍵は返却済み。'
                : run?.world.carrying
                  ? '鍵を持っています。'
                  : '鍵を探しています。')
            }
          >
            <div className="map-heading">
              <span>星あかりの街</span>
              <span className="map-badge">
                {selection.scenario === 'original' ? '実験 A' : '実験 B · 環境を変更'}
              </span>
            </div>
            <div className="map-road" />
            {places.map((p, i) => (
              <div key={p} className={'map-place place-' + i + (active === p ? ' here' : '')}>
                <span className="map-building">
                  {p === 'market' ? '▥' : p === 'fountain' ? '♧' : '♠'}
                </span>
                <strong>{placeNames[p]}</strong>
                <small>
                  {p === 'market' ? '商人' : p === 'garden' ? '庭師' : '落とし物の手掛かり'}
                </small>
                {active === p && (
                  <span className="map-player">
                    ◆
                    <small>
                      {selection.mode === 'agent'
                        ? 'エージェント'
                        : selection.mode === 'program'
                          ? 'プログラム'
                          : 'あなた'}
                    </small>
                  </span>
                )}
              </div>
            ))}
            <div className="map-inventory">
              持ち物：{run?.world.carrying ? '⚿ 鍵' : 'なし'}{' '}
              <b>
                {run?.world.delivered ? '✓ ミッション達成' : 'MISSION / 落とし物の鍵を持ち主に返す'}
              </b>
            </div>
          </div>
          <div className="lab-controls">
            <div>
              <span className="eyebrow">CONTROL</span>
              <p>
                {run
                  ? runStatus[run.status] +
                    ' · ' +
                    run.steps.length +
                    ' / ' +
                    (selection.mode === 'program' ? program.length : MAX_STEPS) +
                    ' ステップ'
                  : 'まず条件を決めて、実験を始めよう。'}
              </p>
            </div>
            <div className="lab-buttons">
              <button className="primary" disabled={locked} onClick={() => void start()}>
                {run ? '↻ この条件でやり直す' : '実験を始める →'}
              </button>
              <button className="secondary" disabled={!canStep} onClick={() => void advance()}>
                {selection.mode === 'chat' ? '相談する' : '1ステップ'}
              </button>
              {selection.mode !== 'chat' && (
                <button
                  className="secondary"
                  disabled={!canStep}
                  onClick={() => void advance(true)}
                >
                  ▶ 最後まで
                </button>
              )}
              <button
                className="text-button"
                disabled={!run || run.status !== 'running' || disabled}
                onClick={() => void stop()}
              >
                ■ 停止
              </button>
            </div>
            {dirty && (
              <p className="lab-hint">
                条件を変更しました。「この条件でやり直す」で、新しい実験として記録します。
              </p>
            )}
            {busy && (
              <p role="status" className="lab-hint">
                {auto ? '連続実行中。停止はいつでもできます。' : '応答を待っています…'}
              </p>
            )}
          </div>
          <div className="lab-settings">
            <div className="lab-setting-heading">
              <h3>実験の条件</h3>
              <span>一度に変える条件は、ひとつずつ。</span>
            </div>
            <div className="lab-selects">
              <label>
                街の状態
                <select
                  disabled={locked}
                  value={config.scenario}
                  onChange={(e) => patch({ scenario: e.target.value as LabConfig['scenario'] })}
                >
                  <option value="original">A / 鍵は噴水にある</option>
                  <option value="moved">B / 鍵が庭園に移された</option>
                </select>
              </label>
              <label>
                AIモデル
                <select
                  disabled={locked || config.mode === 'program'}
                  value={config.model}
                  onChange={(e) => patch({ model: e.target.value as LabConfig['model'] })}
                >
                  <option value="nova">Amazon Nova Lite</option>
                  <option value="haiku">Claude Haiku 4.5</option>
                </select>
              </label>
            </div>
            {config.mode === 'program' ? (
              <div className="lab-program">
                <p>このモードはAIを使いません。街の状態が変わっても、同じ順番で動きます。</p>
                <ol>
                  {program.map((a, i) => (
                    <li key={i}>{formatAction(a)}</li>
                  ))}
                </ol>
              </div>
            ) : (
              <>
                <label>
                  AIへの目標・指示
                  <textarea
                    rows={4}
                    maxLength={1200}
                    disabled={locked}
                    value={config.prompt}
                    onChange={(e) => patch({ prompt: e.target.value })}
                  />
                </label>
                <div className="lab-presets">
                  <button
                    className="text-button"
                    disabled={locked}
                    onClick={() => patch({ prompt: 'なんとかして。' })}
                  >
                    曖昧な指示を試す
                  </button>
                  <button
                    className="text-button"
                    disabled={locked}
                    onClick={() => patch({ prompt: DEFAULT_PROMPT })}
                  >
                    具体的な目標に戻す
                  </button>
                </div>
                <label className="lab-check">
                  <input
                    type="checkbox"
                    checked={config.memory}
                    disabled={locked}
                    onChange={(e) => patch({ memory: e.target.checked })}
                  />
                  前の会話・行動結果を次のAI呼び出しに渡す
                </label>
                {config.mode === 'agent' && (
                  <fieldset>
                    <legend>使ってよい道具</legend>
                    <div className="lab-tools">
                      {toolKeys.map((t) => (
                        <label key={t}>
                          <input
                            type="checkbox"
                            checked={config.tools.includes(t)}
                            disabled={locked}
                            onChange={(e) =>
                              patch({
                                tools: e.target.checked
                                  ? [...config.tools, t]
                                  : config.tools.filter((x) => x !== t),
                              })
                            }
                          />
                          {toolNames[t]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                {config.mode === 'chat' && (
                  <p className="lab-hint">
                    チャットは相談だけ。返答しても、街の中では移動や受け渡しを実行しません。
                  </p>
                )}
              </>
            )}
            <label>
              予想：何が起こると思う？
              <textarea
                maxLength={500}
                rows={2}
                disabled={locked}
                placeholder="例：鍵の場所を変えると、同じ手順では返せなくなる。"
                value={config.prediction}
                onChange={(e) => patch({ prediction: e.target.value })}
              />
            </label>
          </div>
        </section>
        <section className="lab-notebook">
          <div className="lab-setting-heading">
            <div>
              <p className="eyebrow">OBSERVE THE LOOP</p>
              <h3>行動の実験ノート</h3>
            </div>
            <span className="model-pill">
              {selection.mode === 'program' ? '固定の手順' : MODELS[selection.model].shortName}
            </span>
          </div>
          <p className="lab-note">
            目標 → 渡された情報 → 選んだ行動 → 実際の結果。AIの説明とゲームの結果を見比べよう。
          </p>
          {run && (
            <div className="lab-goal">
              <small>この実験の目標</small>
              <p>
                {run.config.mode === 'program'
                  ? '決められた6つの手順で鍵を返す'
                  : run.config.prompt}
              </p>
              {run.config.prediction && (
                <p>
                  <b>予想：</b>
                  {run.config.prediction}
                </p>
              )}
            </div>
          )}
          <div className="lab-timeline" ref={timeline} aria-live="polite">
            {!run?.steps.length && (
              <div className="lab-empty">
                <span>◎</span>
                <h4>まだ、結果はわからない。</h4>
                <p>まずはプログラムを動かそう。次に鍵の場所を変えると、どうなる？</p>
              </div>
            )}
            {run?.steps.map((s) => (
              <article className="lab-step" key={s.requestId}>
                <header>
                  <b>{String(s.index).padStart(2, '0')}</b>
                  <strong>{s.action ? formatAction(s.action) : 'AIからの返答'}</strong>
                </header>
                {typeof s.context.studentMessage === 'string' && s.context.studentMessage && (
                  <div className="lab-goal">
                    <small>あなたの質問</small>
                    <p>{s.context.studentMessage}</p>
                  </div>
                )}
                <p>{s.reply}</p>
                <div className="lab-result">
                  <small>ゲームの結果</small>
                  <p>{s.result}</p>
                </div>
                {selection.mode !== 'program' && (
                  <details>
                    <summary>このときAIに渡した情報</summary>
                    <pre>{JSON.stringify(s.context, null, 2)}</pre>
                    <small>
                      入力 {s.usage.inputTokens} / 出力 {s.usage.outputTokens} tokens ·{' '}
                      {'$' + usd(s.usage.costMicroUsd)}
                    </small>
                  </details>
                )}
              </article>
            ))}
            {busy && reply && (
              <article className="lab-step pending">
                <small>AIの返答を受信中</small>
                <p>{reply}</p>
              </article>
            )}
          </div>
          {selection.mode === 'chat' && (
            <label className="lab-chat-input">
              AIへの質問
              <textarea
                rows={2}
                maxLength={1200}
                disabled={locked}
                value={draft}
                placeholder="例：鍵を探すためには、最初に何をしたらよい？"
                onChange={(e) => setDraft(e.target.value)}
              />
              <small>上の「相談する」で送信します。</small>
            </label>
          )}
          {run && (
            <div className="lab-reflection">
              <label>
                気づき：予想と結果はどう違った？
                <textarea
                  rows={3}
                  maxLength={1000}
                  disabled={locked}
                  value={reflection}
                  onChange={(e) => {
                    setReflection(e.target.value);
                    setSaved(false);
                  }}
                />
              </label>
              <button
                className="secondary"
                disabled={locked}
                onClick={() =>
                  void perform(async () => {
                    const v = await request(path + '/lab-reflection', 'POST', {
                      runId: run.id,
                      reflection,
                    });
                    accept(v.run);
                    setSaved(true);
                  })
                }
              >
                気づきを保存
              </button>
              {saved && <span role="status"> 保存しました</span>}
            </div>
          )}
        </section>
      </div>
      <section className="lab-comparison">
        <div className="lab-setting-heading">
          <div>
            <p className="eyebrow">COMPARE YOUR EXPERIMENTS</p>
            <h3>条件を変えると、何が変わった？</h3>
          </div>
          <span>実験と気づきは、体験終了後も保存されます。</span>
        </div>
        <p>
          NovaとHaikuを比べるときは、目標・街の状態・記憶・道具をそろえよう。1回の結果だけで、モデルの能力が決まるわけではありません。
        </p>
        {!runs.length ? (
          <p className="lab-note">実験が終わると、ここで振り返れます。</p>
        ) : (
          <div className="lab-table">
            <table>
              <thead>
                <tr>
                  <th>実験</th>
                  <th>動かし方</th>
                  <th>条件</th>
                  <th>結果</th>
                  <th>AI利用</th>
                  <th>ノート</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => (
                  <tr key={r.id} className={r.id === run?.id ? 'current' : ''}>
                    <td>
                      {new Date(r.createdAt).toLocaleTimeString('ja-JP', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {i === 0 ? ' · 最新' : ''}
                    </td>
                    <td>
                      {modes.find((m) => m[0] === r.config.mode)?.[2]}
                      <small>
                        {r.config.mode === 'program'
                          ? 'AI利用なし'
                          : MODELS[r.config.model].shortName}
                      </small>
                    </td>
                    <td>
                      {r.config.scenario === 'original' ? 'A：噴水' : 'B：庭園'}
                      <small>
                        {r.config.mode !== 'program'
                          ? '記憶 ' + (r.config.memory ? 'ON' : 'OFF')
                          : ''}
                        {r.config.mode === 'agent' ? ' · 道具 ' + r.config.tools.length + '個' : ''}
                      </small>
                    </td>
                    <td>
                      <b>{runStatus[r.status]}</b>
                      <small>{r.steps.length} ステップ</small>
                    </td>
                    <td>
                      {r.usage.calls} 回<small>{'$' + usd(r.usage.costMicroUsd)}</small>
                    </td>
                    <td>
                      <details>
                        <summary>指示・気づきを見る</summary>
                        <p>{r.config.prompt}</p>
                        <p>道具：{r.config.tools.map((t) => toolNames[t]).join('、')}</p>
                        <p>予想：{r.config.prediction || '未記入'}</p>
                        <p>気づき：{r.reflection || '未記入'}</p>
                        <ol>
                          {r.steps.map((s) => (
                            <li key={s.requestId}>
                              {s.action ? formatAction(s.action) : '会話'}：{s.result}
                            </li>
                          ))}
                        </ol>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cursor && (
          <button
            className="text-button"
            onClick={() =>
              void request(path + '/lab-runs?cursor=' + encodeURIComponent(cursor))
                .then((v) => {
                  setRuns((p) => [
                    ...p,
                    ...v.runs.filter((r: LabRun) => !p.some((x) => x.id === r.id)),
                  ]);
                  setCursor(v.cursor);
                })
                .catch((e) => setError(e.message))
            }
          >
            前の実験も表示
          </button>
        )}
      </section>
      <aside className="lab-learnings">
        <div>
          <b>指示を変える ≠ AIの再学習</b>
          <p>この実験では、毎回AIに渡す指示を変えています。</p>
        </div>
        <div>
          <b>「記憶」はアプリが渡す情報</b>
          <p>AIがいつでも全部を覚えているわけではありません。</p>
        </div>
        <div>
          <b>エージェント = AI ＋ 道具 ＋ 繰り返し</b>
          <p>選べる道具と、実際の結果が次の行動につながります。</p>
        </div>
      </aside>
    </div>
  );
}
