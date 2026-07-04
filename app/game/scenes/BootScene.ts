import * as Phaser from "phaser";
import { MapData } from "../types";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    // Show loading text
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    this.add
      .text(w / 2, h / 2, "Loading...", {
        fontSize: "20px",
        color: "#aaaaaa",
        fontFamily: "monospace",
      })
      .setOrigin(0.5);

    // Load map data
    this.load.json("map-moonbase", "/data/maps/moonbase.json");
    this.load.json("types", "/data/types.json");
  }

  create(): void {
    const mapData = this.cache.json.get("map-moonbase") as MapData;
    this.generateTileset(mapData);
    this.generatePlayerSprite();
    this.scene.start("MapScene");
  }

  private generateTileset(mapData: MapData): void {
    const ts = mapData.tileSize;

    Object.entries(mapData.tileTypes).forEach(([id, tile]) => {
      const key = `tile-${id}`;
      const canvas = document.createElement("canvas");
      canvas.width = ts;
      canvas.height = ts;
      const ctx = canvas.getContext("2d")!;

      // Base color
      ctx.fillStyle = tile.color;
      ctx.fillRect(0, 0, ts, ts);

      if (id === "0") {
        // Floor: subtle grid lines
        ctx.strokeStyle = "#333338";
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, ts - 1, ts - 1);
        // Small dot pattern
        ctx.fillStyle = "#333338";
        ctx.fillRect(ts / 2, ts / 2, 2, 2);
      } else if (id === "1") {
        // Wall: metallic border effect
        ctx.fillStyle = "#7a7a82";
        ctx.fillRect(0, 0, ts, 3);
        ctx.fillRect(0, 0, 3, ts);
        ctx.fillStyle = "#5a5a62";
        ctx.fillRect(ts - 3, 0, 3, ts);
        ctx.fillRect(0, ts - 3, ts, 3);
        // Rivet details
        ctx.fillStyle = "#8a8a92";
        ctx.beginPath();
        ctx.arc(6, 6, 2, 0, Math.PI * 2);
        ctx.arc(ts - 6, 6, 2, 0, Math.PI * 2);
        ctx.arc(6, ts - 6, 2, 0, Math.PI * 2);
        ctx.arc(ts - 6, ts - 6, 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (id === "2") {
        // Equipment: panel with lines
        ctx.strokeStyle = "#4a5a6c";
        ctx.lineWidth = 2;
        ctx.strokeRect(2, 2, ts - 4, ts - 4);
        ctx.fillStyle = "#2a3a4c";
        ctx.fillRect(6, 8, ts - 12, 3);
        ctx.fillRect(6, 14, ts - 12, 3);
        ctx.fillRect(6, 20, ts - 12, 3);
      } else if (id === "3") {
        // Console: glowing screen
        ctx.fillStyle = "#0a4a6a";
        ctx.fillRect(4, 4, ts - 8, ts - 8);
        ctx.fillStyle = "#2a8aaa";
        ctx.fillRect(6, 6, ts - 12, ts - 12);
        // Blinking light
        ctx.fillStyle = "#4affaa";
        ctx.fillRect(8, 8, 4, 4);
      } else if (id === "4") {
        // Central device: purple glow
        ctx.fillStyle = "#3a2a5b";
        ctx.fillRect(2, 2, ts - 4, ts - 4);
        ctx.strokeStyle = "#6a4a9b";
        ctx.lineWidth = 2;
        ctx.strokeRect(4, 4, ts - 8, ts - 8);
        ctx.fillStyle = "#8a6abb";
        ctx.beginPath();
        ctx.arc(ts / 2, ts / 2, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      this.textures.addCanvas(key, canvas);
    });
  }

  private generatePlayerSprite(): void {
    const size = 32;
    // Two frames for walk animation
    for (let frame = 0; frame < 2; frame++) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;

      // Body - spacesuit white
      ctx.fillStyle = "#d0d0e0";
      const bodyY = frame === 0 ? 8 : 7;
      ctx.fillRect(8, bodyY, 16, 18);

      // Helmet visor - cyan
      ctx.fillStyle = "#40d0ff";
      ctx.fillRect(10, bodyY, 12, 8);

      // Helmet border
      ctx.strokeStyle = "#a0a0b0";
      ctx.lineWidth = 1;
      ctx.strokeRect(9.5, bodyY - 0.5, 13, 9);

      // Legs
      ctx.fillStyle = "#b0b0c0";
      if (frame === 0) {
        ctx.fillRect(10, 26, 5, 4);
        ctx.fillRect(17, 26, 5, 4);
      } else {
        ctx.fillRect(9, 25, 5, 5);
        ctx.fillRect(18, 25, 5, 5);
      }

      // Backpack (life support)
      ctx.fillStyle = "#8888a0";
      ctx.fillRect(5, bodyY + 4, 3, 10);

      this.textures.addCanvas(`player-frame-${frame}`, canvas);
    }
  }
}
