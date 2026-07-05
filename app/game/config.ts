import * as Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { MapScene } from "./scenes/MapScene";
import { BattleScene } from "./scenes/BattleScene";
import { SetupScene } from "./scenes/SetupScene";

export function createGameConfig(
  parent: string | HTMLElement
): Phaser.Types.Core.GameConfig {
  // Dynamic height: match container aspect ratio so canvas fills 70% area
  let h = 960; // default portrait
  if (typeof parent !== "string") {
    const rect = parent.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      h = Math.round(640 * (rect.height / rect.width));
    } else if (typeof window !== "undefined") {
      // Fallback: estimate from window dimensions
      const winW = window.innerWidth || 375;
      const winH = (window.innerHeight || 812) * 0.7;
      h = Math.round(640 * (winH / winW));
    }
  }

  return {
    type: Phaser.AUTO,
    parent,
    width: 640,
    height: h,
    backgroundColor: "#1a2040",
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, SetupScene, MapScene, BattleScene],
  };
}
