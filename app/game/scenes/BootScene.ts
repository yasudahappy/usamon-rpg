import * as Phaser from "phaser";
import { MapData } from "../types";
import { MonsterData } from "../data/types";

const MAP_KEYS = ["moonbase", "sand_route_1", "crater_city", "gym_1", "recovery_pod", "planet_shop"];

// Full-body pixel-art sprites (front-facing: enemy in battle, party, dex).
const MONSTER_SPRITE_IDS = [
  "usamon", "mochichi", "mochigori", "gorimocchi", "sunagani", "lobsner",
  "rairai", "ikarion", "regonyas", "sharisu", "sharian",
];
// Back-facing sprites (the player's own monster in battle). Only the ids that
// actually have a "<id>_back.png" asset — others fall back to the front sprite.
const MONSTER_BACK_SPRITE_IDS = [
  "usamon", "sunagani", "lobsner", "regonyas", "rairai", "mochigori", "gorimocchi",
  "ikarion", "sharisu",
];

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
        color: "#ffffff",
        fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 3,
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
    this.load.json("items", `${base}/data/items.json`);

    // Load tileset spritesheet
    this.load.spritesheet("moon-tileset", `${base}/assets/tiles/moon_tileset.png`, {
      frameWidth: 16,
      frameHeight: 16,
    });

    // Load player character spritesheets (5 suit colors)
    const suits = ["white", "blue", "orange", "pink", "black"];
    suits.forEach(suit => {
      this.load.spritesheet(`player-${suit}`, `${base}/assets/characters/player_${suit}.png`, {
        frameWidth: 16,
        frameHeight: 16,
      });
    });

    // Load monster face icons (high-res source for pixel-art downscale)
    const iconMonsters = ["usamon", "mochichi", "sunagani", "rairai", "regonyas"];
    iconMonsters.forEach(id => {
      this.load.image(`icon-src-${id}`, `${base}/assets/monsters/icons/${id}.png`);
    });

    // Load full-body pixel sprites (used as monster-<id> in battle & party).
    MONSTER_SPRITE_IDS.forEach(id => {
      this.load.image(`monster-${id}`, `${base}/assets/monsters/sprites/${id}.png`);
    });
    // Load back-facing sprites (monster-<id>-back) for the player's monster.
    MONSTER_BACK_SPRITE_IDS.forEach(id => {
      this.load.image(`monster-${id}-back`, `${base}/assets/monsters/sprites/${id}_back.png`);
    });

    // Load building sprites
    this.load.image("bldg-habitat", `${base}/assets/buildings/sprites/habitat.png`);
    this.load.image("bldg-observatory", `${base}/assets/buildings/sprites/observatory.png`);
    this.load.image("bldg-dome-green", `${base}/assets/buildings/sprites/dome_green.png`);
    this.load.image("bldg-dome-red", `${base}/assets/buildings/sprites/dome_red.png`);
    this.load.image("bldg-dome-yellow", `${base}/assets/buildings/sprites/dome_yellow.png`);
    this.load.image("bldg-dome-blue", `${base}/assets/buildings/sprites/dome_blue.png`);
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
    this.generatePixelIcons();

    // Check for existing save data
    let hasSave = false;
    try {
      hasSave = !!localStorage.getItem("usamon-player-setup");
    } catch (e) { /* ignore */ }

    if (hasSave) {
      // Load saved setup and apply suit color
      try {
        const setup = JSON.parse(localStorage.getItem("usamon-player-setup") || "{}");
        if (setup.suitColor) {
          this.applySuitFrames(setup.suitColor);
        }
      } catch (e) { /* ignore */ }

      // Load full save data if available
      let mapKey = "moonbase";
      let sceneData: Record<string, unknown> = { mapKey };
      try {
        const raw = localStorage.getItem("usamon-save-data");
        if (raw) {
          const save = JSON.parse(raw);
          sceneData = {
            mapKey: save.mapKey || "moonbase",
            playerX: save.gridX,
            playerY: save.gridY,
            playerState: save.playerState,
          };
        }
      } catch (e) { /* ignore */ }

      this.scene.start("MapScene", sceneData);
    } else {
      this.scene.start("SetupScene");
    }
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
      if (hasSpritesheet && tileIndex <= 56) {
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

    // Animation frames (e.g. sand sparkle, tiles 41-56) are referenced by the
    // MapScene tile animator but are not listed in any map's tileTypes, so they
    // were never generated and showed up as the magenta/green "missing texture"
    // placeholder. Generate a tile texture for every remaining spritesheet frame.
    if (hasSpritesheet) {
      const frameTotal = this.textures.get("moon-tileset").frameTotal;
      for (let tileIndex = 0; tileIndex <= 56 && tileIndex < frameTotal; tileIndex++) {
        const key = `tile-${tileIndex}`;
        if (this.textures.exists(key)) continue;
        const frame = this.textures.getFrame("moon-tileset", tileIndex);
        if (!frame) continue;
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
      }
    }
  }

  private generateMonsterSprites(): void {
    const monsters = this.cache.json.get("monsters") as MonsterData[];

    monsters.forEach((mon) => {
      const key = `monster-${mon.id}`;
      // Skip if a real full-body sprite was already loaded for this monster.
      if (this.textures.exists(key)) return;
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

  /**
   * Generate pixel-art icons from high-res source icons.
   * Downscale to 36px with nearest-neighbor (no antialiasing) for retro look.
   */
  private generatePixelIcons(): void {
    const PIXEL_SIZE = 36;
    const iconMonsters = ["usamon", "mochichi", "sunagani", "rairai", "regonyas"];
    for (const id of iconMonsters) {
      const srcKey = `icon-src-${id}`;
      if (!this.textures.exists(srcKey)) continue;
      const srcImg = this.textures.get(srcKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      const canvas = document.createElement("canvas");
      canvas.width = PIXEL_SIZE;
      canvas.height = PIXEL_SIZE;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false; // nearest-neighbor for pixel art
      ctx.drawImage(srcImg, 0, 0, PIXEL_SIZE, PIXEL_SIZE);
      const key = `icon-${id}`;
      if (this.textures.exists(key)) this.textures.remove(key);
      this.textures.addCanvas(key, canvas);
    }
  }


  // Spritesheet layout (Ninja Adventure 16x16, 4 cols × 7 rows):
  // Row 0: Down (facing camera), Row 1: Up (facing away)
  // Row 2: Down variant, Row 3: Up variant
  // Row 4: Left, Row 5: Right
  // Row 6: Extra animation
  // Col 0: idle, Col 1: walk frame
  private static DIR_FRAMES: Record<string, [number, number]> = {
    down:  [0, 1],
    up:    [4, 5],
    left:  [16, 17],
    right: [20, 21],
  };

  private generateDirectionalFrames(suitKey: string): void {
    if (!this.textures.exists(suitKey)) return;
    for (const [dir, [f0, f1]] of Object.entries(BootScene.DIR_FRAMES)) {
      for (let i = 0; i < 2; i++) {
        const srcFrame = this.textures.getFrame(suitKey, i === 0 ? f0 : f1);
        if (!srcFrame) continue;
        const canvas = document.createElement("canvas");
        canvas.width = 32; canvas.height = 32;
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          srcFrame.source.image as HTMLImageElement,
          srcFrame.cutX, srcFrame.cutY, srcFrame.cutWidth, srcFrame.cutHeight,
          0, 0, 32, 32
        );
        const key = `player-${dir}-${i}`;
        if (this.textures.exists(key)) this.textures.remove(key);
        this.textures.addCanvas(key, canvas);
      }
    }
    // Legacy compat: player-frame-0/1 = down-0/1
    for (let i = 0; i < 2; i++) {
      const key = `player-frame-${i}`;
      const srcKey = `player-down-${i}`;
      if (this.textures.exists(srcKey)) {
        if (this.textures.exists(key)) this.textures.remove(key);
        const src = this.textures.get(srcKey).getSourceImage() as HTMLCanvasElement;
        this.textures.addCanvas(key, src);
      }
    }
  }

  private applySuitFrames(suitColor: string): void {
    this.generateDirectionalFrames(`player-${suitColor}`);
  }

  private generatePlayerSprite(): void {
    this.generateDirectionalFrames("player-white");
  }
}
