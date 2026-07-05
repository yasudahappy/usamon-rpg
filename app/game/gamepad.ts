// Shared gamepad state for communication between React controls and Phaser scenes

export type Direction = "up" | "down" | "left" | "right";

export interface GamePadState {
  dpad: Direction | null;
  aJust: boolean;
  bJust: boolean;
  menuJust: boolean;
}

function ensure(): GamePadState {
  if (typeof window === "undefined") {
    return { dpad: null, aJust: false, bJust: false, menuJust: false };
  }
  if (!(window as any).__gamepad) {
    (window as any).__gamepad = {
      dpad: null,
      aJust: false,
      bJust: false,
      menuJust: false,
    };
  }
  return (window as any).__gamepad;
}

export function getGamePad(): GamePadState {
  return ensure();
}

/** Read and clear A button press */
export function consumeA(): boolean {
  const gp = ensure();
  if (gp.aJust) {
    gp.aJust = false;
    return true;
  }
  return false;
}

/** Read and clear B button press */
export function consumeB(): boolean {
  const gp = ensure();
  if (gp.bJust) {
    gp.bJust = false;
    return true;
  }
  return false;
}

/** Read and clear MENU button press */
export function consumeMenu(): boolean {
  const gp = ensure();
  if (gp.menuJust) {
    gp.menuJust = false;
    return true;
  }
  return false;
}

/** Clear all stale button presses */
export function clearJust(): void {
  const gp = ensure();
  gp.aJust = false;
  gp.bJust = false;
  gp.menuJust = false;
}
