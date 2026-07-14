import { MonsterInstance, Stats } from "./types";

type ModStat = "attack" | "defense" | "speed";
/** せいかくによる のうりょく補正（up=+10%, down=-10%。HPは対象外）。
 *  未記載・neutral は補正なし。 */
export const NATURE_MODS: Record<string, { up?: ModStat; down?: ModStat }> = {
  がんばりや: {},
  まじめ: {},
  すなお: {},
  てれや: {},
  いじっぱり: { up: "attack", down: "defense" },
  さみしがり: { up: "attack", down: "defense" },
  やんちゃ: { up: "attack", down: "speed" },
  ようき: { up: "speed", down: "attack" },
  せっかち: { up: "speed", down: "defense" },
  のんき: { up: "defense", down: "speed" },
  おっとり: { up: "defense", down: "attack" },
  おとなしい: { up: "defense", down: "attack" },
};

/** ベース能力値に せいかく補正を適用して返す（純関数・冪等）。 */
export function applyNature(stats: Stats, nature?: string): Stats {
  const mod = nature ? NATURE_MODS[nature] : undefined;
  const out: Stats = { ...stats };
  if (mod?.up) out[mod.up] = Math.floor(out[mod.up] * 1.1);
  if (mod?.down) out[mod.down] = Math.floor(out[mod.down] * 0.9);
  return out;
}

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
