import { MonsterInstance } from "./types";

// せいかく（フレーバー。能力には影響しない、子ども向けのやさしい性格リスト）。
export const NATURES = [
  "がんばりや",
  "まじめ",
  "すなお",
  "ようき",
  "おっとり",
  "やんちゃ",
  "さみしがり",
  "いじっぱり",
  "のんき",
  "てれや",
  "おとなしい",
  "せっかち",
];

/** せいかく・せいべつをランダムに決める（新規アルモン生成時）。 */
export function rollNatureGender(): { nature: string; gender: "male" | "female" } {
  return {
    nature: NATURES[Math.floor(Math.random() * NATURES.length)],
    gender: Math.random() < 0.5 ? "male" : "female",
  };
}

/** 既存セーブなどで せいかく／せいべつ が無いアルモンに、その場で割り当てる
 *  （インスタンスに保存するので、以降は同じ値で安定する）。 */
export function ensureNatureGender(inst: MonsterInstance): void {
  if (!inst.nature || !inst.gender) {
    const ng = rollNatureGender();
    if (!inst.nature) inst.nature = ng.nature;
    if (!inst.gender) inst.gender = ng.gender;
  }
}

/** せいべつの表示用ラベル（記号＋よみ）。 */
export function genderLabel(gender?: "male" | "female"): string {
  if (gender === "male") return "♂ オス";
  if (gender === "female") return "♀ メス";
  return "―";
}
