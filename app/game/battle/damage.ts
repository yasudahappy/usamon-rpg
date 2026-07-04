import { BattleMonster, BattleMove } from "./types";
import { TypeChart } from "../types";

/**
 * タイプ相性倍率を取得する
 * "ノーマル"タイプは相性表にないので常に1.0倍
 */
export function getTypeEffectiveness(
  moveType: string,
  defenderType: string,
  typeChart: TypeChart
): number {
  if (moveType === "ノーマル" || defenderType === "ノーマル") {
    return 1.0;
  }
  const attackRow = typeChart.effectiveness[moveType];
  if (!attackRow) return 1.0;
  const eff = attackRow[defenderType];
  return eff !== undefined ? eff : 1.0;
}

/**
 * ダメージ計算
 * damage = floor(((2*level/5+2) * power * (attacker.attack*attackMod) / (defender.defense*defenseMod)) / 50 + 2) * typeEffectiveness
 * 最低ダメージ: 1
 */
export function calculateDamage(
  attacker: BattleMonster,
  defender: BattleMonster,
  move: BattleMove,
  typeChart: TypeChart
): { damage: number; effectiveness: number } {
  const effectiveness = getTypeEffectiveness(
    move.type,
    defender.type,
    typeChart
  );

  const level = attacker.level;
  const power = move.power;
  const atk = attacker.attack * attacker.attackMod;
  const def = defender.defense * defender.defenseMod;

  const baseDamage =
    Math.floor(
      ((2 * level / 5 + 2) * power * atk) / (def * 50) + 2
    );
  const finalDamage = Math.max(1, Math.floor(baseDamage * effectiveness));

  return { damage: finalDamage, effectiveness };
}
