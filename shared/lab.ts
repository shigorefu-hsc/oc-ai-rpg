import { z } from 'zod';
import { emptyUsage, modelKey, type Usage } from './domain';
export const places = ['market', 'fountain', 'garden'] as const;
export type Place = (typeof places)[number];
export const placeNames: Record<Place, string> = {
  market: '市場',
  fountain: '噴水',
  garden: '庭園',
};
export const toolNames = {
  look: '周りを見る',
  move: '移動する',
  ask: '住人に聞く',
  take: '鍵を拾う',
  give: '鍵を渡す',
  finish: '終了を宣言',
} as const;
export type ToolName = keyof typeof toolNames;
export const toolKeys = Object.keys(toolNames) as ToolName[];
export const actionSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('look') }).strict(),
  z.object({ tool: z.literal('move'), place: z.enum(places) }).strict(),
  z.object({ tool: z.literal('ask'), person: z.enum(['merchant', 'gardener']) }).strict(),
  z.object({ tool: z.literal('take') }).strict(),
  z.object({ tool: z.literal('give'), person: z.enum(['merchant', 'gardener']) }).strict(),
  z.object({ tool: z.literal('finish') }).strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export const labConfigSchema = z
  .object({
    mode: z.enum(['program', 'chat', 'agent']),
    model: modelKey,
    scenario: z.enum(['original', 'moved']),
    prompt: z.string().trim().min(1).max(1200),
    memory: z.boolean(),
    tools: z
      .array(z.enum(toolKeys as [ToolName, ...ToolName[]]))
      .max(6)
      .refine((t) => new Set(t).size === t.length),
    prediction: z.string().trim().max(500).default(''),
  })
  .strict();
export type LabConfig = z.infer<typeof labConfigSchema>;
export const DEFAULT_PROMPT =
  '落とし物の鍵を探して、持ち主に返してください。住人の話と観察の結果を確かめ、見つからなければ別の場所を調べてください。';
export const MAX_STEPS = 12;
export type World = {
  location: Place;
  keyLocation: Place;
  found: boolean;
  carrying: boolean;
  delivered: boolean;
};
export type LabStep = {
  requestId: string;
  index: number;
  at: number;
  context: Record<string, unknown>;
  action: Action | null;
  reply: string;
  result: string;
  usage: Usage;
  modelId: string;
  world: World;
};
export type LabRun = {
  id: string;
  createdAt: number;
  config: LabConfig;
  world: World;
  steps: LabStep[];
  usage: Usage;
  status: 'running' | 'stopped' | 'success' | 'exhausted';
  reflection: string;
};
export const runIdSchema = z.string().regex(/^[0-9]{16}_[0-9a-f-]{36}$/);
export const stepInputSchema = z
  .object({
    runId: runIdSchema,
    requestId: z.string().uuid(),
    text: z.string().trim().max(1200).optional(),
  })
  .strict();
export type LabStepInput = z.infer<typeof stepInputSchema>;
export const decisionSchema = z
  .object({ reply: z.string().trim().min(1).max(1400), action: actionSchema.nullable() })
  .strict();
export function newRun(id: string, config: LabConfig, now: number): LabRun {
  return {
    id,
    createdAt: now,
    config,
    world: {
      location: 'market',
      keyLocation: config.scenario === 'moved' ? 'garden' : 'fountain',
      found: false,
      carrying: false,
      delivered: false,
    },
    steps: [],
    usage: emptyUsage(),
    status: 'running',
    reflection: '',
  };
}
export const program: Action[] = [
  { tool: 'ask', person: 'merchant' },
  { tool: 'move', place: 'fountain' },
  { tool: 'look' },
  { tool: 'take' },
  { tool: 'move', place: 'market' },
  { tool: 'give', person: 'merchant' },
];
export function observation(w: World) {
  return {
    location: w.location,
    people: w.location === 'market' ? ['merchant'] : w.location === 'garden' ? ['gardener'] : [],
    inventory: w.carrying ? ['key'] : [],
    delivered: w.delivered,
  };
}
export function labContext(run: LabRun, text = ''): Record<string, unknown> {
  return {
    mode: run.config.mode,
    goal: run.config.prompt,
    studentMessage: text,
    observation: observation(run.world),
    availableTools: run.config.mode === 'agent' ? run.config.tools : [],
    memory: run.config.memory
      ? run.steps
          .slice(-MAX_STEPS)
          .map((s) => ({ action: s.action, result: s.result, reply: s.reply.slice(0, 120) }))
      : [],
    actionsLeft: MAX_STEPS - run.steps.length,
  };
}
export function executeAction(
  world: World,
  action: Action,
  tools: ToolName[],
): { world: World; result: string } {
  const w = { ...world };
  if (!tools.includes(action.tool))
    return { world: w, result: '実行不可：この道具は許可されていません。' };
  switch (action.tool) {
    case 'look':
      if (w.location === w.keyLocation && !w.carrying && !w.delivered) {
        w.found = true;
        return { world: w, result: '足元に小さな真ちゅうの鍵があります。takeで拾えます。' };
      }
      return {
        world: w,
        result:
          w.location === 'fountain' && w.keyLocation === 'garden'
            ? '鍵はありません。「落とし物は庭園へ」と書かれた札があります。'
            : 'ここには鍵は見当たりません。',
      };
    case 'move':
      w.location = action.place;
      return { world: w, result: placeNames[w.location] + 'へ移動しました。' };
    case 'ask':
      if (
        (action.person === 'merchant' && w.location !== 'market') ||
        (action.person === 'gardener' && w.location !== 'garden')
      )
        return { world: w, result: 'その人はここにはいません。' };
      return {
        world: w,
        result:
          action.person === 'merchant'
            ? '商人：私の鍵がなくなりました。最後に噴水で使いました。見つけたら市場の私に返してください。'
            : '庭師：噴水にあった鍵を庭園へ移しました。この辺りをよく見てください。',
      };
    case 'take':
      if (w.location !== w.keyLocation || !w.found || w.carrying || w.delivered)
        return { world: w, result: '拾えません。今いる場所で、まずlookで鍵を確認してください。' };
      w.carrying = true;
      return { world: w, result: '鍵を拾いました。持ち物に鍵が入りました。' };
    case 'give':
      if (!w.carrying) return { world: w, result: '鍵を持っていません。' };
      if (action.person !== 'merchant' || w.location !== 'market')
        return { world: w, result: '持ち主の商人に、市場で直接渡してください。' };
      w.carrying = false;
      w.delivered = true;
      return {
        world: w,
        result: '商人：ありがとう、私の鍵です！ 鍵の返却をゲームが確認しました。',
      };
    case 'finish':
      return {
        world: w,
        result: w.delivered
          ? '鍵は返却済みです。'
          : '終了を宣言しましたが、鍵はまだ返却されていません。',
      };
  }
}
export function applyStep(run: LabRun, step: Omit<LabStep, 'index' | 'world' | 'result'>): LabRun {
  const outcome = step.action
    ? executeAction(run.world, step.action, run.config.tools)
    : { world: { ...run.world }, result: 'チャットの返答のみ。ゲーム内の行動は実行していません。' };
  const next = {
    ...run,
    world: outcome.world,
    steps: [...run.steps, { ...step, index: run.steps.length + 1, ...outcome }],
    usage: { ...run.usage },
  };
  for (const k of Object.keys(next.usage) as (keyof Usage)[]) next.usage[k] += step.usage[k];
  if (next.world.delivered) next.status = 'success';
  else if (next.steps.length >= (run.config.mode === 'program' ? program.length : MAX_STEPS))
    next.status = 'exhausted';
  return next;
}
