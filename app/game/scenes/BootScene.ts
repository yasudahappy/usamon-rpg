import * as Phaser from "phaser";
import { MapData } from "../types";
import { MonsterData } from "../data/types";

const MAP_KEYS = ["moonbase", "sand_route_1", "crater_city", "gym_1"];

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  private getBasePath(): string {
    // Support GitHub Pages basePath
    return typeof window !== "undefined" && window.location.pathname.startsWith("/usamon-rpg")
      ? "/usamon-rpg"
      : "";
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

    const base = this.getBasePath();

    // Load all map data
    MAP_KEYS.forEach((name) => {
      this.load.json(`map-${name}`, `${base}/data/maps/${name}.json`);
    });
    this.load.json("types", `${base}/data/types.json`);
    this.load.json("monsters", `${base}/data/monsters/monsters.json`);
    this.load.json("moves", `${base}/data/moves/moves.json`);
    this.load.json("encounters", `${base}/data/encounters.json`);
    this.load.json("trainers", `${base}/data/trainers.json`);

    // Load tileset spritesheet (Ninja Adventure based)
    this.load.spritesheet("moon-tileset", `${base}/assets/tiles/moon_tileset.png`, {
      frameWidth: 16,
      frameHeight: 16,
    });
  }

  create(): void {
    // Collect all unique tileTypes across all maps
    const allTileTypes: Record<
      string,
      { name: string; color: string; walkable: boolean }
    > = {};
    MAP_KEYS.forEach((name) => {
      const mapData = this.cache.json.get(`map-${name}`) as MapData;
      Object.entries(mapData.tileTypes).forEach(([id, tile]) => {
        if (!allTileTypes[id]) {
          allTileTypes[id] = tile;
        }
      });
    });

    this.generateTileset(allTileTypes);
    this.generatePlayerSprite();
    this.generateMonsterSprites();

    // Show credits briefly
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const credits = this.add.text(w / 2, h - 30,
      "Tileset: Ninja Adventure by Pixel-Boy & AAA (CC0)",
      { fontSize: "10px", color: "#888888", fontFamily: "monospace" }
    ).setOrigin(0.5).setAlpha(0.8);

    this.time.delayedCall(100, () => {
      this.scene.start("MapScene", { mapKey: "moonbase" });
    });
  }

  private generateTileset(
    tileTypes: Record<
      string,
      { name: string; color: string; walkable: boolean }
    >
  ): void {
    const ts = 32;
    const hasSpritesheet = this.textures.exists("moon-tileset");

    Object.entries(tileTypes).forEach(([id, tile]) => {
      const key = `tile-${id}`;
      const tileIndex = parseInt(id, 10);

      // Use spritesheet tile if available (scale 16x16 → 32x32)
      if (hasSpritesheet && tileIndex <= 31) {
        const frame = this.textures.getFrame("moon-tileset", tileIndex);
        if (frame) {
          const canvas = document.createElement("canvas");
          canvas.width = ts;
          canvas.height = ts;
          const ctx = canvas.getContext("2d")!;
          ctx.imageSmoothingEnabled = false; // pixel art!
          ctx.drawImage(
            frame.source.image as HTMLImageElement,
            frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight,
            0, 0, ts, ts
          );
          this.textures.addCanvas(key, canvas);
          return;
        }
      }

      // Fallback: programmatic tile
      const canvas = document.createElement("canvas");
      canvas.width = ts;
      canvas.height = ts;
      const ctx = canvas.getContext("2d")!;

      ctx.fillStyle = tile.color;
      ctx.fillRect(0, 0, ts, ts);

      if (id === "0") {
        // Floor: subtle grid lines (bright cream)
        ctx.strokeStyle = "#d8d0c0";
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, ts - 1, ts - 1);
        ctx.fillStyle = "#d0c8b8";
        ctx.fillRect(ts / 2, ts / 2, 2, 2);
      } else if (id === "1") {
        // Wall: bright metallic
        ctx.fillStyle = "#d0d8e0";
        ctx.fillRect(0, 0, ts, 3);
        ctx.fillRect(0, 0, 3, ts);
        ctx.fillStyle = "#a8b0c0";
        ctx.fillRect(ts - 3, 0, 3, ts);
        ctx.fillRect(0, ts - 3, ts, 3);
        // Rivet details
        ctx.fillStyle = "#d8e0e8";
        ctx.beginPath();
        ctx.arc(6, 6, 2, 0, Math.PI * 2);
        ctx.arc(ts - 6, 6, 2, 0, Math.PI * 2);
        ctx.arc(6, ts - 6, 2, 0, Math.PI * 2);
        ctx.arc(ts - 6, ts - 6, 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (id === "2") {
        // Equipment: bright blue panel
        ctx.strokeStyle = "#70a8d0";
        ctx.lineWidth = 2;
        ctx.strokeRect(2, 2, ts - 4, ts - 4);
        ctx.fillStyle = "#60a0c8";
        ctx.fillRect(6, 8, ts - 12, 3);
        ctx.fillRect(6, 14, ts - 12, 3);
        ctx.fillRect(6, 20, ts - 12, 3);
      } else if (id === "3") {
        // Console: bright glowing screen
        ctx.fillStyle = "#40b0d8";
        ctx.fillRect(4, 4, ts - 8, ts - 8);
        ctx.fillStyle = "#70d0f0";
        ctx.fillRect(6, 6, ts - 12, ts - 12);
        // Blinking light
        ctx.fillStyle = "#a0ffc0";
        ctx.fillRect(8, 8, 4, 4);
      } else if (id === "4") {
        // Central device: bright purple
        ctx.fillStyle = "#a080d0";
        ctx.fillRect(2, 2, ts - 4, ts - 4);
        ctx.strokeStyle = "#c0a0f0";
        ctx.lineWidth = 2;
        ctx.strokeRect(4, 4, ts - 8, ts - 8);
        ctx.fillStyle = "#d0b8ff";
        ctx.beginPath();
        ctx.arc(ts / 2, ts / 2, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (id === "5") {
        // Sand: bright cream with grain texture
        const seed = 42;
        let s = seed;
        const rand = () => {
          s = (s * 16807) % 2147483647;
          return s / 2147483647;
        };
        ctx.fillStyle = "#c8c0a8";
        for (let i = 0; i < 30; i++) {
          ctx.fillRect(rand() * ts, rand() * ts, 1, 1);
        }
        ctx.fillStyle = "#e0d8c0";
        for (let i = 0; i < 15; i++) {
          ctx.fillRect(rand() * ts, rand() * ts, 1, 1);
        }
        ctx.strokeStyle = "#c8c0b0";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(0, 0, ts, ts);
      } else if (id === "6") {
        // Rock: light gray
        ctx.fillStyle = "#98a0a8";
        ctx.beginPath();
        ctx.moveTo(4, ts - 4);
        ctx.lineTo(8, 6);
        ctx.lineTo(16, 2);
        ctx.lineTo(24, 8);
        ctx.lineTo(ts - 4, ts - 4);
        ctx.closePath();
        ctx.fill();
        // Highlight edges
        ctx.strokeStyle = "#b8c0c8";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(8, 6);
        ctx.lineTo(16, 2);
        ctx.lineTo(24, 8);
        ctx.stroke();
        // Shadow edge
        ctx.strokeStyle = "#8890a0";
        ctx.beginPath();
        ctx.moveTo(4, ts - 4);
        ctx.lineTo(ts - 4, ts - 4);
        ctx.stroke();
      } else if (id === "7") {
        // Crater: dark circular depression with rim
        const cx = ts / 2;
        const cy = ts / 2;
        const r = ts / 2 - 2;
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grd.addColorStop(0, "#706880");
        grd.addColorStop(0.6, "#807898");
        grd.addColorStop(1, "#9890a8");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        // Rim highlight (top-left lit)
        ctx.strokeStyle = "#b0a8c0";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI * 1.1, Math.PI * 1.7);
        ctx.stroke();
      } else if (id === "8") {
        // Building: metal panel with rivets and seams
        // Raised border
        ctx.fillStyle = "#d8e0e8";
        ctx.fillRect(0, 0, ts, 3);
        ctx.fillRect(0, 0, 3, ts);
        ctx.fillStyle = "#b0b8c8";
        ctx.fillRect(ts - 3, 0, 3, ts);
        ctx.fillRect(0, ts - 3, ts, 3);
        // Panel seams
        ctx.strokeStyle = "#b8c0d0";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ts / 2, 3);
        ctx.lineTo(ts / 2, ts - 3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(3, ts / 2);
        ctx.lineTo(ts - 3, ts / 2);
        ctx.stroke();
        // Rivets
        ctx.fillStyle = "#e0e8f0";
        ctx.beginPath();
        ctx.arc(6, 6, 1.5, 0, Math.PI * 2);
        ctx.arc(ts - 6, 6, 1.5, 0, Math.PI * 2);
        ctx.arc(6, ts - 6, 1.5, 0, Math.PI * 2);
        ctx.arc(ts - 6, ts - 6, 1.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (id === "9") {
        // Door: bright turquoise portal
        ctx.fillStyle = "#40d0c0";
        ctx.fillRect(2, 0, ts - 4, ts);
        // Gradient glow
        const grd = ctx.createLinearGradient(0, 0, ts, 0);
        grd.addColorStop(0, "rgba(96,232,216,0.3)");
        grd.addColorStop(0.5, "rgba(96,232,216,0.8)");
        grd.addColorStop(1, "rgba(96,232,216,0.3)");
        ctx.fillStyle = grd;
        ctx.fillRect(4, 2, ts - 8, ts - 4);
        // Center light bar
        ctx.fillStyle = "#a0fff0";
        ctx.fillRect(ts / 2 - 1, 4, 2, ts - 8);
        // Glow border
        ctx.strokeStyle = "#80f0e0";
        ctx.lineWidth = 1;
        ctx.strokeRect(3, 1, ts - 6, ts - 2);
      } else if (id === "10") {
        // Gym floor: bright red-pink checkered
        const half = ts / 2;
        ctx.fillStyle = "#e8a0a0";
        ctx.fillRect(0, 0, half, half);
        ctx.fillRect(half, half, half, half);
        ctx.fillStyle = "#f0c0c0";
        ctx.fillRect(half, 0, half, half);
        ctx.fillRect(0, half, half, half);
        // Subtle border
        ctx.strokeStyle = "#d8b0b0";
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, ts - 1, ts - 1);
      } else if (id === "11") {
        // Road: bright beige
        ctx.strokeStyle = "#c0b8a8";
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, ts - 1, ts - 1);
        // Road texture dots
        ctx.fillStyle = "#c8c0b0";
        ctx.fillRect(8, 8, 2, 2);
        ctx.fillRect(22, 22, 2, 2);
      }

      this.textures.addCanvas(key, canvas);
    });
  }

  private generateMonsterSprites(): void {
    const monsters = this.cache.json.get("monsters") as MonsterData[];

    monsters.forEach((mon) => {
      const key = `monster-${mon.id}`;
      // Evolved forms are slightly larger
      const isEvolved = mon.evolution === null && mon.id !== "usamon" && mon.id !== "mochichi" && mon.id !== "sunagani" && mon.id !== "rairai" && mon.id !== "regonyas";
      const size = isEvolved ? 56 : 48;
      // usamon is special (larger, partner)
      const finalSize = mon.id === "usamon" ? 64 : size;

      const canvas = document.createElement("canvas");
      canvas.width = finalSize;
      canvas.height = finalSize;
      const ctx = canvas.getContext("2d")!;

      // Main body circle
      ctx.fillStyle = mon.color;
      ctx.beginPath();
      ctx.arc(finalSize / 2, finalSize / 2, finalSize / 2 - 2, 0, Math.PI * 2);
      ctx.fill();

      // Highlight
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.arc(finalSize / 2 - finalSize * 0.15, finalSize / 2 - finalSize * 0.15, finalSize * 0.18, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      const eyeY = finalSize / 2 - 3;
      const eyeSpacing = finalSize * 0.15;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(finalSize / 2 - eyeSpacing, eyeY, finalSize * 0.09, 0, Math.PI * 2);
      ctx.arc(finalSize / 2 + eyeSpacing, eyeY, finalSize * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111111";
      ctx.beginPath();
      ctx.arc(finalSize / 2 - eyeSpacing + 1, eyeY + 1, finalSize * 0.045, 0, Math.PI * 2);
      ctx.arc(finalSize / 2 + eyeSpacing + 1, eyeY + 1, finalSize * 0.045, 0, Math.PI * 2);
      ctx.fill();

      // Mouth (smile)
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(finalSize / 2, finalSize / 2 + 2, finalSize * 0.12, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();

      // Type indicator line at bottom
      ctx.fillStyle = mon.color;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(4, finalSize - 6, finalSize - 8, 3);
      ctx.globalAlpha = 1;

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
