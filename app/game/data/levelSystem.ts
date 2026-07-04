import { MonsterData, MoveData, MonsterInstance, Stats } from "./types";

/**
 * Calculate stats for a given monster at a given level.
 * Uses linear interpolation between baseStats (Lv5) and statsAt50 (Lv50).
 */
export function calculateStats(data: MonsterData, level: number): Stats {
  const interp = (base: number, at50: number): number => {
    if (level <= 5) return base;
    const growth = (at50 - base) / (50 - 5);
    return Math.floor(base + growth * (level - 5));
  };
  return {
    hp: interp(data.baseStats.hp, data.statsAt50.hp),
    attack: interp(data.baseStats.attack, data.statsAt50.attack),
    defense: interp(data.baseStats.defense, data.statsAt50.defense),
    speed: interp(data.baseStats.speed, data.statsAt50.speed),
  };
}

/**
 * Total experience needed to reach a given level.
 */
export function getExpForLevel(level: number): number {
  return level * level * level;
}

/**
 * Experience reward for defeating an enemy.
 */
export function getExpReward(enemyBaseExp: number, enemyLevel: number): number {
  return Math.floor((enemyBaseExp * enemyLevel) / 5);
}

/**
 * Get all moves a monster should know at a given level (up to 4, latest ones).
 */
export function getMovesForLevel(
  data: MonsterData,
  level: number,
  allMoves: MoveData[]
): string[] {
  const learnable = data.learnset
    .filter((entry) => entry.level <= level)
    .map((entry) => entry.moveId);
  // Take the last 4 (most recently learned)
  return learnable.slice(-4);
}

/**
 * Check if a monster learns a new move at the given level.
 */
export function getNewMoveAtLevel(
  data: MonsterData,
  level: number
): string | null {
  const entry = data.learnset.find((e) => e.level === level);
  return entry ? entry.moveId : null;
}

/**
 * Create a MonsterInstance at a given level with appropriate moves.
 */
export function createMonsterInstance(
  dataId: string,
  level: number,
  allMonsters: MonsterData[],
  allMoves: MoveData[]
): MonsterInstance {
  const data = allMonsters.find((m) => m.id === dataId);
  if (!data) {
    throw new Error(`Monster data not found: ${dataId}`);
  }
  const stats = calculateStats(data, level);
  const moves = getMovesForLevel(data, level, allMoves);

  return {
    dataId,
    level,
    exp: getExpForLevel(level),
    currentHp: stats.hp,
    maxHp: stats.hp,
    stats,
    moves,
  };
}

/**
 * Check if a monster should evolve at current level.
 */
export function checkEvolution(
  instance: MonsterInstance,
  allMonsters: MonsterData[]
): { evolvesTo: string; newData: MonsterData } | null {
  const data = allMonsters.find((m) => m.id === instance.dataId);
  if (!data || !data.evolution) return null;
  if (instance.level >= data.evolution.level) {
    const newData = allMonsters.find((m) => m.id === data.evolution!.to);
    if (newData) {
      return { evolvesTo: data.evolution.to, newData };
    }
  }
  return null;
}

/**
 * Apply evolution to a monster instance.
 */
export function applyEvolution(
  instance: MonsterInstance,
  newDataId: string,
  allMonsters: MonsterData[],
  allMoves: MoveData[]
): void {
  const newData = allMonsters.find((m) => m.id === newDataId);
  if (!newData) return;

  const oldMaxHp = instance.maxHp;
  instance.dataId = newDataId;
  const newStats = calculateStats(newData, instance.level);
  instance.stats = newStats;
  instance.maxHp = newStats.hp;
  // Heal proportionally
  const hpRatio = instance.currentHp / oldMaxHp;
  instance.currentHp = Math.max(1, Math.floor(newStats.hp * hpRatio));
}

/**
 * Apply level up: recalculate stats, return new moves to learn.
 */
export function applyLevelUp(
  instance: MonsterInstance,
  allMonsters: MonsterData[]
): void {
  const data = allMonsters.find((m) => m.id === instance.dataId);
  if (!data) return;

  const oldMaxHp = instance.maxHp;
  const newStats = calculateStats(data, instance.level);
  instance.stats = newStats;
  instance.maxHp = newStats.hp;
  // Heal the HP gained
  instance.currentHp += newStats.hp - oldMaxHp;
  if (instance.currentHp > instance.maxHp) {
    instance.currentHp = instance.maxHp;
  }
}
