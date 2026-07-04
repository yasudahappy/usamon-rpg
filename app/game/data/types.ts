// ---- Data types (loaded from JSON) ----

export interface Stats {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
}

export interface MonsterData {
  id: string;
  name: string;
  type: string;
  role: string;
  description: string;
  baseStats: Stats;
  statsAt50: Stats;
  evolution: { level: number; to: string } | null;
  learnset: { level: number; moveId: string }[];
  color: string;
  baseExp: number;
}

export interface MoveEffect {
  type: string; // "statChange" | "allStatsUp" | "heal" | "healAndBuff" | "multiHit"
  stat?: string;
  multiplier?: number;
  target?: string; // "self" | "enemy"
  healPercent?: number;
  min?: number;
  max?: number;
}

export interface MoveData {
  id: string;
  name: string;
  type: string;
  power: number;
  accuracy: number;
  isSupport: boolean;
  priority?: boolean;
  effect: MoveEffect | null;
  description: string;
}

// ---- Runtime instance (a monster in the player's party) ----

export interface MonsterInstance {
  dataId: string;
  level: number;
  exp: number;
  currentHp: number;
  maxHp: number;
  stats: Stats;
  moves: string[]; // moveId array, max 4
}
