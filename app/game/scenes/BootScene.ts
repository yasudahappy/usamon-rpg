import * as Phaser from "phaser";
import { MapData } from "../types";
import { MonsterData } from "../data/types";

const MAP_KEYS = ["moonbase", "sand_route_1", "crater_city", "gym_1"];

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

    // Load all map data
    MAP_KEYS.forEach((name) => {
      this.load.json(`map-${name}`, `/data/maps/${name}.json`);
    });
    this.load.json("types", "/data/types.json");
    this.load.json("monsters", "/data/monsters/monsters.json");
    this.load.json("moves", "/data/moves/moves.json");
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
    this.scene.start("MapScene", { mapKey: "moonbase" });
  }

  private generateTileset(
    tileTypes: Record<
      string,
      { name: string; color: string; walkable: boolean }
    >
  ): void {
    const ts = 32;

    Object.entries(tileTypes).forEach(([id, tile]) => {
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
      } else if (id === "5") {
        // Sand (regolith): beige-gray with grain texture
        const seed = 42;
        let s = seed;
        const rand = () => {
          s = (s * 16807) % 2147483647;
          return s / 2147483647;
        };
        // Dark grains
        ctx.fillStyle = "#7a7468";
        for (let i = 0; i < 30; i++) {
          ctx.fillRect(rand() * ts, rand() * ts, 1, 1);
        }
        // Light grains
        ctx.fillStyle = "#9a9488";
        for (let i = 0; i < 15; i++) {
          ctx.fillRect(rand() * ts, rand() * ts, 1, 1);
        }
        // Subtle border for tile separation
        ctx.strokeStyle = "#7a7a70";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(0, 0, ts, ts);
      } else if (id === "6") {
        // Rock: dark with jagged shape
        ctx.fillStyle = "#3a3a40";
        ctx.beginPath();
        ctx.moveTo(4, ts - 4);
        ctx.lineTo(8, 6);
        ctx.lineTo(16, 2);
        ctx.lineTo(24, 8);
        ctx.lineTo(ts - 4, ts - 4);
        ctx.closePath();
        ctx.fill();
        // Highlight edges
        ctx.strokeStyle = "#6a6a70";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(8, 6);
        ctx.lineTo(16, 2);
        ctx.lineTo(24, 8);
        ctx.stroke();
        // Shadow edge
        ctx.strokeStyle = "#2a2a30";
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
        grd.addColorStop(0, "#0a0a10");
        grd.addColorStop(0.6, "#151520");
        grd.addColorStop(1, "#2a2a35");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        // Rim highlight (top-left lit)
        ctx.strokeStyle = "#5a5a65";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI * 1.1, Math.PI * 1.7);
        ctx.stroke();
      } else if (id === "8") {
        // Building: metal panel with rivets and seams
        // Raised border
        ctx.fillStyle = "#a8a8b0";
        ctx.fillRect(0, 0, ts, 3);
        ctx.fillRect(0, 0, 3, ts);
        ctx.fillStyle = "#858590";
        ctx.fillRect(ts - 3, 0, 3, ts);
        ctx.fillRect(0, ts - 3, ts, 3);
        // Panel seams
        ctx.strokeStyle = "#8a8a95";
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
        ctx.fillStyle = "#babac0";
        ctx.beginPath();
        ctx.arc(6, 6, 1.5, 0, Math.PI * 2);
        ctx.arc(ts - 6, 6, 1.5, 0, Math.PI * 2);
        ctx.arc(6, ts - 6, 1.5, 0, Math.PI * 2);
        ctx.arc(ts - 6, ts - 6, 1.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (id === "9") {
        // Door: glowing cyan portal
        ctx.fillStyle = "#1a3a4a";
        ctx.fillRect(2, 0, ts - 4, ts);
        // Gradient glow
        const grd = ctx.createLinearGradient(0, 0, ts, 0);
        grd.addColorStop(0, "rgba(48,213,200,0.2)");
        grd.addColorStop(0.5, "rgba(48,213,200,0.7)");
        grd.addColorStop(1, "rgba(48,213,200,0.2)");
        ctx.fillStyle = grd;
        ctx.fillRect(4, 2, ts - 8, ts - 4);
        // Center light bar
        ctx.fillStyle = "#60f0e8";
        ctx.fillRect(ts / 2 - 1, 4, 2, ts - 8);
        // Glow border
        ctx.strokeStyle = "#40e0d8";
        ctx.lineWidth = 1;
        ctx.strokeRect(3, 1, ts - 6, ts - 2);
      } else if (id === "10") {
        // Gym floor: red-black checkered
        const half = ts / 2;
        ctx.fillStyle = "#6a2020";
        ctx.fillRect(0, 0, half, half);
        ctx.fillRect(half, half, half, half);
        ctx.fillStyle = "#3a1010";
        ctx.fillRect(half, 0, half, half);
        ctx.fillRect(0, half, half, half);
        // Subtle border
        ctx.strokeStyle = "#4a1515";
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, ts - 1, ts - 1);
      } else if (id === "11") {
        // Road: medium gray with subtle texture
        ctx.strokeStyle = "#656570";
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, ts - 1, ts - 1);
        // Road texture dots
        ctx.fillStyle = "#686870";
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
