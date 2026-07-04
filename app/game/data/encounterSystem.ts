import * as Phaser from "phaser";

export interface EncounterEntry {
  id: string;
  weight: number;
  minLevel: number;
  maxLevel: number;
}

export interface EncounterTable {
  encounterRate: number;
  monsters: EncounterEntry[];
}

export interface EncounterData {
  [mapKey: string]: EncounterTable;
}

/**
 * Roll a weighted random monster from the encounter table.
 */
export function rollEncounter(
  table: EncounterTable
): { monsterId: string; level: number } | null {
  const totalWeight = table.monsters.reduce((s, m) => s + m.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of table.monsters) {
    roll -= entry.weight;
    if (roll <= 0) {
      const level = Phaser.Math.Between(entry.minLevel, entry.maxLevel);
      return { monsterId: entry.id, level };
    }
  }
  // Fallback
  const last = table.monsters[table.monsters.length - 1];
  return {
    monsterId: last.id,
    level: Phaser.Math.Between(last.minLevel, last.maxLevel),
  };
}

/**
 * Calculate capture probability.
 * Formula: captureRate = (1 - currentHp/maxHp) * 0.7 + 0.1
 * At full HP: 10% chance. At 1 HP: ~80% chance.
 */
export function calculateCaptureRate(
  currentHp: number,
  maxHp: number
): number {
  const hpRatio = currentHp / maxHp;
  return Math.min(0.95, (1 - hpRatio) * 0.7 + 0.1);
}

/**
 * Attempt capture. Returns true if successful.
 */
export function attemptCapture(
  currentHp: number,
  maxHp: number
): { success: boolean; shakes: number } {
  const rate = calculateCaptureRate(currentHp, maxHp);
  const roll = Math.random();
  const success = roll < rate;

  // Shake animation count (1-3, more shakes = closer to catching)
  let shakes: number;
  if (success) {
    shakes = 3;
  } else if (roll < rate * 1.5) {
    shakes = 2;
  } else if (roll < rate * 2) {
    shakes = 1;
  } else {
    shakes = 0;
  }

  return { success, shakes };
}
