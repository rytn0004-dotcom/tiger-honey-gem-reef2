import { useEffect, useRef, useState } from "react";
import { CELL, COLS, findPath, GOAL, pointsOf, ROWS, SPAWN, cellKey } from "./grid";
import { ENEMY_TYPES, TOWERS, type Special, type TowerDef } from "./types";

const W = COLS * CELL;
const H = ROWS * CELL;
const GRID = CELL;
const MAX_WAVE = 20;
const STAKE_COST = 40;

type Seg = { ax: number; ay: number; bx: number; by: number; len: number; start: number };
const live = {
  pts: [] as { x: number; y: number }[],
  segs: [] as Seg[],
  len: 1,
};

function loadRoute(pts: { x: number; y: number }[]) {
  const segs: Seg[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, len, start: total });
    total += len;
  }
  live.pts = pts;
  live.segs = segs;
  live.len = Math.max(1, total);
}

function posAt(dist: number) {
  const d = Math.max(0, Math.min(live.len, dist));
  for (const s of live.segs) {
    if (d <= s.start + s.len) {
      const t = s.len === 0 ? 0 : (d - s.start) / s.len;
      return { x: s.ax + (s.bx - s.ax) * t, y: s.ay + (s.by - s.ay) * t };
    }
  }
  const last = live.pts[live.pts.length - 1] ?? { x: 0, y: 0 };
  return { x: last.x, y: last.y };
}

function projectDist(x: number, y: number) {
  let best = 0;
  let bd = 1e9;
  for (let d = 0; d <= live.len; d += 10) {
    const p = posAt(d);
    const dd = Math.hypot(p.x - x, p.y - y);
    if (dd < bd) {
      bd = dd;
      best = d;
    }
  }
  return best;
}

loadRoute(pointsOf(findPath(new Set())!));

type Enemy = {
  type: number;
  dist: number;
  hp: number;
  maxHp: number;
  speed: number;
  gold: number;
  slow: number;
  slowT: number;
  burn: number;
  burnT: number;
  rootT: number;
  vuln: number;
  vulnT: number;
  r: number;
  color: string;
  phase: number;
  hurt: number;
  face: number;
  melee: boolean;
  atk: number;
};

type Tower = {
  def: number;
  x: number;
  y: number;
  damage: number;
  cooldown: number;
  range: number;
  cd: number;
  level: number;
  aim: number;
  recoil: number;
  hp: number;
  maxHp: number;
  shake: number;
  stake: boolean;
  gx: number;
  gy: number;
};

type Shot = {
  x: number;
  y: number;
  tx: number;
  ty: number;
  speed: number;
  damage: number;
  special: Special;
  color: string;
  life: number;
  pierced: Set<Enemy>;
  target: Enemy | null;
};

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
type Floater = { x: number; y: number; text: string; color: string; life: number };
type Ring = { x: number; y: number; r: number; max: number; color: string; life: number };
type Pop = { x: number; y: number; age: number; scale: number };

const SPRITE_SETS = {
  imp: [0, 1, 2, 3].map((i) => `/anim/imp/${i}.png`),
  brute: [0, 1, 2, 3].map((i) => `/anim/brute/${i}.png`),
  boss: [0, 1, 2, 3].map((i) => `/anim/boss/${i}.png`),
  king: [0, 1].map((i) => `/anim/king/${i}.png`),
  bolt: [0, 1, 2, 3].map((i) => `/anim/bolt/${i}.png`),
  hit: [0, 1, 2, 3].map((i) => `/anim/hit/${i}.png`),
};

const TOWER_ANIMS: string[][] = TOWERS.map((_, i) =>
  i < 5 ? [0, 1, 2, 3, 4, 5, 6, 7].map((n) => `/anim/towers/t${String(i + 1).padStart(2, "0")}/${n}.jpg`) : [],
);

function pingIndex(count: number, step: number) {
  if (count <= 1) return 0;
  const span = count * 2 - 2;
  const k = ((step % span) + span) % span;
  return k < count ? k : span - k;
}

function AlivePortrait({ frames }: { frames: string[] }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setStep((n) => n + 1), 130);
    return () => window.clearInterval(id);
  }, []);
  return <img src={frames[pingIndex(frames.length, step)] ?? frames[0]} alt="" />;
}

type Phase = "ready" | "play" | "win" | "lose";

function spawnPlan(wave: number) {
  const list: { type: number; at: number }[] = [];
  const count = 6 + wave * 2;
  const base = Math.min(ENEMY_TYPES.length - 2, Math.floor((wave - 1) / 2));
  let t = 0.4;
  for (let i = 0; i < count; i++) {
    let type = base;
    if (Math.random() < 0.22 && type > 0) type -= 1;
    if (Math.random() < 0.18 + wave * 0.02) type = Math.min(ENEMY_TYPES.length - 2, type + 1);
    list.push({ type, at: t });
    t += Math.max(0.28, 0.72 - wave * 0.03);
  }
  if (wave % 5 === 0) {
    list.push({ type: 6, at: t + 0.4 });
    list.push({ type: 6, at: t + 1.0 });
  }
  if (wave % 4 === 0) {
    list.push({ type: Math.min(5, 2 + Math.floor(wave / 4)), at: t + 0.6 });
  }
  return list;
}

export function FoxTD() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [gold, setGold] = useState(180);
  const [lives, setLives] = useState(20);
  const [wave, setWave] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [pick, setPick] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [hover, setHover] = useState("");
  const [speed, setSpeed] = useState(1);
  const [endless, setEndless] = useState(false);
  const [staking, setStaking] = useState(false);
  const [workshop, setWorkshop] = useState(false);
  const [paused, setPaused] = useState(false);
  const goldRef = useRef(180);
  const livesRef = useRef(20);
  const phaseRef = useRef<Phase>("ready");
  const pickRef = useRef<number | null>(null);
  const selRef = useRef<number | null>(null);
  const speedRef = useRef(1);
  const endlessRef = useRef(false);
  const stakeRef = useRef(false);
  const workshopRef = useRef(false);
  const pausedRef = useRef(false);
  const mapRef = useRef(new Set<string>());

  useEffect(() => {
    goldRef.current = gold;
  }, [gold]);
  useEffect(() => {
    livesRef.current = lives;
  }, [lives]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    pickRef.current = pick;
  }, [pick]);
  useEffect(() => {
    selRef.current = sel;
  }, [sel]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    endlessRef.current = endless;
  }, [endless]);
  useEffect(() => {
    stakeRef.current = staking;
  }, [staking]);
  useEffect(() => {
    workshopRef.current = workshop;
  }, [workshop]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const sim = useRef({
    towers: [] as Tower[],
    enemies: [] as Enemy[],
    shots: [] as Shot[],
    parts: [] as Particle[],
    floats: [] as Floater[],
    rings: [] as Ring[],
    pops: [] as Pop[],
    queue: [] as { type: number; at: number }[],
    clock: 0,
    between: 0,
    wave: 0,
    images: [] as HTMLImageElement[],
    towerFrames: [] as HTMLImageElement[][],
    sheets: {} as Record<string, HTMLImageElement[]>,
    scene: {} as Record<string, HTMLImageElement>,
    pointer: { x: 0, y: 0, down: false },
    blocked: new Set<string>(),
  });

  useEffect(() => {
    const imgs = TOWERS.map((t) => {
      const img = new Image();
      img.src = t.img;
      return img;
    });
    sim.current.images = imgs;
    sim.current.towerFrames = TOWER_ANIMS.map((urls) =>
      urls.map((src) => {
        const img = new Image();
        img.src = src;
        return img;
      }),
    );
    const sheets: Record<string, HTMLImageElement[]> = {};
    for (const [key, urls] of Object.entries(SPRITE_SETS)) {
      sheets[key] = urls.map((src) => {
        const img = new Image();
        img.src = src;
        return img;
      });
    }
    sim.current.sheets = sheets;
    const scene: Record<string, HTMLImageElement> = {};
    for (const [key, src] of Object.entries({
      bg: "/scene/bg.jpg",
      coral: "/scene/coral.png",
      pillar: "/scene/pillar.png",
    })) {
      const img = new Image();
      img.src = src;
      scene[key] = img;
    }
    sim.current.scene = scene;

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let hudAcc = 0;

    const burst = (x: number, y: number, color: string, n: number, spd = 2) => {
      for (let i = 0; i < n; i++) {
        sim.current.parts.push({
          x,
          y,
          vx: (Math.random() - 0.5) * spd * 2,
          vy: (Math.random() - 0.5) * spd * 2 - 0.4,
          life: 0.45 + Math.random() * 0.35,
          max: 0.8,
          color,
          size: 2 + Math.random() * 3,
        });
      }
    };
    const float = (x: number, y: number, text: string, color: string) => {
      sim.current.floats.push({ x, y, text, color, life: 0.8 });
    };

    const applyStatus = (e: Enemy, special: Special, dmg: number) => {
      if (special === "slow" || special === "ultimate" || special === "root") {
        e.slow = special === "root" ? 0.22 : special === "ultimate" ? 0.5 : 0.55;
        e.slowT = special === "root" ? 2.2 : 2.4;
      }
      if (special === "root") e.rootT = Math.max(e.rootT, 0.55);
      if (special === "burn" || special === "ultimate") {
        e.burn = special === "ultimate" ? 16 : 9;
        e.burnT = 3;
      }
      if (special === "break") {
        e.vuln = 1.4;
        e.vulnT = 3.2;
      }
      if (special === "execute" && e.hp > 0 && e.hp < e.maxHp * 0.18) {
        e.hp = 0;
      }
    };

    const hitEnemy = (e: Enemy, dmg: number, special: Special, color: string, px: number, py: number) => {
      const amount = dmg * (e.vulnT > 0 ? e.vuln : 1);
      e.hp -= amount;
      float(px, py - 16, String(Math.round(amount)), "#fff");
      applyStatus(e, special, dmg);
      burst(px, py, color, 6, 1.6);
      e.hurt = 0.22;
      sim.current.pops.push({ x: px, y: py, age: 0, scale: special === "aoe" || special === "ultimate" ? 1.35 : 0.85 });
      if (special === "aoe" || special === "ultimate") {
        sim.current.rings.push({ x: px, y: py, r: 8, max: special === "ultimate" ? 96 : 74, color, life: 0.28 });
        for (const o of sim.current.enemies) {
          if (o === e) continue;
          const p = posAt(o.dist);
          if (Math.hypot(p.x - px, p.y - py) < (special === "ultimate" ? 92 : 70)) {
            o.hp -= amount * 0.65;
            applyStatus(o, special, dmg * 0.65);
          }
        }
      }
      if (special === "chain") {
        const p0 = posAt(e.dist);
        const near = sim.current.enemies
          .filter((o) => o !== e)
          .map((o) => ({ o, d: Math.hypot(posAt(o.dist).x - p0.x, posAt(o.dist).y - p0.y) }))
          .filter((x) => x.d < 110)
          .sort((a, b) => a.d - b.d)
          .slice(0, 3);
        for (const n of near) {
          n.o.hp -= dmg * 0.55;
          const np = posAt(n.o.dist);
          burst(np.x, np.y, "#8ef0ff", 4, 1.2);
        }
      }
    };

    const fire = (tw: Tower, target: Enemy) => {
      const def = TOWERS[tw.def];
      const p = posAt(target.dist);
      if (def.special === "pierce") {
        const ang = Math.atan2(p.y - tw.y, p.x - tw.x);
        sim.current.shots.push({
          x: tw.x,
          y: tw.y,
          tx: tw.x + Math.cos(ang) * 900,
          ty: tw.y + Math.sin(ang) * 900,
          speed: 520,
          damage: tw.damage,
          special: def.special,
          color: def.color,
          life: 1.1,
          pierced: new Set(),
          target: null,
        });
      } else {
        sim.current.shots.push({
          x: tw.x,
          y: tw.y,
          tx: p.x,
          ty: p.y,
          speed: 460,
          damage: tw.damage,
          special: def.special,
          color: def.color,
          life: 1.6,
          pierced: new Set(),
          target,
        });
      }
      burst(tw.x, tw.y, def.color, 4, 1.4);
      tw.recoil = 0.22;
      tw.aim = Math.atan2(p.y - tw.y, p.x - tw.x);
      sim.current.pops.push({
        x: tw.x + Math.cos(tw.aim) * 28,
        y: tw.y + Math.sin(tw.aim) * 28,
        age: 0,
        scale: 0.45,
      });
    };

    const step = (dt: number) => {
      const s = sim.current;
      if (phaseRef.current !== "play" || pausedRef.current) return;
      s.clock += dt;

      if (s.queue.length) {
        while (s.queue.length && s.clock >= s.queue[0].at) {
          const job = s.queue.shift()!;
          const et = ENEMY_TYPES[job.type];
          const scale = 1 + (s.wave - 1) * 0.16;
          s.enemies.push({
            type: job.type,
            dist: 0,
            hp: et.hp * scale,
            maxHp: et.hp * scale,
            speed: et.speed * (0.96 + Math.random() * 0.08),
            gold: Math.round(et.gold * (1 + s.wave * 0.14) * (1 + job.type * 0.12)),
            slow: 1,
            slowT: 0,
            burn: 0,
            burnT: 0,
            rootT: 0,
            vuln: 1,
            vulnT: 0,
            r: et.r,
            color: et.color,
            phase: Math.random() * 4,
            hurt: 0,
            face: 1,
            melee: et.melee,
            atk: 0.4,
          });
        }
      } else if (s.enemies.length === 0 && s.wave > 0) {
        s.between += dt;
        if (s.wave >= MAX_WAVE && !endlessRef.current) {
          phaseRef.current = "win";
          setPhase("win");
        } else if (s.between > (endlessRef.current ? 4 : 7)) {
          beginWave();
        }
      }

      for (let i = s.enemies.length - 1; i >= 0; i--) {
        const e = s.enemies[i];
        if (e.rootT > 0) e.rootT -= dt;
        if (e.slowT > 0) e.slowT -= dt;
        else e.slow = 1;
        if (e.vulnT > 0) e.vulnT -= dt;
        if (e.burnT > 0) {
          e.burnT -= dt;
          e.hp -= e.burn * dt;
          if (Math.random() < 0.35) {
            const p = posAt(e.dist);
            burst(p.x, p.y, "#ff6a2a", 1, 0.8);
          }
        }
        if (e.hurt > 0) e.hurt -= dt;
        let biting = false;
        if (e.melee && e.rootT <= 0) {
          const p = posAt(e.dist);
          let near: Tower | null = null;
          let nd = 48;
          for (const tw of s.towers) {
            if (tw.stake) continue;
            const d = Math.hypot(tw.x - p.x, tw.y - p.y);
            if (d < nd) {
              nd = d;
              near = tw;
            }
          }
          if (near) {
            biting = true;
            e.face = near.x >= p.x ? 1 : -1;
            e.atk -= dt;
            if (e.atk <= 0) {
              e.atk = 0.7;
              near.hp -= 14;
              near.shake = 0.18;
              burst(near.x, near.y, "#ffb4c8", 6, 1.6);
              if (near.hp <= 0) {
                const idx = s.towers.indexOf(near);
                if (idx >= 0) s.towers.splice(idx, 1);
                float(near.x, near.y, "塔被拆毀", "#ff8aa0");
              }
            }
          }
        }
        if (!biting && e.rootT <= 0) {
          const spd = e.speed * (e.slowT > 0 ? e.slow : 1);
          e.dist += spd * dt;
        }
        if (e.dist >= live.len) {
          livesRef.current -= 1;
          setLives(livesRef.current);
          s.enemies.splice(i, 1);
          if (livesRef.current <= 0) {
            phaseRef.current = "lose";
            setPhase("lose");
          }
          continue;
        }
        if (e.hp <= 0) {
          goldRef.current += e.gold;
          setGold(goldRef.current);
          const p = posAt(e.dist);
          float(p.x, p.y, `+${e.gold}`, "#ffd27a");
          burst(p.x, p.y, e.color, 12, 2.4);
          s.enemies.splice(i, 1);
        }
      }

      for (const tw of s.towers) {
        tw.cd -= dt;
        let best: Enemy | null = null;
        let bestDist = -1;
        for (const e of s.enemies) {
          const p = posAt(e.dist);
          const d = Math.hypot(p.x - tw.x, p.y - tw.y);
          if (d <= tw.range && e.dist > bestDist) {
            bestDist = e.dist;
            best = e;
          }
        }
        if (best && tw.cd <= 0) {
          tw.cd = tw.cooldown;
          fire(tw, best);
        } else if (best) {
          const p = posAt(best.dist);
          tw.aim = Math.atan2(p.y - tw.y, p.x - tw.x);
        }
        if (tw.recoil > 0) tw.recoil -= dt;
        if (tw.shake > 0) tw.shake -= dt;
      }

      for (let i = s.shots.length - 1; i >= 0; i--) {
        const sh = s.shots[i];
        sh.life -= dt;
        if (sh.special !== "pierce" && sh.target && s.enemies.includes(sh.target)) {
          const p = posAt(sh.target.dist);
          sh.tx = p.x;
          sh.ty = p.y;
        }
        const dx = sh.tx - sh.x;
        const dy = sh.ty - sh.y;
        const dist = Math.hypot(dx, dy) || 1;
        const stepLen = sh.speed * dt;
        sh.x += (dx / dist) * stepLen;
        sh.y += (dy / dist) * stepLen;
        if (Math.random() < 0.7) burst(sh.x, sh.y, sh.color, 1, 0.4);

        if (sh.special === "pierce") {
          for (const e of s.enemies) {
            if (sh.pierced.has(e)) continue;
            const p = posAt(e.dist);
            if (Math.hypot(p.x - sh.x, p.y - sh.y) < e.r + 10) {
              sh.pierced.add(e);
              hitEnemy(e, sh.damage, sh.special, sh.color, p.x, p.y);
            }
          }
          if (sh.life <= 0 || dist < stepLen) s.shots.splice(i, 1);
        } else if (dist < 14 || sh.life <= 0) {
          const victims: Enemy[] = [];
          if (sh.target && s.enemies.includes(sh.target)) victims.push(sh.target);
          else {
            let near: Enemy | null = null;
            let nd = 36;
            for (const e of s.enemies) {
              const p = posAt(e.dist);
              const dd = Math.hypot(p.x - sh.x, p.y - sh.y);
              if (dd < nd) {
                nd = dd;
                near = e;
              }
            }
            if (near) victims.push(near);
          }
          for (const e of victims) {
            const p = posAt(e.dist);
            hitEnemy(e, sh.damage, sh.special, sh.color, p.x, p.y);
          }
          if (!victims.length && (sh.special === "aoe" || sh.special === "ultimate")) {
            hitEnemyArea(sh);
          }
          s.shots.splice(i, 1);
        }
      }

      function hitEnemyArea(sh: Shot) {
        sim.current.rings.push({ x: sh.x, y: sh.y, r: 6, max: 70, color: sh.color, life: 0.25 });
        for (const e of sim.current.enemies) {
          const p = posAt(e.dist);
          if (Math.hypot(p.x - sh.x, p.y - sh.y) < 70) hitEnemy(e, sh.damage, sh.special, sh.color, p.x, p.y);
        }
      }

      for (let i = s.parts.length - 1; i >= 0; i--) {
        const p = s.parts[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= dt;
        if (p.life <= 0) s.parts.splice(i, 1);
      }
      for (let i = s.floats.length - 1; i >= 0; i--) {
        const f = s.floats[i];
        f.y -= 28 * dt;
        f.life -= dt;
        if (f.life <= 0) s.floats.splice(i, 1);
      }
      for (let i = s.rings.length - 1; i >= 0; i--) {
        const r = s.rings[i];
        r.life -= dt;
        r.r += (r.max - r.r) * Math.min(1, dt * 8);
        if (r.life <= 0) s.rings.splice(i, 1);
      }
      for (let i = s.pops.length - 1; i >= 0; i--) {
        s.pops[i].age += dt;
        if (s.pops[i].age > 0.28) s.pops.splice(i, 1);
      }

      hudAcc += dt;
      if (hudAcc > 0.25) hudAcc = 0;
    };

    const beginWave = () => {
      const s = sim.current;
      if (!endlessRef.current && s.wave >= MAX_WAVE) return;
      if (s.queue.length || s.enemies.length) return;
      s.wave += 1;
      s.clock = 0;
      s.between = 0;
      s.queue = spawnPlan(s.wave);
      setWave(s.wave);
    };
    (canvas as HTMLCanvasElement & { __begin?: () => void }).__begin = beginWave;
    (window as unknown as { __fox?: typeof sim.current }).__fox = sim.current;

    const draw = () => {
      const s = sim.current;
      ctx.clearRect(0, 0, W, H);
      const bg = s.scene.bg;
      if (bg && bg.complete && bg.naturalWidth) {
        ctx.drawImage(bg, 0, 0, W, H);
      } else {
        ctx.fillStyle = "#0c2742";
        ctx.fillRect(0, 0, W, H);
      }
      ctx.fillStyle = "rgba(4, 14, 28, 0.28)";
      ctx.fillRect(0, 0, W, H);

      const t = performance.now() / 1000;
      const decor: { key: string; x: number; y: number; w: number; h: number }[] = [
        { key: "coral", x: 40, y: 430, w: 120, h: 120 },
        { key: "pillar", x: 250, y: 40, w: 90, h: 150 },
        { key: "coral", x: 700, y: 40, w: 130, h: 110 },
        { key: "pillar", x: 470, y: 250, w: 78, h: 140 },
        { key: "coral", x: 860, y: 300, w: 110, h: 120 },
      ];
      for (const d of decor) {
        const img = s.scene[d.key];
        if (!img || !img.complete || !img.naturalWidth) continue;
        const bob = Math.sin(t * 1.3 + d.x) * 3;
        ctx.globalAlpha = 0.9;
        ctx.drawImage(img, d.x, d.y + bob, d.w, d.h);
        ctx.globalAlpha = 1;
      }

      ctx.strokeStyle = "rgba(180,230,255,0.08)";
      ctx.lineWidth = 1;
      if (pickRef.current !== null) {
        for (let x = 0; x <= W; x += GRID) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
        }
        for (let y = 0; y <= H; y += GRID) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y);
          ctx.stroke();
        }
      }

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(255,236,190,0.28)";
      ctx.lineWidth = 36;
      ctx.beginPath();
      if (live.pts.length) {
        ctx.moveTo(live.pts[0].x, live.pts[0].y);
        for (let i = 1; i < live.pts.length; i++) ctx.lineTo(live.pts[i].x, live.pts[i].y);
      }
      ctx.stroke();
      ctx.strokeStyle = "rgba(120,210,255,0.22)";
      ctx.lineWidth = 16;
      ctx.stroke();

      ctx.fillStyle = "rgba(210,245,255,0.35)";
      for (let i = 0; i < 22; i++) {
        const bx = (i * 137 + t * 22) % W;
        const by = (H - ((i * 90 + t * 36) % (H + 40)));
        ctx.beginPath();
        ctx.arc(bx, by, 2 + (i % 4), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 18;
      for (let i = 0; i < 4; i++) {
        const x = 80 + i * 230 + Math.sin(t * 0.4 + i) * 12;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 30, H);
        ctx.stroke();
      }

      if (pickRef.current !== null && !stakeRef.current && phaseRef.current === "play") {
        const def = TOWERS[pickRef.current];
        const gx = Math.floor(s.pointer.x / GRID);
        const gy = Math.floor(s.pointer.y / GRID);
        const px = gx * GRID + GRID / 2;
        const py = gy * GRID + GRID / 2;
        const ok = canPlace(gx, gy);
        ctx.beginPath();
        ctx.arc(px, py, def.range, 0, Math.PI * 2);
        ctx.fillStyle = ok ? "rgba(120,200,255,0.1)" : "rgba(255,80,80,0.12)";
        ctx.fill();
        ctx.strokeStyle = ok ? "rgba(140,210,255,0.55)" : "rgba(255,90,90,0.6)";
        ctx.stroke();
      }

      for (const key of s.blocked) {
        const [c, r] = key.split(",").map(Number);
        ctx.fillStyle = "rgba(18, 14, 28, 0.72)";
        ctx.fillRect(c * CELL + 4, r * CELL + 4, CELL - 8, CELL - 8);
        ctx.strokeStyle = "rgba(255, 196, 150, 0.55)";
        ctx.strokeRect(c * CELL + 4, r * CELL + 4, CELL - 8, CELL - 8);
      }
      ctx.font = "bold 12px sans-serif";
      ctx.fillStyle = "#b7ecff";
      ctx.fillText("入口", SPAWN.c * CELL + 4, SPAWN.r * CELL + 24);
      ctx.fillStyle = "#ffc0d4";
      ctx.fillText("終點", GOAL.c * CELL + 2, GOAL.r * CELL + 24);

      if (selRef.current !== null && s.towers[selRef.current]) {
        const tw = s.towers[selRef.current];
        ctx.beginPath();
        ctx.arc(tw.x, tw.y, tw.range, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,170,210,0.08)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,170,210,0.45)";
        ctx.stroke();
      }

      for (let i = 0; i < s.towers.length; i++) {
        const tw = s.towers[i];
        if (tw.stake) {
          const img = s.scene.pillar;
          const bob = Math.sin(t * 2 + i) * 2;
          if (img && img.complete && img.naturalWidth) ctx.drawImage(img, tw.x - 16, tw.y - 28 + bob, 32, 48);
          else {
            ctx.fillStyle = "#d7c4a8";
            ctx.fillRect(tw.x - 8, tw.y - 16, 16, 32);
          }
          continue;
        }
        const def = TOWERS[tw.def];
        const frames = s.towerFrames[tw.def] || [];
        const hasAnim = frames.length > 1;
        const bob = Math.sin(t * (hasAnim ? 2.2 : 2.8) + i) * (hasAnim ? 2.5 : 5);
        const kick = tw.recoil > 0 ? tw.recoil / 0.22 : 0;
        const sh = tw.shake > 0 ? (Math.random() - 0.5) * 8 : 0;
        const ox = Math.cos(tw.aim || 0) * kick * 10 + sh;
        const oy = Math.sin(tw.aim || 0) * kick * 10;
        const breathe = hasAnim ? 1 : 1 + Math.sin(t * 2.4 + i) * 0.05;
        ctx.save();
        ctx.translate(tw.x + ox, tw.y + bob + oy);
        ctx.rotate(Math.sin(t * 1.5 + i * 0.7) * (hasAnim ? 0.03 : 0.07));
        ctx.scale((1 + kick * 0.12) * breathe, (1 - kick * 0.08) * (2 - breathe));
        ctx.beginPath();
        ctx.ellipse(0, 22, 18, 6, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, 26, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(8,20,36,0.88)";
        ctx.fill();
        ctx.strokeStyle = def.color;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        let img = s.images[tw.def];
        if (hasAnim) {
          const idx = pingIndex(frames.length, Math.floor(t * (tw.recoil > 0 ? 14 : 6) + i));
          const fr = frames[idx];
          if (fr && fr.complete && fr.naturalWidth) img = fr;
        }
        if (img && img.complete && img.naturalWidth) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(0, 0, 22, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, -22, -22, 44, 44);
          ctx.restore();
        }
        ctx.restore();
        ctx.save();
        ctx.translate(tw.x + ox, tw.y + bob + oy);
        ctx.rotate(tw.aim || 0);
        ctx.translate(-kick * 14, 0);
        ctx.fillStyle = def.color;
        ctx.fillRect(12, -3, 18, 6);
        ctx.beginPath();
        ctx.arc(30, 0, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (!hasAnim) {
          const motes = def.special === "ultimate" ? 6 : 4;
          for (let k = 0; k < motes; k++) {
            let sx: number;
            let sy: number;
            if (def.special === "burn" || def.special === "ultimate" || def.special === "aoe") {
              const life = (t * 0.55 + k / motes) % 1;
              sx = Math.sin(k * 2.2 + t * 1.4) * 16;
              sy = 18 - life * 48;
            } else {
              const a = t * (def.special === "rapid" ? 2.4 : 1.3) + (k * Math.PI * 2) / motes;
              sx = Math.cos(a) * 30;
              sy = Math.sin(a) * 14;
            }
            ctx.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin(t * 3 + k));
            ctx.fillStyle = def.color;
            ctx.beginPath();
            ctx.arc(tw.x + sx, tw.y + bob + sy, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        if (tw.level > 1) {
          ctx.fillStyle = "#ffd27a";
          ctx.font = "bold 11px sans-serif";
          ctx.fillText("L" + tw.level, tw.x - 8, tw.y + 40);
        }
        if (tw.hp < tw.maxHp) {
          ctx.fillStyle = "#401820";
          ctx.fillRect(tw.x - 16, tw.y + 28, 32, 4);
          ctx.fillStyle = "#ff8aa8";
          ctx.fillRect(tw.x - 16, tw.y + 28, 32 * Math.max(0, tw.hp / tw.maxHp), 4);
        }
      }

      const ready = (img?: HTMLImageElement) => !!img && img.complete && img.naturalWidth > 0;
      for (const e of s.enemies) {
        const p = posAt(e.dist);
        const ahead = posAt(Math.min(live.len, e.dist + 12));
        e.face = ahead.x >= p.x ? 1 : -1;
        const setName = e.type === 5 ? "king" : e.type <= 1 ? "imp" : e.type <= 3 ? "brute" : "boss";
        const frames = s.sheets[setName] || [];
        const n = Math.max(1, frames.length);
        const frame =
          e.type === 5
            ? frames[Math.floor(e.dist / 18) % n]
            : frames[Math.floor(t * 7 + e.dist / 20 + e.phase) % n];
        const size = e.type === 5 ? e.r * 5.1 : e.r * 3.3;
        const stepBob = e.type === 5 ? Math.sin((e.dist / 18) * Math.PI) * 3 : 0;
        const squash = e.hurt > 0 ? 0.68 : 1;
        const knock = e.hurt > 0 ? -e.face * 14 * (e.hurt / 0.22) : 0;
        ctx.save();
        ctx.translate(p.x + knock, p.y + (e.hurt > 0 ? 6 : 0) + stepBob);
        ctx.scale(e.face * (e.melee && e.atk < 0.2 ? 1.12 : 1) * squash, e.rootT > 0 ? 0.9 : 1 / squash);
        const drawY = e.type === 5 ? -size + 8 : -size * 0.72;
        if (ready(frame)) ctx.drawImage(frame, -size / 2, drawY, size, size);
        else {
          ctx.fillStyle = e.color;
          ctx.beginPath();
          ctx.arc(0, 0, e.r, 0, Math.PI * 2);
          ctx.fill();
        }
        if (e.hurt > 0 && ready(frame)) {
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = Math.min(0.9, e.hurt * 4);
          ctx.drawImage(frame, -size / 2, drawY, size, size);
        }
        ctx.restore();
        if (e.slowT > 0) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, e.r + 6, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(120,200,255,0.85)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (e.burnT > 0) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, e.r + 9, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255,110,40,0.75)";
          ctx.stroke();
        }
        if (e.vulnT > 0) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, e.r + 12, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255,220,120,0.7)";
          ctx.stroke();
        }
        const bw = e.r * 2.4;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(p.x - bw / 2, p.y - e.r - 16, bw, 4);
        ctx.fillStyle = e.hp / e.maxHp > 0.35 ? "#7d7" : "#e66";
        ctx.fillRect(p.x - bw / 2, p.y - e.r - 16, bw * Math.max(0, e.hp / e.maxHp), 4);
      }

      const bolt = s.sheets.bolt || [];
      const bframe = bolt[Math.floor(t * 12) % 4];
      for (const sh of s.shots) {
        const ang = Math.atan2(sh.ty - sh.y, sh.tx - sh.x);
        ctx.save();
        ctx.translate(sh.x, sh.y);
        ctx.rotate(ang);
        if (ready(bframe)) ctx.drawImage(bframe, -16, -16, 32, 32);
        else {
          ctx.fillStyle = sh.color;
          ctx.beginPath();
          ctx.arc(0, 0, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      const hits = s.sheets.hit || [];
      for (const pop of s.pops) {
        const idx = Math.min(3, Math.floor((pop.age / 0.28) * 4));
        const fr = hits[idx];
        if (!ready(fr)) continue;
        const sz = 64 * pop.scale;
        ctx.drawImage(fr, pop.x - sz / 2, pop.y - sz / 2, sz, sz);
      }

      for (const r of s.rings) {
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        ctx.strokeStyle = r.color;
        ctx.globalAlpha = Math.max(0, r.life / 0.28);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      for (const p of s.parts) {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.textAlign = "center";
      ctx.font = "bold 13px sans-serif";
      for (const f of s.floats) {
        ctx.globalAlpha = Math.max(0, f.life / 0.8);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y);
        ctx.globalAlpha = 1;
      }
      ctx.textAlign = "left";
    };

    const loop = (now: number) => {
      const raw = Math.min(0.05, (now - last) / 1000);
      last = now;
      let left = raw * speedRef.current;
      while (left > 0.0001) {
        const h = Math.min(0.033, left);
        step(h);
        left -= h;
      }
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const commitBlocks = (next: Set<string>) => {
      const cells = findPath(next);
      if (!cells) return false;
      const marks = sim.current.enemies.map((e) => posAt(e.dist));
      loadRoute(pointsOf(cells));
      sim.current.enemies.forEach((e, i) => {
        e.dist = Math.min(live.len - 0.01, projectDist(marks[i].x, marks[i].y));
      });
      sim.current.blocked = next;
      return true;
    };
    (canvas as HTMLCanvasElement & { __commit?: (n: Set<string>) => boolean }).__commit = commitBlocks;

    const local = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((ev.clientX - rect.left) / rect.width) * W,
        y: ((ev.clientY - rect.top) / rect.height) * H,
      };
    };

    const onMove = (ev: PointerEvent) => {
      sim.current.pointer = { ...local(ev), down: true };
    };
    const onDown = (ev: PointerEvent) => {
      const p = local(ev);
      sim.current.pointer = { ...p, down: true };
      if (phaseRef.current !== "play") {
        if (!workshopRef.current) return;
        const gx = Math.floor(p.x / GRID);
        const gy = Math.floor(p.y / GRID);
        if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) return;
        if ((gx === SPAWN.c && gy === SPAWN.r) || (gx === GOAL.c && gy === GOAL.r)) {
          setHover("出入口不能封");
          return;
        }
        const next = new Set(mapRef.current);
        const k = cellKey(gx, gy);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        if (!commitBlocks(next)) {
          setHover("這會封死路線");
          return;
        }
        mapRef.current = next;
        setHover("工房：再點一下可拆除路障");
        return;
      }
      const s = sim.current;
      for (let i = 0; i < s.towers.length; i++) {
        const tw = s.towers[i];
        if (Math.hypot(tw.x - p.x, tw.y - p.y) < 26) {
          selRef.current = i;
          setSel(i);
          pickRef.current = null;
          setPick(null);
          return;
        }
      }
      const id = pickRef.current;
      const gx = Math.floor(p.x / GRID);
      const gy = Math.floor(p.y / GRID);
      if (stakeRef.current) {
        if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) return;
        if ((gx === SPAWN.c && gy === SPAWN.r) || (gx === GOAL.c && gy === GOAL.r)) {
          setHover("不能堵住出入口");
          return;
        }
        if (s.towers.some((t) => t.gx === gx && t.gy === gy) || s.blocked.has(cellKey(gx, gy))) {
          setHover("這格已經有東西");
          return;
        }
        if (goldRef.current < STAKE_COST) {
          setHover("金幣不夠");
          return;
        }
        const next = new Set(s.blocked);
        next.add(cellKey(gx, gy));
        if (!commitBlocks(next)) {
          setHover("不能完全封死最短路");
          return;
        }
        goldRef.current -= STAKE_COST;
        setGold(goldRef.current);
        s.towers.push({
          def: 0,
          x: gx * GRID + GRID / 2,
          y: gy * GRID + GRID / 2,
          damage: 0,
          cooldown: 1,
          range: 0,
          cd: 0,
          level: 1,
          aim: 0,
          recoil: 0,
          hp: 300,
          maxHp: 300,
          shake: 0,
          stake: true,
          gx,
          gy,
        });
        setHover("路障已放，妖潮改走最短路");
        return;
      }
      if (id === null) return;
      const def = TOWERS[id];
      if (!canPlace(gx, gy)) {
        setHover("這格不能放塔");
        return;
      }
      if (goldRef.current < def.cost) {
        setHover("金幣不夠");
        return;
      }
      goldRef.current -= def.cost;
      setGold(goldRef.current);
      s.towers.push({
        def: id,
        x: gx * GRID + GRID / 2,
        y: gy * GRID + GRID / 2,
        damage: def.damage,
        cooldown: def.cooldown,
        range: def.range,
        cd: 0,
        level: 1,
        aim: 0,
        recoil: 0,
        hp: 200,
        maxHp: 200,
        shake: 0,
        stake: false,
        gx,
        gy,
      });
      setHover(`已放置 ${def.name}`);
    };

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
    };
  }, []);

  function canPlace(gx: number, gy: number) {
    if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) return false;
    if ((gx === SPAWN.c && gy === SPAWN.r) || (gx === GOAL.c && gy === GOAL.r)) return false;
    if (sim.current.blocked.has(cellKey(gx, gy))) return false;
    return !sim.current.towers.some((t) => t.gx === gx && t.gy === gy);
  }

  function start() {
    sim.current.towers = [];
    sim.current.enemies = [];
    sim.current.shots = [];
    sim.current.parts = [];
    sim.current.floats = [];
    sim.current.rings = [];
    sim.current.pops = [];
    sim.current.queue = [];
    sim.current.wave = 0;
    sim.current.between = 0;
    goldRef.current = 340;
    livesRef.current = 30;
    setGold(340);
    setLives(30);
    setWave(0);
    setSel(null);
    selRef.current = null;
    phaseRef.current = "play";
    setPhase("play");
    setWorkshop(false);
    setPaused(false);
    pausedRef.current = false;
    const commit = (canvasRef.current as HTMLCanvasElement & { __commit?: (n: Set<string>) => boolean }).__commit;
    commit?.(new Set(mapRef.current));
    const c = canvasRef.current as HTMLCanvasElement & { __begin?: () => void };
    c.__begin?.();
  }

  function backToMenu() {
    pausedRef.current = false;
    setPaused(false);
    phaseRef.current = "ready";
    setPhase("ready");
    setWorkshop(false);
    setStaking(false);
    setHover("");
  }

  function callWave() {
    const c = canvasRef.current as HTMLCanvasElement & { __begin?: () => void };
    if (sim.current.enemies.length === 0 && sim.current.queue.length === 0 && sim.current.wave > 0 && (endless || sim.current.wave < MAX_WAVE)) {
      goldRef.current += 25;
      setGold(goldRef.current);
      setHover("提前出波 +25 金");
    }
    c.__begin?.();
  }

  function upgrade(kind: "dmg" | "rate") {
    if (sel === null) return;
    const tw = sim.current.towers[sel];
    if (!tw) return;
    const cost = kind === "dmg" ? 40 * tw.level : 36 * tw.level;
    if (goldRef.current < cost) {
      setHover("金幣不夠升級");
      return;
    }
    goldRef.current -= cost;
    setGold(goldRef.current);
    if (kind === "dmg") tw.damage *= 1.25;
    else tw.cooldown = Math.max(0.16, tw.cooldown * 0.8);
    tw.level += 1;
    setHover(kind === "dmg" ? "傷害提升" : "射速提升");
    setSel(sel);
  }

  function sell() {
    if (sel === null) return;
    const tw = sim.current.towers[sel];
    if (!tw) return;
    if (tw.stake) {
      const next = new Set(sim.current.blocked);
      next.delete(cellKey(tw.gx, tw.gy));
      const commit = (canvasRef.current as HTMLCanvasElement & { __commit?: (n: Set<string>) => boolean }).__commit;
      commit?.(next);
      goldRef.current += Math.floor(STAKE_COST * 0.6);
      setGold(goldRef.current);
      sim.current.towers.splice(sel, 1);
      selRef.current = null;
      setSel(null);
      setHover("路障已拆除，路線已重算");
      return;
    }
    const refund = Math.floor(TOWERS[tw.def].cost * 0.6);
    goldRef.current += refund;
    setGold(goldRef.current);
    sim.current.towers.splice(sel, 1);
    selRef.current = null;
    setSel(null);
    setHover(`賣出 +${refund}`);
  }

  const selected = sel !== null ? sim.current.towers[sel] : null;
  const selectedDef: TowerDef | null = selected ? TOWERS[selected.def] : null;

  return (
    <div className="td-shell">
      <header className="mx-auto flex max-w-[1320px] items-end justify-between px-4 pt-4">
        <div>
          <p className="text-xs tracking-[0.28em] text-[#8ec8ee]">UNDERWATER WARD</p>
          <h1 className="font-['Cormorant_Garamond'] text-4xl leading-none text-[#ffe7f1]">狐仙塔防</h1>
        </div>
        <p className="hidden text-sm text-[#9ec4de] sm:block">越後面的狐仙越強 · 強敵掉更多金幣</p>
      </header>
      <div className="td-layout">
        <div className="stage" ref={wrapRef}>
          <canvas ref={canvasRef} width={W} height={H} />
          <div className="hud-float">
            <div className="chip">生命 {lives}</div>
            <div className="chip">金幣 {gold}</div>
            <div className="chip">
              波次 {wave}
              {endless ? " · 無盡" : `/${MAX_WAVE}`}
              {speed === 30 ? " · 30倍" : ""}
            </div>
          </div>
          {phase === "play" && paused && (
            <div className="overlay">
              <h2>已暫停</h2>
              <p className="mb-4 text-sm text-[#c5dff2]">時空凍結。可以繼續守城，或回到主畫面。</p>
              <button
                className="btn"
                onClick={() => {
                  pausedRef.current = false;
                  setPaused(false);
                }}
              >
                繼續
              </button>
              <button className="btn ghost mt-3" onClick={backToMenu}>
                返回主畫面
              </button>
            </div>
          )}
          {phase !== "play" && !workshop && (
            <div className="overlay">
              <h2>{phase === "win" ? "擊倒了弗洛洛，將他制伏在超市她的同時問出了其餘殘黨的下落，聖地以失守，故事還在繼續..." : phase === "lose" ? "卡提西亞從裙底掏出了大劍並鄙視你" : "懸方城"}</h2>
              <p className="mb-4 max-w-md text-sm text-[#c5dff2]">
                {phase === "ready"
                  ? "點地圖工房可先封路。戰鬥中放路障會依最短路改道，封死整張圖會被拒絕。每 5 波出現會拆塔的潮刃。可開無盡，或把速度拉到 30 倍。"
                  : phase === "win"
                    ? "20波妖潮已被擋下。"
                    : "生命歸零。重新布置結界再試一次。"}
              </p>
              <button className="btn" onClick={start}>
                {phase === "ready" ? (endless ? "開始無盡" : "開始守城") : "重新開始"}
              </button>
              {phase === "ready" && (
                <div className="mt-3 flex gap-2">
                  <button className="btn ghost" onClick={() => setEndless((v) => !v)}>
                    {endless ? "無盡：開" : "無盡：關"}
                  </button>
                  <button className="btn ghost" onClick={() => setWorkshop(true)}>
                    地圖工房
                  </button>
                </div>
              )}
            </div>
          )}
          {workshop && phase !== "play" && (
            <div className="hud-float" style={{ top: "auto", bottom: 12, left: 12, right: 12, pointerEvents: "auto" }}>
              <div className="chip">點格子封路或拆除 · 出入口不能封 · 不能封死</div>
              <button className="btn" onClick={() => setWorkshop(false)}>
                完成工房
              </button>
            </div>
          )}
        </div>
        <aside className="panel">
          <div className="mb-2 flex gap-2">
            <button
              className="btn ghost flex-1"
              onClick={() => {
                pausedRef.current = true;
                setPaused(true);
              }}
              disabled={phase !== "play" || paused}
            >
              暫停
            </button>
            <button className="btn ghost flex-1" onClick={callWave} disabled={phase !== "play" || paused}>
              下一波
            </button>
            <button
              className="btn ghost flex-1"
              onClick={() => setSpeed((v) => (v === 10 ? 1 : 10))}
              disabled={phase !== "play"}
            >
              {speed === 30 ? "速度 30x" : "速度 1x"}
            </button>
            <button
              className={"btn ghost flex-1" + (staking ? " on" : "")}
              onClick={() => {
                setStaking((v) => !v);
                setPick(null);
                pickRef.current = null;
              }}
              disabled={phase !== "play"}
            >
              路障 {STAKE_COST}
            </button>
          </div>
          <p className="mb-2 min-h-5 text-xs text-[#ffd7a8]">{hover}</p>
          {selected && selected.stake && (
            <div className="mb-3 rounded-xl border border-[#ffd2a855] bg-[#2a2016aa] p-2 text-xs leading-5">
              <b className="text-[#ffd2a8]">改道路障</b>
              <div>擋住一格。妖潮會重算邊界內的最短路，不能封死。</div>
              <button className="btn ghost mt-2 w-full" onClick={sell}>
                拆除
              </button>
            </div>
          )}
          {selected && selectedDef && !selected.stake && (
            <div className="mb-3 rounded-xl border border-[#ff9ec455] bg-[#2a1630aa] p-2 text-xs leading-5">
              <b style={{ color: selectedDef.color }}>{selectedDef.name}</b> Lv.{selected.level}
              <div>特性：{selectedDef.trait}</div>
              <div>
                傷害 {Math.round(selected.damage)} · 射速 {(1 / selected.cooldown).toFixed(2)}/秒 · 射程 {Math.round(selected.range)}
              </div>
              <div className="mt-2 flex gap-2">
                <button className="btn ghost flex-1" onClick={() => upgrade("dmg")}>
                  傷害 {40 * selected.level}
                </button>
                <button className="btn ghost flex-1" onClick={() => upgrade("rate")}>
                  射速 {36 * selected.level}
                </button>
              </div>
              <button className="btn ghost mt-2 w-full" onClick={sell}>
                賣出
              </button>
            </div>
          )}
          <p className="mb-2 text-xs text-[#8eb6d4]">守護者（依圖片順序，越後越強）</p>
          {TOWERS.map((t) => (
            <button
              key={t.id}
              className={"tower-card" + (pick === t.id ? " on" : "")}
              onClick={() => {
                setPick(t.id);
                pickRef.current = t.id;
                setSel(null);
                selRef.current = null;
                setHover(`${t.name}：${t.trait}`);
              }}
            >
              {TOWER_ANIMS[t.id]?.length ? (
                <AlivePortrait frames={TOWER_ANIMS[t.id]} />
              ) : (
                <img className="tower-idle" src={t.img} alt="" />
              )}
              <span>
                <b className="block text-sm" style={{ color: t.color }}>
                  {t.name}
                </b>
                <span className="text-[#ffd27a]">💰 {t.cost}</span>
                <span className="mt-0.5 block text-[11px] text-[#b7ddf5]">{t.trait}</span>
              </span>
            </button>
          ))}
        </aside>
      </div>
    </div>
  );
}
