import test from 'node:test';
import assert from 'node:assert/strict';
import { stepNPC } from '../shared/motion';
const npc = {
  x: 100,
  y: 100,
  speed: 100,
  radius: 60,
  personalSpace: 60,
  behavior: 'wander' as const,
};
test('behavior settings cause distinct bounded movement', () => {
  const p = { x: 100, y: 100 },
    hero = { x: 200, y: 100 },
    wander = { x: 100, y: 200 };
  assert.deepEqual(stepNPC({ ...npc, behavior: 'idle' }, p, hero, wander, 0.05), p);
  assert.equal(stepNPC(npc, p, hero, wander, 0.05).y, 105);
  assert.equal(stepNPC({ ...npc, behavior: 'approach' }, p, hero, wander, 0.05).x, 105);
  assert.equal(stepNPC({ ...npc, behavior: 'avoid' }, p, hero, wander, 0.05).x, 95);
  assert.equal(stepNPC({ ...npc, behavior: 'follow' }, p, { x: 800, y: 100 }, wander, 0.05).x, 105);
  assert.equal(
    stepNPC({ ...npc, behavior: 'approach' }, p, { x: 800, y: 100 }, wander, 0.05).x,
    100,
  );
  assert.ok(
    stepNPC({ ...npc, behavior: 'avoid' }, { x: 30, y: 100 }, { x: 60, y: 100 }, wander, 0.05).x >=
      30,
  );
});
