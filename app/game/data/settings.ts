// Player-facing game settings (せってい). Persisted in localStorage and shared
// between the Phaser scenes and the React GamePad component. Changing a value
// dispatches a window event so the on-screen controls re-render immediately.

export interface GameSettings {
  leftHanded: boolean; // swap the D-pad and A/B sides
  bgm: boolean;        // background music (frame only until audio exists)
  se: boolean;         // sound effects (frame only until audio exists)
}

const KEY = "usamon-settings";
export const SETTINGS_EVENT = "usamon-settings-changed";

const DEFAULTS: GameSettings = { leftHanded: false, bgm: true, se: true };

export function loadSettings(): GameSettings {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: GameSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: s }));
  } catch {
    /* ignore */
  }
}
