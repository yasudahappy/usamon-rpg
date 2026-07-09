// Haptic feedback via the Web Vibration API.
// Supported on Android browsers; iOS Safari does not implement the API, so all
// calls silently no-op there (no errors, no behaviour change).

function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      (navigator as Navigator & { vibrate: (p: number | number[]) => boolean }).vibrate(pattern);
    }
  } catch {
    /* ignore — haptics are best-effort */
  }
}

export const Haptics = {
  /** Small tick: attack lands, ice-slide stop, trainer "!" */
  light(): void { vibrate(15); },
  /** Solid thump: player takes damage, door ice cracks */
  medium(): void { vibrate(40); },
  /** Big hit: an almon faints, blackout */
  heavy(): void { vibrate([70, 50, 90]); },
  /** Happy triple: capture success, level up, evolution */
  success(): void { vibrate([25, 40, 25, 40, 25]); },
  /** Ground-shaking rumble: earthquake / meteor cutscenes */
  quake(): void { vibrate([140, 60, 140, 60, 220]); },
  /** Stop any ongoing vibration */
  stop(): void { vibrate(0); },
};
