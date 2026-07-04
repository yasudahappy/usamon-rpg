export interface BattleMove {
  name: string;
  type: string; // "光", "影", "ノーマル" etc
  power: number; // 0 = 補助技
  isSupport: boolean;
  priority?: boolean; // 先制技
  accuracy?: number; // 命中率 (default 100)
  effect?: {
    type?: string; // "statChange" | "allStatsUp" | "heal" | "healAndBuff" | "multiHit"
    stat?: "attack" | "defense" | "speed";
    multiplier?: number; // 1.5 = 50%アップ
    target?: "self" | "enemy";
    healPercent?: number;
    min?: number;
    max?: number;
  };
}

export interface BattleMonster {
  name: string;
  type: string;
  level: number;
  maxHp: number;
  currentHp: number;
  attack: number;
  defense: number;
  speed: number;
  moves: BattleMove[];
  // バトル中の一時バフ
  attackMod: number; // 1.0がデフォルト
  defenseMod: number;
  speedMod: number;
}
