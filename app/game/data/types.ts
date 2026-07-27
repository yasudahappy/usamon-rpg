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
  pp: number; // 最大PP（使用可能回数）
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
  pp?: number[];   // 各わざの現在PP（moves と同じ並び。無ければ最大PPで補完）
  nature?: string;            // せいかく（フレーバー）
  gender?: "male" | "female" | "lesbian" | "gay" | "bi" | "trans" | "nonbinary"; // せいべつ（多様性を含む）
  held?: string;              // もちもの（道具ID。1体につき1つ）
  bred?: boolean;             // あずけや生まれの特別な子（のうりょくが少し高い）
  // ---- タマゴ（あずけやでもらう。歩くとかえる）----
  isEgg?: boolean;            // このインスタンスは タマゴ
  eggSteps?: number;          // 孵化までの あるいた歩数
  eggFatherMove?: string;     // 親から うけつぐ わざ（孵化時に反映）
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
  companion?: string; // 仲間になって ついてくる キャラ（例: "hijiri"）
  gayWalkSteps?: number; // ゲイ＋オスが手持ちにいる間の歩数（5000歩でオス→ゲイ）
  daycare?: DaycareState; // あずけや（くものうみタウン・タカ＆ミホ運営）
}

// ---- あずけや（Daycare）----
export interface DaycareState {
  deposited: MonsterInstance[];  // 最大3体
  breedSteps?: number;           // オス＋メスがいる間の歩数（1万歩ごとに卵抽選）
  gaySteps?: number;             // ゲイ2＋オス1のときの歩数（5000歩でオス→ゲイ）
  pendingEgg?: DaycareEgg | null; // 生まれて うけとり待ちの タマゴ
}

export interface DaycareEgg {
  species: string;      // 母親と同じ種類
  fatherMove?: string;  // 父親から うけつぐ わざ
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
