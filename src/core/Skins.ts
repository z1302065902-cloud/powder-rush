import { Score } from './Score';

/**
 * Character skins — unlockable rider appearances.
 *
 * Unlock state is DERIVED from persisted stats (Score), never stored on its own,
 * so unlocks can never desync from actual player progress. Only the *selection*
 * is persisted.
 */

export interface Palette {
  jacket: number;
  accent: number;
  pants: number;
  boot: number;
  helmet: number;
  lens: number;
  glove: number;
  pole: number;
  ski: number;
  skiTip: number;
  scarf: number;
  skin: number;
}

export type MetricKey = 'dist' | 'gates' | 'speed' | 'totalGates' | 'totalDist' | 'none';

export interface Skin {
  id: string;
  name: string;
  cn: string;
  emoji: string;
  /** Which persisted stat gates this skin. */
  metric: MetricKey;
  /** Threshold on that stat. Ignored when metric === 'none'. */
  goal: number;
  /** Human-readable unlock condition. */
  hint: string;
  palette: Palette;
}

export const SKINS: Skin[] = [
  {
    id: 'classic',
    name: 'Classic',
    cn: '经典',
    emoji: '🎿',
    metric: 'none',
    goal: 0,
    hint: '默认解锁',
    palette: {
      jacket: 0x1c56a0, accent: 0x35e08a, pants: 0x0e2a52, boot: 0x131c26,
      helmet: 0x23d5c0, lens: 0x0a0e14, glove: 0xff7a1a, pole: 0x16283f,
      ski: 0x17c7b4, skiTip: 0xecff57, scarf: 0xff5a3c, skin: 0xffc9a8,
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    cn: '午夜',
    emoji: '🌙',
    metric: 'dist',
    goal: 400,
    hint: '单次滑行 400m',
    palette: {
      jacket: 0x2a1b5e, accent: 0x9d6bff, pants: 0x140d33, boot: 0x0a0718,
      helmet: 0x6a3fd1, lens: 0x08060f, glove: 0x7b4ddb, pole: 0x1a1436,
      ski: 0x4526a8, skiTip: 0xc084ff, scarf: 0x5b2fd6, skin: 0xffc9a8,
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    cn: '霓虹',
    emoji: '💚',
    metric: 'gates',
    goal: 20,
    hint: '单次穿过 20 个门',
    palette: {
      jacket: 0x101014, accent: 0x39ff88, pants: 0x0a0a0e, boot: 0x000000,
      helmet: 0xff2d95, lens: 0x000000, glove: 0x39ff88, pole: 0x1a1a22,
      ski: 0xff2d95, skiTip: 0x39ff88, scarf: 0xff2d95, skin: 0xffc9a8,
    },
  },
  {
    id: 'gold',
    name: 'Gold',
    cn: '黄金',
    emoji: '🏆',
    metric: 'dist',
    goal: 800,
    hint: '单次滑行 800m',
    palette: {
      jacket: 0xd9a521, accent: 0xfff3b0, pants: 0x7a5c10, boot: 0x2a1f08,
      helmet: 0xffd94a, lens: 0x1a1206, glove: 0xffe066, pole: 0x5c4409,
      ski: 0xf5c518, skiTip: 0xfff6c2, scarf: 0xffe066, skin: 0xffc9a8,
    },
  },
  {
    id: 'ice',
    name: 'Polar',
    cn: '极地',
    emoji: '❄️',
    metric: 'speed',
    goal: 120,
    hint: '最高时速 120 km/h',
    palette: {
      jacket: 0xe8f4ff, accent: 0x6fd8ff, pants: 0x9fc4dd, boot: 0x4a6b80,
      helmet: 0xdff2ff, lens: 0x1c3a4d, glove: 0x6fd8ff, pole: 0x7fa8c0,
      ski: 0xbfe8ff, skiTip: 0xffffff, scarf: 0x8fe4ff, skin: 0xffc9a8,
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    cn: '熔岩',
    emoji: '🔥',
    metric: 'totalGates',
    goal: 100,
    hint: '累计穿过 100 个门',
    palette: {
      jacket: 0x8c1c0e, accent: 0xff8a1f, pants: 0x3a0d06, boot: 0x140402,
      helmet: 0xd93a12, lens: 0x1a0503, glove: 0xff8a1f, pole: 0x2a0a05,
      ski: 0xe8451a, skiTip: 0xffc23d, scarf: 0xff5a1f, skin: 0xffc9a8,
    },
  },
];

const SELECT_KEY = 'ski_skin';

function readSelected(): string {
  try {
    const v = localStorage.getItem(SELECT_KEY);
    if (v && SKINS.some((s) => s.id === v)) return v;
  } catch {
    /* localStorage unavailable — fall through to default */
  }
  return SKINS[0].id;
}

/** Current value of the stat that gates `skin`. */
export function metricValue(metric: MetricKey): number {
  switch (metric) {
    case 'dist': return Score.dist;
    case 'gates': return Score.gates;
    case 'speed': return Score.speed;
    case 'totalGates': return Score.totalGates;
    case 'totalDist': return Score.totalDist;
    case 'none': return 0;
  }
}

export interface SkinProgress {
  unlocked: boolean;
  cur: number;
  goal: number;
  ratio: number; // 0..1
}

export function progressOf(skin: Skin): SkinProgress {
  if (skin.metric === 'none') return { unlocked: true, cur: 0, goal: 0, ratio: 1 };
  const cur = metricValue(skin.metric);
  return {
    unlocked: cur >= skin.goal,
    cur,
    goal: skin.goal,
    ratio: Math.max(0, Math.min(1, cur / skin.goal)),
  };
}

export const Skins = {
  all: SKINS,
  selectedId: readSelected(),

  byId(id: string): Skin {
    return SKINS.find((s) => s.id === id) ?? SKINS[0];
  },

  active(): Skin {
    return this.byId(this.selectedId);
  },

  isUnlocked(id: string): boolean {
    return progressOf(this.byId(id)).unlocked;
  },

  /** Select a skin. Returns false if it is still locked. */
  select(id: string): boolean {
    if (!this.isUnlocked(id)) return false;
    this.selectedId = id;
    try {
      localStorage.setItem(SELECT_KEY, id);
    } catch {
      /* ignore — selection stays in memory for this session */
    }
    return true;
  },

  /** All skins that are currently unlocked. */
  unlocked(): Skin[] {
    return SKINS.filter((s) => progressOf(s).unlocked);
  },
};
