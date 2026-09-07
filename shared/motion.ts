import type { NPC } from './domain';
export type Point = { x: number; y: number };
export function stepNPC(
  npc: Pick<NPC, 'behavior' | 'speed' | 'radius' | 'personalSpace' | 'x' | 'y'>,
  position: Point,
  hero: Point,
  wander: Point,
  seconds: number,
): Point {
  const dx = hero.x - position.x,
    dy = hero.y - position.y,
    distance = Math.hypot(dx, dy);
  let target: Point = position;
  if (npc.behavior === 'wander') target = wander;
  if (npc.behavior === 'follow' && distance > npc.personalSpace) target = hero;
  if (npc.behavior === 'approach' && distance < npc.radius + 150 && distance > npc.personalSpace)
    target = hero;
  if (npc.behavior === 'avoid' && distance < npc.personalSpace + 80) {
    const angle =
      distance < 0.1 ? Math.atan2(position.y - npc.y, position.x - npc.x) || 0 : Math.atan2(dy, dx);
    target = { x: position.x - Math.cos(angle) * 150, y: position.y - Math.sin(angle) * 150 };
  }
  const tx = target.x - position.x,
    ty = target.y - position.y,
    len = Math.hypot(tx, ty),
    step = Math.min(len, npc.speed * Math.min(seconds, 0.05));
  if (len < 1) return position;
  return {
    x: Math.max(30, Math.min(870, position.x + (tx / len) * step)),
    y: Math.max(65, Math.min(480, position.y + (ty / len) * step)),
  };
}
