import { z } from 'zod';

export const modelKey = z.enum(['nova', 'haiku']);
export type ModelKey = z.infer<typeof modelKey>;
export const MODELS = {
  nova: {
    key: 'nova',
    name: 'Amazon Nova Lite',
    shortName: 'Nova Lite',
    inputRate: 0.072,
    outputRate: 0.288,
  },
  haiku: {
    key: 'haiku',
    name: 'Claude Haiku 4.5',
    shortName: 'Haiku 4.5',
    inputRate: 1.1,
    outputRate: 5.5,
  },
} as const;
export const behaviorSchema = z.enum(['wander', 'idle', 'approach', 'avoid', 'follow']);
export const behaviorNames = {
  wander: '歩きまわる',
  idle: 'その場にいる',
  approach: '近づく',
  avoid: '距離をとる',
  follow: 'ついてくる',
};
const text = (n: number) => z.string().trim().max(n);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const npcProfileSchema = z
  .object({
    name: text(40).min(1),
    role: text(40).min(1),
    personality: text(500),
    voice: text(160),
    firstPerson: text(30),
    attitude: text(160),
    likes: z.array(text(60)).max(5),
    goal: text(160),
    color,
    behavior: behaviorSchema,
    speed: z.number().min(20).max(150),
    radius: z.number().min(20).max(200),
    personalSpace: z.number().min(50).max(180),
  })
  .strict();
export const heroSchema = z
  .object({
    name: text(40).min(1),
    title: text(60),
    personality: text(300),
    origin: text(100),
    goal: text(200),
    color,
  })
  .strict();
export const storySchema = z
  .object({ worldName: text(80).min(1), chapterTitle: text(100), intro: text(1200) })
  .strict();
export type NPCProfile = z.infer<typeof npcProfileSchema>;
export type NPC = NPCProfile & {
  id: string;
  x: number;
  y: number;
  version: number;
  memory: string;
  emotion: string;
};
export type Hero = z.infer<typeof heroSchema>;
export type Story = z.infer<typeof storySchema>;
export type Usage = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  unknownCalls: number;
};
export const emptyUsage = (): Usage => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  costMicroUsd: 0,
  unknownCalls: 0,
});
export type Work = {
  id: string;
  ownerId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: ModelKey;
  status: 'ready' | 'active' | 'finished';
  expiresAt: number | null;
  activeSessionHash: string | null;
  npcs: NPC[];
  hero: Hero;
  story: Story;
  talked: string[];
  usage: Record<ModelKey, Usage>;
  attempts: number;
  sessionAttempts: number;
  sessionCostMicroUsd: number;
  pending: null | { requestId: string; until: number };
  generation: number;
};
export type PublicWork = Omit<Work, 'activeSessionHash' | 'pending' | 'ownerId'> & {
  busy: boolean;
};
export function publicWork(work: Work): PublicWork {
  const { activeSessionHash, pending, ownerId, ...rest } = work;
  return { ...rest, busy: pending !== null && pending.until > Date.now() };
}
export type WorkSummary = Pick<
  Work,
  'id' | 'title' | 'createdAt' | 'updatedAt' | 'model' | 'status' | 'expiresAt' | 'usage'
>;
export function summary(w: Work): WorkSummary {
  return {
    id: w.id,
    title: w.title,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    model: w.model,
    status: w.status,
    expiresAt: w.expiresAt,
    usage: w.usage,
  };
}
const seeds: [string, string, number, number, string][] = [
  ['seller', '商人', 145, 155, '#d99b43'],
  ['blacksmith', '鍛冶屋', 295, 155, '#b7774b'],
  ['guard', '門番', 455, 180, '#5c88b5'],
  ['healer', '治療師', 610, 205, '#6caa85'],
  ['scholar', '学者', 765, 150, '#9580b6'],
  ['child', '子ども', 825, 335, '#e2bd4f'],
  ['farmer', '農家', 195, 370, '#95a358'],
  ['traveler', '旅人', 365, 350, '#6f9db6'],
  ['bard', '吟遊詩人', 560, 365, '#c57e96'],
  ['mystic', '占い師', 740, 390, '#8d85b9'],
];
export function initialWork(
  id: string,
  ownerId: string,
  title: string,
  model: ModelKey,
  now: number,
): Work {
  return {
    id,
    ownerId,
    title,
    model,
    createdAt: now,
    updatedAt: now,
    status: 'ready',
    expiresAt: null,
    activeSessionHash: null,
    npcs: seeds.map(([id, role, x, y, color]) => ({
      id,
      role,
      name: role,
      x,
      y,
      color,
      personality: 'おだやかで、話をよく聞く。',
      voice: '自然でわかりやすい日本語',
      firstPerson: '私',
      attitude: '初めて会う冒険者に興味がある',
      likes: [],
      goal: '街で自分の役割を果たす',
      behavior: 'wander',
      speed: 40,
      radius: 55,
      personalSpace: 85,
      version: 0,
      memory: '',
      emotion: 'neutral',
    })),
    hero: {
      name: 'ワタシ',
      title: '見習い冒険者',
      personality: 'まじめ',
      origin: '港町ミナト',
      goal: '星の地図の欠片を集める',
      color: '#4e79bb',
    },
    story: {
      worldName: '星あかりの街',
      chapterTitle: '十人との出会い',
      intro:
        '星の地図を探して、あなたは小さな街にやってきました。\nここには十人の住人が暮らしています。ことばで性格をつくり、会話をしてみましょう。',
    },
    talked: [],
    usage: { nova: emptyUsage(), haiku: emptyUsage() },
    attempts: 0,
    sessionAttempts: 0,
    sessionCostMicroUsd: 0,
    pending: null,
    generation: 0,
  };
}
export const chatInputSchema = z
  .object({
    requestId: z.string().uuid(),
    target: z.string().max(30),
    mode: z.enum(['edit', 'talk']),
    text: text(1200).min(1),
  })
  .strict();
export type ChatInput = z.infer<typeof chatInputSchema>;
export type Turn = {
  requestId: string;
  target: string;
  mode: 'edit' | 'talk';
  text: string;
  reply: string;
  model: ModelKey;
  modelId: string;
  createdAt: number;
  usage: Usage;
  changed: boolean;
  revision: number | null;
};
export function targetSchema(target: string) {
  return target === 'hero' ? heroSchema : target === 'story' ? storySchema : npcProfileSchema;
}
export function outputSchema(target: string, mode: 'edit' | 'talk') {
  return z
    .object({
      reply: text(1800).min(1),
      update: mode === 'talk' ? z.null() : targetSchema(target).partial().nullable(),
      emotion: z.enum(['neutral', 'happy', 'shy', 'worried', 'curious']),
      memory: text(400),
    })
    .strict();
}
export type ModelOutput = {
  reply: string;
  update: Record<string, unknown> | null;
  emotion: string;
  memory: string;
};
export const usd = (micro: number) => (micro / 1_000_000).toFixed(4);
