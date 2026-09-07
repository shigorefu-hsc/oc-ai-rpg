import { useEffect, useRef } from 'react';
import type { PublicWork } from '../shared/domain';
import { stepNPC, Point } from '../shared/motion';
export default function Game({
  work,
  selected,
  onSelect,
  disabled,
}: {
  work: PublicWork;
  selected: string;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  const mount = useRef<HTMLDivElement>(null),
    live = useRef({ work, selected, onSelect, disabled }),
    keys = useRef(new Set<string>());
  live.current = { work, selected, onSelect, disabled };
  useEffect(() => {
    let cancelled = false,
      game: import('phaser').Game | undefined;
    void import('phaser')
      .then(({ default: P }) => {
        if (cancelled || !mount.current) return;
        class Town extends P.Scene {
          private paint!: import('phaser').GameObjects.Graphics;
          private labels = new Map<string, import('phaser').GameObjects.Text>();
          private positions = new Map<string, Point>();
          private wander = new Map<string, Point>();
          private hero: Point = { x: 450, y: 450 };
          private destination: Point | null = null;
          private nextRoam = 0;
          create() {
            this.paint = this.add.graphics();
            for (const n of live.current.work.npcs) {
              this.positions.set(n.id, { x: n.x, y: n.y });
              this.labels.set(
                n.id,
                this.add
                  .text(n.x, n.y + 22, n.name, {
                    fontFamily: 'sans-serif',
                    fontSize: '13px',
                    color: '#f2f4dc',
                    backgroundColor: '#243a30',
                    padding: { x: 5, y: 3 },
                  })
                  .setOrigin(0.5, 0),
              );
            }
            this.labels.set(
              'hero',
              this.add
                .text(this.hero.x, this.hero.y + 24, live.current.work.hero.name, {
                  fontFamily: 'sans-serif',
                  fontSize: '13px',
                  color: '#ffffff',
                  backgroundColor: '#304d43',
                  padding: { x: 5, y: 3 },
                })
                .setOrigin(0.5, 0),
            );
            this.input.on('pointerdown', (pointer: import('phaser').Input.Pointer) => {
              if (live.current.disabled) return;
              mount.current?.focus();
              const point = { x: pointer.worldX, y: pointer.worldY };
              const near = [...this.positions].find(
                ([, p]) => Math.hypot(p.x - point.x, p.y - point.y) < 27,
              );
              if (near) live.current.onSelect(near[0]);
              else
                this.destination = {
                  x: Math.max(30, Math.min(870, point.x)),
                  y: Math.max(65, Math.min(480, point.y)),
                };
            });
          }
          update(time: number, delta: number) {
            if (!this.paint) return;
            const state = live.current,
              dt = Math.min(delta / 1000, 0.05);
            if (!state.disabled) {
              let dx = 0,
                dy = 0;
              const held = keys.current;
              if (held.has('arrowleft') || held.has('a')) dx--;
              if (held.has('arrowright') || held.has('d')) dx++;
              if (held.has('arrowup') || held.has('w')) dy--;
              if (held.has('arrowdown') || held.has('s')) dy++;
              if (dx || dy) {
                this.destination = null;
                const l = Math.hypot(dx, dy);
                this.hero.x += (dx / l) * 140 * dt;
                this.hero.y += (dy / l) * 140 * dt;
              } else if (this.destination) {
                const x = this.destination.x - this.hero.x,
                  y = this.destination.y - this.hero.y,
                  l = Math.hypot(x, y);
                if (l < 3) this.destination = null;
                else {
                  const step = Math.min(l, 140 * dt);
                  this.hero.x += (x / l) * step;
                  this.hero.y += (y / l) * step;
                }
              }
              this.hero.x = P.Math.Clamp(this.hero.x, 30, 870);
              this.hero.y = P.Math.Clamp(this.hero.y, 65, 480);
              if (time > this.nextRoam) {
                this.nextRoam = time + 3500;
                for (const n of state.work.npcs) {
                  const angle = Math.random() * Math.PI * 2,
                    r = Math.random() * n.radius;
                  this.wander.set(n.id, {
                    x: n.x + Math.cos(angle) * r,
                    y: n.y + Math.sin(angle) * r,
                  });
                }
              }
              for (const n of state.work.npcs)
                this.positions.set(
                  n.id,
                  stepNPC(n, this.positions.get(n.id)!, this.hero, this.wander.get(n.id) ?? n, dt),
                );
            }
            const g = this.paint;
            g.clear();
            g.fillStyle(0x233c32);
            g.fillRect(0, 0, 900, 520);
            g.fillStyle(0x2c493b);
            g.fillRoundedRect(20, 54, 860, 440, 18);
            g.fillStyle(0x82785a);
            g.fillRoundedRect(48, 245, 805, 55, 10);
            g.fillRoundedRect(418, 66, 62, 425, 10);
            g.fillStyle(0x988766, 0.36);
            for (let i = 0; i < 45; i++) g.fillRect(60 + i * 18, 256 + (i % 3) * 12, 9, 4);
            const house = (x: number, y: number, c: number) => {
              g.fillStyle(0x192e27, 0.3);
              g.fillRoundedRect(x + 6, y + 5, 88, 64, 5);
              g.fillStyle(c);
              g.fillRoundedRect(x, y, 85, 65, 4);
              g.fillStyle(0x24372c);
              g.fillTriangle(x - 8, y + 7, x + 42, y - 27, x + 94, y + 7);
              g.fillStyle(0xe0c78b);
              g.fillRect(x + 15, y + 24, 16, 18);
              g.fillStyle(0x354332);
              g.fillRect(x + 51, y + 32, 19, 33);
            };
            house(68, 75, 0x856f51);
            house(248, 73, 0x796a57);
            house(550, 78, 0x716f52);
            house(725, 73, 0x716659);
            house(88, 400, 0x777051);
            house(555, 416, 0x736752);
            for (const [x, y] of [
              [30, 130],
              [35, 360],
              [875, 100],
              [868, 432],
              [336, 444],
              [520, 87],
              [675, 472],
              [390, 100],
            ]) {
              g.fillStyle(0x66583d);
              g.fillRect(x - 4, y, 8, 27);
              g.fillStyle(0x345d45);
              g.fillCircle(x, y - 7, 23);
              g.fillStyle(0x426e4d);
              g.fillCircle(x - 5, y - 16, 18);
            }
            g.fillStyle(0x737f76);
            g.fillEllipse(450, 272, 86, 50);
            g.fillStyle(0x77a5a0);
            g.fillEllipse(450, 267, 72, 33);
            g.fillStyle(0xc3c9ac);
            g.fillCircle(450, 258, 10);
            for (const n of state.work.npcs) {
              const p = this.positions.get(n.id)!;
              const chosen = n.id === state.selected;
              if (chosen) {
                g.lineStyle(2, 0xe4c888, 0.9);
                g.strokeEllipse(p.x, p.y + 9, 43, 24);
              }
              g.fillStyle(0x102b21, 0.45);
              g.fillEllipse(p.x, p.y + 14, 25, 11);
              g.fillStyle(parseInt(n.color.slice(1), 16));
              g.fillRoundedRect(p.x - 10, p.y - 1, 20, 20, 5);
              g.fillStyle(0xefcca1);
              g.fillCircle(p.x, p.y - 9, 9);
              g.fillStyle(0x273d31);
              g.fillRect(p.x - 5, p.y - 10, 2, 3);
              g.fillRect(p.x + 3, p.y - 10, 2, 3);
              if (state.work.talked.includes(n.id)) {
                g.fillStyle(0xe2c979);
                g.fillCircle(p.x + 14, p.y - 17, 3);
              }
              this.labels
                .get(n.id)!
                .setPosition(p.x, p.y + 24)
                .setText(n.name);
            }
            const p = this.hero;
            g.fillStyle(0x122b24, 0.4);
            g.fillEllipse(p.x, p.y + 16, 29, 12);
            g.fillStyle(parseInt(state.work.hero.color.slice(1), 16));
            g.fillRoundedRect(p.x - 11, p.y - 1, 22, 23, 4);
            g.fillStyle(0xf3d5ae);
            g.fillCircle(p.x, p.y - 10, 10);
            g.fillStyle(0xf1dfa6);
            g.fillTriangle(p.x - 10, p.y - 15, p.x, p.y - 29, p.x + 11, p.y - 15);
            this.labels
              .get('hero')!
              .setPosition(p.x, p.y + 27)
              .setText(state.work.hero.name);
          }
        }
        game = new P.Game({
          type: P.AUTO,
          parent: mount.current,
          width: 900,
          height: 520,
          backgroundColor: '#233c32',
          scene: Town,
          scale: { mode: P.Scale.FIT, autoCenter: P.Scale.CENTER_BOTH },
          render: { antialias: true },
          audio: { noAudio: true },
          banner: false,
        });
      })
      .catch(() => {
        if (mount.current)
          mount.current.textContent = 'ゲーム画面を読み込めませんでした。画面を更新してください。';
      });
    return () => {
      cancelled = true;
      keys.current.clear();
      game?.destroy(true);
    };
  }, [work.id]);
  return (
    <div
      className="game-canvas"
      ref={mount}
      tabIndex={0}
      role="application"
      aria-label="街のゲーム。クリックで移動。矢印キー・WASDでも移動できます。住人をクリックして選択。"
      onKeyDown={(e) => {
        const k = e.key.toLowerCase();
        if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'].includes(k)) {
          e.preventDefault();
          keys.current.add(k);
        }
      }}
      onKeyUp={(e) => keys.current.delete(e.key.toLowerCase())}
      onBlur={() => keys.current.clear()}
    />
  );
}
