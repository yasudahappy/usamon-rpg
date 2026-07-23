// セーブデータの読み書きを一元化し、消失・破損に強くする層。
//
//  仕組み:
//   1) 二重化：本体(SAVE_KEY)に書くたび、直前の「正常な本体」を控え(BACKUP_KEY)へ退避。
//      → 書き込みが途中で壊れても、1世代前の正常データが残る。
//   2) 検証つき読み込み：本体が壊れていたら控えから自動復旧する。
//   3) バックアップコード：本体＋設定を1つの文字列に書き出し／取り込みできる。
//      → キャッシュ削除や機種変更など localStorage ごと消えるケースに、
//        プレイヤー自身が外部にコピーして保管できる。

export const SAVE_KEY = "usamon-save-data";
export const BACKUP_KEY = "usamon-save-backup";
export const SETUP_KEY = "usamon-player-setup";
export const SETTINGS_KEY = "usamon-settings";

/** セーブとして最低限そろっているか（party 配列を持つ）。 */
function isValidSave(o: unknown): boolean {
  if (!o || typeof o !== "object") return false;
  const ps = (o as { playerState?: { party?: unknown } }).playerState;
  return !!ps && Array.isArray(ps.party);
}

function parse(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * いちばん確からしいセーブを返す（本体→控えの順）。本体が壊れていて控えが
 * 正常なら、控えを本体に書き戻してから返す（自動復旧）。無ければ null。
 */
export function readSaveData(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  let main: unknown = null, backup: unknown = null;
  try { main = parse(localStorage.getItem(SAVE_KEY)); } catch { /* ignore */ }
  try { backup = parse(localStorage.getItem(BACKUP_KEY)); } catch { /* ignore */ }
  if (isValidSave(main)) return main as Record<string, unknown>;
  if (isValidSave(backup)) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(backup)); } catch { /* ignore */ }
    return backup as Record<string, unknown>;
  }
  return null;
}

/** 正常なセーブ（本体または控え）が存在するか。 */
export function hasSaveData(): boolean {
  return readSaveData() !== null;
}

/**
 * セーブを書き込む。書き込み前に、現在の正常な本体を控えへ退避しておく
 * （壊れた上書きが起きても1世代前が残るように）。成功で true。
 */
export function writeSaveData(payload: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    const prev = localStorage.getItem(SAVE_KEY);
    if (prev && isValidSave(parse(prev))) {
      try { localStorage.setItem(BACKUP_KEY, prev); } catch { /* ignore */ }
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** さいしょから：本体・控え・セットアップを消す。 */
export function clearSaveData(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(BACKUP_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(SETUP_KEY); } catch { /* ignore */ }
}

/**
 * バックアップコードを作る（本体＋セットアップ＋設定を1つの文字列に）。
 * セーブが無ければ null。
 */
export function exportBackupCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const save = localStorage.getItem(SAVE_KEY);
    if (!save || !isValidSave(parse(save))) return null;
    const bundle = {
      v: 1,
      save,
      setup: localStorage.getItem(SETUP_KEY),
      settings: localStorage.getItem(SETTINGS_KEY),
    };
    // JSON→URIエンコード→base64（日本語やUTF-8も安全に扱う）。
    return btoa(encodeURIComponent(JSON.stringify(bundle)));
  } catch {
    return null;
  }
}

/**
 * バックアップコードを取り込む。正しく復元できたら true。
 * 本体・控え・セットアップ・設定を丸ごと書き戻す。
 */
export function importBackupCode(code: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const bundle = JSON.parse(decodeURIComponent(atob(code.trim()))) as {
      save?: string; setup?: string | null; settings?: string | null;
    };
    if (!bundle || typeof bundle.save !== "string") return false;
    if (!isValidSave(parse(bundle.save))) return false;
    localStorage.setItem(SAVE_KEY, bundle.save);
    localStorage.setItem(BACKUP_KEY, bundle.save);
    if (bundle.setup) localStorage.setItem(SETUP_KEY, bundle.setup);
    if (bundle.settings) localStorage.setItem(SETTINGS_KEY, bundle.settings);
    return true;
  } catch {
    return false;
  }
}
