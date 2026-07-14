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
  nature?: string;            // せいかく（フレーバー）
  gender?: "male" | "female"; // せいべつ
}

// ---- Player state ----

export interface PlayerState {
  party: MonsterInstance[]; // max 6
  box: MonsterInstance[]; // overflow storage
  items: { id: string; count: number }[];
  money: number;
  defeatedTrainers: string[]; // trainer ids
  pickups?: string[]; // ids of one-time field items already collected
  playSeconds?: number; // total accumulated play time (seconds)
  lastRecoveryMap?: string; // recovery pod the player last healed at (blackout respawn)
  seen?: string[]; // ずかん: dataIds the player has encountered (みつけた)
  caught?: string[]; // ずかん: dataIds the player has owned/caught (つかまえた)
}

// ---- Trainer data ----

export interface TrainerData {
  id: string;
  name: string;
  mapKey: string;
  x: number;
  y: number;
  direction: string;
  sightRange: number;
  prizeMoneyBase: number;
  dialogBefore: string;
  dialogWin: string;
  dialogLose: string;
  party: { id: string; level: number }[];
  battleSprite?: string;   // texture key for the battle intro/outro portrait
  battleSprite2?: string;  // second portrait for duo (double-battle) trainers
  doubles?: boolean;       // true = 2vs2 double battle against this trainer duo
}
