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

// "nonbinary" は旧セーブ互換のため残す（新規では出さない）。
export type Gender =
  | "male" | "female"
  | "lesbian" | "gay" | "bi" | "trans"
  | "nonbinary";

/** せいべつをランダムに決める。多様性を ひとくくりにせず、
 *  それぞれ少しずつ配合する（雄45/雌45/L3/G3/B3/T1）。 */
function rollGender(): Gender {
  const r = Math.random() * 100;
  if (r < 45) return "male";
  if (r < 90) return "female";
  if (r < 93) return "lesbian";
  if (r < 96) return "gay";
  if (r < 99) return "bi";
  return "trans";
}

/** せいかく・せいべつをランダムに決める（新規アルモン生成時）。 */
export function rollNatureGender(): { nature: string; gender: Gender } {
  return {
    nature: NATURES[Math.floor(Math.random() * NATURES.length)],
    gender: rollGender(),
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
export function genderLabel(gender?: Gender): string {
  switch (gender) {
    case "male": return "♂ オス";
    case "female": return "♀ メス";
    case "lesbian": return "🌈 レズビアン";
    case "gay": return "🌈 ゲイ";
    case "bi": return "🌈 バイセクシュアル";
    case "trans": return "⚧ トランスジェンダー";
    case "nonbinary": return "🌈 ノンバイナリー";
    default: return "―";
  }
}

/** せいべつの記号だけ（HUD など狭い場所用）。 */
export function genderSymbol(gender?: Gender): string {
  switch (gender) {
    case "male": return "♂";
    case "female": return "♀";
    case "lesbian": return "L";
    case "gay": return "G";
    case "bi": return "B";
    case "trans": return "T";
    case "nonbinary": return "🌈";
    default: return "";
  }
}

/** せいべつの表示色。 */
export function genderColor(gender?: Gender): string {
  switch (gender) {
    case "male": return "#8fc0ff";
    case "female": return "#ff9fc4";
    case "lesbian": return "#ff924c";   // レズビアンフラッグ寄りのオレンジ
    case "gay": return "#3fbf7f";       // レインボー グリーン
    case "bi": return "#b060d0";        // バイの紫
    case "trans": return "#59c9f2";     // トランスの水色
    case "nonbinary": return "#c58bff";
    default: return "#c0c8d0";
  }
}
