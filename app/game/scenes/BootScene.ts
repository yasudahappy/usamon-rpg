import * as Phaser from "phaser";
import { MapData } from "../types";
import { MonsterData } from "../data/types";

const MAP_KEYS = ["moonbase", "moon_town", "sand_route_1", "sand_route_2", "crater_city", "gym_1", "recovery_pod", "planet_shop", "player_home", "rival_home", "medical_center", "house_1", "house_2", "house_3", "house_4", "farm_dome", "crater_cave", "crater_cave_b1", "crater_cave_b2", "nectar_town", "recovery_pod_2", "planet_shop_2", "house_5", "house_6", "house_7", "gym_2", "frost_route_1", "pit_village", "lava_tube", "recovery_pod_3", "house_8", "planet_shop_3", "lava_tube_deep", "rill_route", "minori_town", "gym_3", "recovery_pod_4", "planet_shop_4", "house_9"];

// Full-body pixel-art sprites (front-facing: enemy in battle, party, dex).
const MONSTER_SPRITE_IDS = [
  "usamon", "mochichi", "mochigori", "gorimocchi", "sunagani", "lobsner",
  "rairai", "ikarion", "regonyas", "sharisu", "sharian", "meteko", "meteodon",
  "roubau", "roubaag", "shakurin", "shakuros", "shakuruton",
  "hotaruna", "lunalux", "genbu", "pribo", "ganburos",
  "hidaneko", "kagario", "solpoka", "fureado", "prominence",
];
// Back-facing sprites (the player's own monster in battle). Only the ids that
// actually have a "<id>_back.png" asset — others fall back to the front sprite.
const MONSTER_BACK_SPRITE_IDS = [
  "usamon", "mochichi", "mochigori", "gorimocchi", "sunagani", "lobsner",
  "rairai", "ikarion", "regonyas", "sharisu", "sharian", "meteko", "meteodon",
  "roubau", "roubaag", "shakurin", "shakuros", "shakuruton",
  "hotaruna", "lunalux", "genbu", "pribo", "ganburos",
  "hidaneko", "kagario", "solpoka", "fureado", "prominence",
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
    // Girl protagonist: overworld directions (4) + character-select art + battle back
    ["down", "up", "left", "right"].forEach(dir => {
      this.load.image(`player-girl-${dir}`, `${base}/assets/characters/player_girl_${dir}.png`);
    });
    this.load.image("select-boy", `${base}/assets/characters/select_boy.png`);
    this.load.image("select-girl", `${base}/assets/characters/select_girl.png`);
    this.load.image("player-back-girl", `${base}/assets/characters/battle/player_back_girl.png`);

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
    this.load.image("bldg-planet-shop", `${base}/assets/buildings/sprites/planet_shop.png`);
    this.load.image("bldg-recovery-pod", `${base}/assets/buildings/sprites/recovery_pod.png`);
    this.load.image("bldg-moonbase-lab", `${base}/assets/buildings/sprites/moonbase_lab.png`);
    this.load.image("bldg-house-dome", `${base}/assets/buildings/sprites/house_dome.png`);
    this.load.image("bldg-gym", `${base}/assets/buildings/sprites/gym.png`);
    this.load.image("bldg-medical", `${base}/assets/buildings/sprites/medical_center.png`);
    this.load.image("bldg-farm", `${base}/assets/buildings/sprites/farm_dome.png`);
    // ミノリタウン限定の建物（温室・地熱プラント・サイロ・太陽光・蓄電池）
    this.load.image("bldg-greenhouse", `${base}/assets/buildings/sprites/greenhouse.png`);
    this.load.image("bldg-geo-plant", `${base}/assets/buildings/sprites/geo_plant.png`);
    this.load.image("bldg-silo", `${base}/assets/buildings/sprites/silo.png`);
    this.load.image("bldg-solar-array", `${base}/assets/buildings/sprites/solar_array.png`);
    this.load.image("bldg-battery", `${base}/assets/buildings/sprites/battery_box.png`);

    // Trainer battle portraits (hand-drawn, background removed)
    ["suit", "casual", "peace", "hoodie", "eezen", "girl", "worker", "redcap", "armor", "emo", "shin", "kojima", "masaki", "bikyaku", "takehana", "sunaga", "shiina", "aragaki", "astronaut", "shinobu", "kiyohara", "voice_grunt1", "voice_grunt2", "voice_grunt3", "voice_grunt4", "ishii", "shiori", "kishishita", "hijiri"].forEach(t => {
      this.load.image(`trainer-${t}`, `${base}/assets/trainers/${t}.png`);
    });
    // Player battle back-illustration (shown before sending out the almon)
    this.load.image("player-back", `${base}/assets/characters/battle/player_back.png`);
    // イーゼン overworld NPC sprite (4 directions)
    ["down", "up", "left", "right"].forEach(dir => {
      this.load.image(`cast-eezen-${dir}`, `${base}/assets/characters/cast/eezen_${dir}.png`);
    });
    // ヴォイス幹部・団員 overworld NPC sprites (4 directions each)
    ["shinobu", "kiyohara", "voice_grunt1", "voice_grunt2", "voice_grunt3", "voice_grunt4"].forEach(who => {
      ["down", "up", "left", "right"].forEach(dir => {
        this.load.image(`cast-${who}-${dir}`, `${base}/assets/characters/cast/${who}_${dir}.png`);
      });
    });
    // トレーナー専用 overworld NPC sprites (4 directions each)
    ["aragaki", "shiina", "sunaga", "astronaut", "bikyaku", "shin", "emo", "elder", "masaki", "kojima", "colonist_m", "mom2", "colonist_e"].forEach(who => {
      ["down", "up", "left", "right"].forEach(dir => {
        this.load.image(`cast-${who}-${dir}`, `${base}/assets/characters/cast/${who}_${dir}.png`);
      });
    });

    // Title screen key art (continue / new-game menu)
    this.load.image("title-art", `${base}/assets/ui/title.jpg`);

    // Item icons
    this.load.image("item-moon-capsule", `${base}/assets/items/moon_capsule.png`);

    // Hand-drawn cast: protagonist (char0, all 4 dirs) + NPC portraits (front).
    ["down", "up", "left", "right"].forEach(dir => {
      this.load.image(`cast-char0-${dir}`, `${base}/assets/characters/cast/char0_${dir}.png`);
    });
    [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(c => {
      ["down", "up", "left", "right"].forEach(dir => {
        this.load.image(`cast-char${c}-${dir}`, `${base}/assets/characters/cast/char${c}_${dir}.png`);
      });
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
    this.generatePixelIcons();

    // Apply the saved character's walk frames (if a setup exists) so the title
    // screen and any continue land on the right sprite.
    try {
      const setup = JSON.parse(localStorage.getItem("usamon-player-setup") || "{}");
      if (setup.gender === "girl") this.generateGirlFrames();
      else if (setup.gender || setup.suitColor) this.applySuitFrames(setup.suitColor || "white");
    } catch (e) { /* ignore */ }

    // The title screen (thumbnail → START → つづき/さいしょ/せってい) is always the
    // entry point; さいしょから routes into character setup.
    this.scene.start("TitleScene");
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
      } else if (id === "60") {
        // Moon regolith ground: speckled greyish soil + tiny craters (seamless)
        let s = 91;
        const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        ctx.fillStyle = "#a49d8c";
        for (let i = 0; i < 46; i++) ctx.fillRect(rand() * ts, rand() * ts, 1, 1);
        ctx.fillStyle = "#c2bcac";
        for (let i = 0; i < 22; i++) ctx.fillRect(rand() * ts, rand() * ts, 1, 1);
        // two shallow craters
        for (const [cx, cy, r] of [[9, 22, 3], [24, 9, 2]] as [number, number, number][]) {
          ctx.strokeStyle = "#8f8877"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = "#c6c0b0"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 1.1, Math.PI * 1.7); ctx.stroke();
        }
      } else if (id === "61") {
        // Paved walkway: light stone panels with seams + corner rivets
        ctx.strokeStyle = "#c2baa8"; ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, ts - 1, ts - 1);
        ctx.beginPath(); ctx.moveTo(ts / 2, 1); ctx.lineTo(ts / 2, ts - 1);
        ctx.moveTo(1, ts / 2); ctx.lineTo(ts - 1, ts / 2); ctx.stroke();
        ctx.fillStyle = "#e6e0d2";
        ctx.fillRect(2, 2, ts - 4, 1);
        ctx.fillStyle = "#cfc8b8";
        for (const [rx, ry] of [[5, 5], [ts - 6, 5], [5, ts - 6], [ts - 6, ts - 6]] as [number, number][]) {
          ctx.fillRect(rx, ry, 2, 2);
        }
      } else if (id === "62") {
        // Cultivated turf: soft green ground with grass tufts
        let s = 137;
        const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        ctx.fillStyle = "#7f9e72";
        for (let i = 0; i < 40; i++) ctx.fillRect(rand() * ts, rand() * ts, 1, 2);
        ctx.fillStyle = "#a2c091";
        for (let i = 0; i < 24; i++) ctx.fillRect(rand() * ts, rand() * ts, 1, 2);
        ctx.fillStyle = "#6b8a5f";
        for (let i = 0; i < 14; i++) ctx.fillRect(rand() * ts, rand() * ts, 1, 1);
      } else if (id === "65") {
        // Facility path: the plaza floor, just a bit darker (same cool palette).
        if (hasSpritesheet) {
          const gf = this.textures.getFrame("moon-tileset", 40);
          if (gf) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(gf.source.image as HTMLImageElement,
              gf.cutX, gf.cutY, gf.cutWidth, gf.cutHeight, 0, 0, ts, ts);
          } else { ctx.fillStyle = tile.color; ctx.fillRect(0, 0, ts, ts); }
        } else { ctx.fillStyle = tile.color; ctx.fillRect(0, 0, ts, ts); }
        // darken slightly with a cool tint so it reads as a path, same colour family
        ctx.fillStyle = "rgba(46,62,78,0.24)"; ctx.fillRect(0, 0, ts, ts);
        // faint seam border
        ctx.strokeStyle = "rgba(70,88,104,0.45)"; ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, ts - 1, ts - 1);
      } else if (id === "63" || id === "64") {
        // Fence (railing) that tiles seamlessly along the town border.
        //  63 = horizontal run (top/bottom edges), 64 = vertical run (left/right).
        // Ground base = the town's plaza floor (tileset frame 40) so the fence
        // sits on the exact same ground colour as the walkable town tiles.
        if (hasSpritesheet) {
          const gf = this.textures.getFrame("moon-tileset", 40);
          if (gf) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(
              gf.source.image as HTMLImageElement,
              gf.cutX, gf.cutY, gf.cutWidth, gf.cutHeight,
              0, 0, ts, ts
            );
          }
        }
        const vertical = id === "64";
        // helper drawing a "horizontal" fence, rotated when vertical
        const bar = (a: number, b: number, len: number, thick: number, col: string) => {
          ctx.fillStyle = col;
          if (!vertical) ctx.fillRect(a, b, len, thick);
          else ctx.fillRect(b, a, thick, len);
        };
        const post = (center: number, col: string, w: number) => {
          ctx.fillStyle = col;
          if (!vertical) ctx.fillRect(center - w / 2, 4, w, ts - 8);
          else ctx.fillRect(4, center - w / 2, ts - 8, w);
        };
        // two rails spanning the full length (so neighbours connect seamlessly)
        bar(0, 8, ts, 4, "#aeb6c4");   // upper rail shadow
        bar(0, 8, ts, 2, "#e8edf5");   // upper rail highlight
        bar(0, 19, ts, 4, "#9aa3b3");  // lower rail shadow
        bar(0, 19, ts, 2, "#dfe5ef");  // lower rail highlight
        // post at tile centre -> evenly spaced posts across the run
        post(ts / 2, "#8b93a3", 6);
        post(ts / 2, "#cfd6e2", 3);
        // post cap
        ctx.fillStyle = "#eef2f8";
        if (!vertical) ctx.fillRect(ts / 2 - 3, 3, 6, 3);
        else ctx.fillRect(3, ts / 2 - 3, 3, 6);
      } else if (id === "70" || id === "71" || id === "72") {
        // Farm crop bed — 3-frame animation (70=base,71=A,72=B) cycled by the
        // MapScene tile animator. Grow-light pulses + crops sway for "movement".
        const phase = id === "70" ? 0 : id === "71" ? 1 : 2;
        // tilled soil base with furrows
        ctx.fillStyle = "#5b4632"; ctx.fillRect(0, 0, ts, ts);
        ctx.fillStyle = "#493627";
        for (let yy = 4; yy < ts; yy += 8) ctx.fillRect(0, yy, ts, 3);   // furrow shadow
        ctx.fillStyle = "#6d5640";
        for (let yy = 1; yy < ts; yy += 8) ctx.fillRect(0, yy, ts, 1);   // furrow highlight
        ctx.fillStyle = "#3d2c1e";                                        // scattered soil grains
        for (const [gx2, gy2] of [[5, 6], [13, 14], [24, 9], [9, 22], [27, 24], [19, 27]] as [number, number][]) ctx.fillRect(gx2, gy2, 1, 1);
        // grow-light glow (pulses brighter across frames)
        const glow = [0.10, 0.20, 0.30][phase];
        const g = ctx.createRadialGradient(16, 13, 1, 16, 13, 20);
        g.addColorStop(0, `rgba(150,255,205,${glow})`);
        g.addColorStop(1, "rgba(150,255,205,0)");
        ctx.fillStyle = g; ctx.fillRect(0, 0, ts, ts);
        // crops (lean sways with the frame)
        const lean = [0, -2, 2][phase];
        const plant = (bx: number, by: number, h: number, leaf: string) => {
          ctx.strokeStyle = "#3d7a35"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + lean, by - h); ctx.stroke();
          ctx.fillStyle = leaf;
          ctx.beginPath(); ctx.ellipse(bx + lean - 3, by - h + 4, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(bx + lean + 3, by - h + 6, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(bx + lean, by - h - 1, 2.5, 3.5, 0, 0, Math.PI * 2); ctx.fill();  // bud
        };
        plant(8, 27, 12, "#5fae4a");
        plant(17, 29, 16, "#6cc255");
        plant(26, 27, 11, "#57a244");
      } else if (id === "80") {
        // Cave floor: dark rocky ground with speckle + faint ember glow
        let s = 53;
        const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        ctx.fillStyle = "#2c252f";
        for (let i = 0; i < 40; i++) ctx.fillRect(rand() * ts, rand() * ts, 1, 1);
        ctx.fillStyle = "#48404c";
        for (let i = 0; i < 20; i++) ctx.fillRect(rand() * ts, rand() * ts, 1, 1);
        // a couple of small cracks with warm glow
        ctx.strokeStyle = "rgba(255,110,30,0.22)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(6, 24); ctx.lineTo(12, 18); ctx.lineTo(10, 12); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(22, 6); ctx.lineTo(26, 12); ctx.stroke();
      } else if (id === "81") {
        // Cave rock wall: chunky dark boulders with rim light
        ctx.fillStyle = "#1b151c"; ctx.fillRect(0, 0, ts, ts);
        let s = 88;
        const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        for (const [bx, by, br] of [[8, 9, 8], [22, 8, 7], [9, 23, 7], [24, 24, 8], [16, 16, 6]] as [number, number, number][]) {
          ctx.fillStyle = "#332a37";
          ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#4a3f50"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(bx, by, br, Math.PI * 1.05, Math.PI * 1.75); ctx.stroke();
        }
        ctx.fillStyle = "#0f0b10";
        for (let i = 0; i < 12; i++) ctx.fillRect(rand() * ts, rand() * ts, 1, 1);
      } else if (id === "82") {
        // Ladder (ハシゴ): cave floor base + wooden rails and rungs
        ctx.fillStyle = "#2c252f"; ctx.fillRect(0, 0, ts, ts);
        const railL = 8, railR = ts - 8;
        ctx.fillStyle = "#5a4020";
        ctx.fillRect(railL - 2, 0, 4, ts);
        ctx.fillRect(railR - 2, 0, 4, ts);
        ctx.fillStyle = "#8a6636";
        ctx.fillRect(railL - 2, 0, 2, ts);
        ctx.fillRect(railR - 2, 0, 2, ts);
        // rungs
        ctx.fillStyle = "#7a5a34";
        for (let ry = 4; ry < ts; ry += 8) ctx.fillRect(railL, ry, railR - railL, 3);
        ctx.fillStyle = "#a07d45";
        for (let ry = 4; ry < ts; ry += 8) ctx.fillRect(railL, ry, railR - railL, 1);
      } else if (id === "83") {
        // 縦孔 (lunar pit): near-black depths with a faint cool rim glow.
        ctx.fillStyle = "#08060a"; ctx.fillRect(0, 0, ts, ts);
        const grd = ctx.createRadialGradient(ts / 2, ts / 2, 4, ts / 2, ts / 2, ts * 0.8);
        grd.addColorStop(0, "rgba(0,0,0,0.9)");
        grd.addColorStop(1, "rgba(56,66,88,0.25)");
        ctx.fillStyle = grd; ctx.fillRect(0, 0, ts, ts);
        ctx.fillStyle = "rgba(120,140,170,0.12)";
        ctx.fillRect(0, 0, ts, 2);
      } else if (id === "100") {
        // マグマ / あつい裂け目: glowing molten channel (blocked). Bright core
        // snaking through dark crust so the "danger" reads at a glance.
        ctx.fillStyle = "#3a1410"; ctx.fillRect(0, 0, ts, ts);
        const grd = ctx.createLinearGradient(0, 0, ts, ts);
        grd.addColorStop(0, "#c83a10"); grd.addColorStop(0.5, "#f07020"); grd.addColorStop(1, "#c83a10");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(0, 10); ctx.quadraticCurveTo(10, 4, 18, 12);
        ctx.quadraticCurveTo(26, 20, ts, 14);
        ctx.lineTo(ts, 24); ctx.quadraticCurveTo(20, 30, 10, 24);
        ctx.quadraticCurveTo(4, 20, 0, 22); ctx.closePath(); ctx.fill();
        // white-hot core + floating crust plates
        ctx.fillStyle = "#ffd070";
        ctx.fillRect(6, 14, 7, 2); ctx.fillRect(20, 17, 6, 2);
        ctx.fillStyle = "#4a1c14";
        ctx.fillRect(14, 8, 5, 3); ctx.fillRect(24, 22, 4, 3); ctx.fillRect(2, 24, 5, 3);
      } else if (id === "101") {
        // ひえたマグマばし: cooled lava bridge — dark basalt with faint warm seams
        ctx.fillStyle = "#5c4a44"; ctx.fillRect(0, 0, ts, ts);
        let s = 71;
        const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        ctx.fillStyle = "#4a3a36";
        for (let i = 0; i < 30; i++) ctx.fillRect(rand() * ts, rand() * ts, 2, 1);
        ctx.fillStyle = "#6e5a52";
        for (let i = 0; i < 14; i++) ctx.fillRect(rand() * ts, rand() * ts, 1, 1);
        // hexagonal cooling-crack pattern hint + dying embers
        ctx.strokeStyle = "rgba(30,20,18,0.8)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(4, 8); ctx.lineTo(14, 6); ctx.lineTo(20, 14); ctx.lineTo(14, 24); ctx.lineTo(5, 22); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(20, 14); ctx.lineTo(28, 10); ctx.stroke();
        ctx.fillStyle = "rgba(240,110,40,0.5)";
        ctx.fillRect(9, 15, 2, 1); ctx.fillRect(23, 21, 2, 1);
      } else if (id === "102") {
        // ジム床(玄武岩): dark basalt tiles with a warm grid — the fire gym hall
        ctx.fillStyle = "#4a3c40"; ctx.fillRect(0, 0, ts, ts);
        ctx.strokeStyle = "#5e4c50"; ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, ts - 1, ts - 1);
        ctx.fillStyle = "#56464a";
        ctx.fillRect(ts / 2 - 1, ts / 2 - 1, 2, 2);
        ctx.fillStyle = "rgba(240,140,60,0.18)";
        ctx.fillRect(4, 4, 5, 1); ctx.fillRect(22, 25, 5, 1);
      } else if (id === "103") {
        // リルの溝: a dark collapsed groove sunk into the regolith plain
        ctx.fillStyle = "#c8bfae"; ctx.fillRect(0, 0, ts, ts);
        const grd = ctx.createLinearGradient(0, 0, 0, ts);
        grd.addColorStop(0, "#5a5045"); grd.addColorStop(0.45, "#3e362e");
        grd.addColorStop(0.75, "#4a4038"); grd.addColorStop(1, "#8a8272");
        ctx.fillStyle = grd; ctx.fillRect(0, 3, ts, ts - 5);
        // rim shadow (top lip) + lit bottom lip
        ctx.fillStyle = "#2e2822"; ctx.fillRect(0, 3, ts, 3);
        ctx.fillStyle = "#d8d0c0"; ctx.fillRect(0, ts - 2, ts, 2);
        // rocky texture inside the trench
        let s = 63;
        const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        ctx.fillStyle = "#2a241e";
        for (let i = 0; i < 16; i++) ctx.fillRect(rand() * ts, 8 + rand() * 16, 2, 1);
        ctx.fillStyle = "#6e6254";
        for (let i = 0; i < 8; i++) ctx.fillRect(rand() * ts, 8 + rand() * 14, 1, 1);
      } else if (id === "90") {
        // Frost regolith (ネクタルタウンの霜地面): pale blue-grey soil + frost specks
        let s = 17;
        const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        ctx.fillStyle = "#b6c2cf";
        for (let i = 0; i < 44; i++) ctx.fillRect(rand() * ts, rand() * ts, 1, 1);
        ctx.fillStyle = "#e8f2fa";
        for (let i = 0; i < 18; i++) ctx.fillRect(rand() * ts, rand() * ts, 1, 1);
        // faint frost sparkles
        ctx.fillStyle = "#ffffff";
        for (const [fx, fy] of [[7, 21], [23, 10]] as [number, number][]) {
          ctx.fillRect(fx, fy, 1, 1); ctx.fillRect(fx - 1, fy, 1, 1); ctx.fillRect(fx + 1, fy, 1, 1);
          ctx.fillRect(fx, fy - 1, 1, 1); ctx.fillRect(fx, fy + 1, 1, 1);
        }
      } else if (id === "91") {
        // Ice patch (こおりのまだら): glossy pale-blue sheet with cracks
        const grd = ctx.createLinearGradient(0, 0, ts, ts);
        grd.addColorStop(0, "#cfe6f5"); grd.addColorStop(0.5, "#aacfe8"); grd.addColorStop(1, "#c4e0f2");
        ctx.fillStyle = grd; ctx.fillRect(0, 0, ts, ts);
        ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(4, 26); ctx.lineTo(13, 17); ctx.lineTo(11, 8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(20, 28); ctx.lineTo(25, 18); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillRect(6, 5, 6, 2); ctx.fillRect(22, 12, 4, 2);
      } else if (id === "92") {
        // Frozen rock (凍った岩): bluish boulder face with icy top edge
        ctx.fillStyle = "#8795a8"; ctx.fillRect(0, 0, ts, ts);
        ctx.fillStyle = "#a8b8cc"; ctx.fillRect(0, 0, ts, 4);
        ctx.fillStyle = "#6c7a8e"; ctx.fillRect(0, ts - 4, ts, 4);
        ctx.fillStyle = "#98a8bc";
        ctx.beginPath(); ctx.arc(10, 14, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(23, 20, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#dceafc"; ctx.fillRect(4, 2, 8, 2); ctx.fillRect(18, 3, 6, 2);
      } else if (id === "93") {
        // Frost-stone road (こおりみち): cold blue-grey paving slabs with clear
        // joints so the road pops against the pale frost ground.
        ctx.fillStyle = "#b7c9db"; ctx.fillRect(0, 0, ts, ts);
        // 2x2 slabs per tile, each with a top-left highlight and bottom shadow
        const slab = (sx: number, sy: number, w: number, h: number) => {
          ctx.fillStyle = "#c6d8e8"; ctx.fillRect(sx, sy, w, h);
          ctx.fillStyle = "#d9e8f4"; ctx.fillRect(sx, sy, w, 2); ctx.fillRect(sx, sy, 2, h);
          ctx.fillStyle = "#9fb3c8"; ctx.fillRect(sx, sy + h - 2, w, 2); ctx.fillRect(sx + w - 2, sy, 2, h);
        };
        slab(1, 1, 14, 14); slab(17, 1, 14, 14);
        slab(1, 17, 14, 14); slab(17, 17, 14, 14);
        // dark mortar joints (the cross between slabs + tile edges)
        ctx.fillStyle = "#8ba0b6";
        ctx.fillRect(0, 15, ts, 2); ctx.fillRect(15, 0, 2, ts);
        ctx.fillRect(0, 0, ts, 1); ctx.fillRect(0, ts - 1, ts, 1);
        ctx.fillRect(0, 0, 1, ts); ctx.fillRect(ts - 1, 0, 1, ts);
        // light dusting of snow so it still belongs to the wintry town
        let s = 29;
        const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        ctx.fillStyle = "rgba(240,248,255,0.7)";
        for (let i = 0; i < 8; i++) ctx.fillRect(rand() * ts, rand() * ts, 2, 1);
      } else if (id === "94" || id === "95") {
        // Frost twinkle frames for tile 90 (animated via MapScene SPARKLE_MAP):
        // same frost base + bright cross-shaped glints at alternating spots.
        let s = 17;
        const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        ctx.fillStyle = "#dce6ee"; ctx.fillRect(0, 0, ts, ts);
        ctx.fillStyle = "#b6c2cf";
        for (let i = 0; i < 44; i++) ctx.fillRect(rand() * ts, rand() * ts, 1, 1);
        ctx.fillStyle = "#e8f2fa";
        for (let i = 0; i < 18; i++) ctx.fillRect(rand() * ts, rand() * ts, 1, 1);
        const spots: [number, number][] = id === "94" ? [[7, 21], [23, 10]] : [[16, 6], [10, 26], [26, 22]];
        ctx.fillStyle = "#ffffff";
        for (const [fx, fy] of spots) {
          ctx.fillRect(fx - 2, fy, 5, 1); ctx.fillRect(fx, fy - 2, 1, 5);
          ctx.fillRect(fx, fy, 1, 1);
        }
      } else if (id === "96") {
        // Shadow ice (かげのこおり): dark, solidly frozen lane — safe to walk.
        ctx.fillStyle = "#3f5d7e"; ctx.fillRect(0, 0, ts, ts);
        let s = 41;
        const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        ctx.fillStyle = "#33506e";
        for (let i = 0; i < 26; i++) ctx.fillRect(rand() * ts, rand() * ts, 2, 1);
        ctx.strokeStyle = "rgba(150,190,230,0.35)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(5, 25); ctx.lineTo(13, 17); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(19, 27); ctx.lineTo(24, 18); ctx.stroke();
        ctx.fillStyle = "rgba(220,240,255,0.4)";
        ctx.fillRect(8, 8, 2, 1); ctx.fillRect(24, 12, 2, 1);
      } else if (id === "97") {
        // Sunlit thin ice (ひなたのうすごおり): bright, glaring, half-melted — NOT safe.
        const grd = ctx.createLinearGradient(0, 0, ts, ts);
        grd.addColorStop(0, "#e8f7ff"); grd.addColorStop(0.5, "#c2e6f8"); grd.addColorStop(1, "#e0f3fd");
        ctx.fillStyle = grd; ctx.fillRect(0, 0, ts, ts);
        // strong sun glare stripe
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(14, 0); ctx.lineTo(0, 14); ctx.lineTo(0, 4);
        ctx.closePath(); ctx.fill();
        // meltwater cracks (visual "danger")
        ctx.strokeStyle = "rgba(90,160,200,0.8)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(8, 28); ctx.lineTo(16, 18); ctx.lineTo(14, 10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(24, 26); ctx.lineTo(27, 14); ctx.stroke();
        ctx.fillStyle = "rgba(120,190,225,0.6)";
        ctx.beginPath(); ctx.ellipse(22, 24, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
      } else if (id === "98") {
        // Ice-gym floor (ジム床(氷)): pale blue tiles with frosty grid lines
        ctx.fillStyle = "#dbe8f4"; ctx.fillRect(0, 0, ts, ts);
        ctx.strokeStyle = "#bcd0e2"; ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, ts - 1, ts - 1);
        ctx.fillStyle = "#c8dcec";
        ctx.fillRect(ts / 2 - 1, ts / 2 - 1, 2, 2);
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.fillRect(4, 4, 6, 1); ctx.fillRect(22, 24, 5, 1);
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

  /** Build the player's directional walk frames from the girl overworld art
   *  (frame 1 bobs up 1px for a simple walk cycle). */
  private generateGirlFrames(): void {
    for (const dir of ["down", "up", "left", "right"]) {
      const srcKey = `player-girl-${dir}`;
      if (!this.textures.exists(srcKey)) continue;
      const img = this.textures.get(srcKey).getSourceImage() as HTMLImageElement;
      for (let i = 0; i < 2; i++) {
        const canvas = document.createElement("canvas");
        canvas.width = 32; canvas.height = 32;
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, i === 1 ? -1 : 0, 32, 32);   // frame 1 = bob up 1px
        const key = `player-${dir}-${i}`;
        if (this.textures.exists(key)) this.textures.remove(key);
        this.textures.addCanvas(key, canvas);
      }
    }
    for (let i = 0; i < 2; i++) {
      const key = `player-frame-${i}`;
      const srcKey = `player-down-${i}`;
      if (this.textures.exists(srcKey)) {
        if (this.textures.exists(key)) this.textures.remove(key);
        this.textures.addCanvas(key, this.textures.get(srcKey).getSourceImage() as HTMLCanvasElement);
      }
    }
  }

  private generatePlayerSprite(): void {
    this.generateDirectionalFrames("player-white");
  }
}
