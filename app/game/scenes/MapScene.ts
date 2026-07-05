import * as Phaser from "phaser";
import { MapData } from "../types";
import { MonsterData, MoveData, MonsterInstance, PlayerState, TrainerData } from "../data/types";
import { calculateStats, getExpForLevel } from "../data/levelSystem";

const MENU_LABELS = ["ずかん", "てもち", "どうぐ", "プレイヤー", "レポート", "せってい", "とじる"];
import { EncounterData, rollEncounter } from "../data/encounterSystem";

type Direction = "up" | "down" | "left" | "right";

interface SceneData {
  mapKey?: string;
  playerX?: number;
  playerY?: number;
  playerState?: PlayerState;
  playerInstance?: MonsterInstance; // legacy
  trainerDefeated?: string;
}

export class MapScene extends Phaser.Scene {
  private mapData!: MapData;
  private player!: Phaser.GameObjects.Image;
  private tileSize!: number;
  private isMoving = false;
  private isWarping = false;
  private moveQueue: Direction | null = null;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private animFrame = 0;
  private animTimer = 0;
  // Tile animation
  private tileAnimTimer = 0;
  private tileAnimFrame = 0;
  private animatedTileSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private gridX = 0;
  private gridY = 0;

  // Map transition
  private currentMapKey = "moonbase";
  private spawnX?: number;
  private spawnY?: number;
  // Battle
  private battleKey?: Phaser.Input.Keyboard.Key;
  private startingBattle = false;
  // Player state
  private playerState?: PlayerState;
  // Encounter & trainers
  private encounterData?: EncounterData;
  private allTrainers: TrainerData[] = [];
  private trainerSprites: Map<string, Phaser.GameObjects.Image> = new Map();

  // Menu system
  private menuOpen = false;
  private menuSubScreen: "none" | "party" | "save" | "stub" = "none";
  private menuSelectedIndex = 0;
  private menuElements: Phaser.GameObjects.GameObject[] = [];
  private menuGpPrevDpad: string | null = null;
  private mKey?: Phaser.Input.Keyboard.Key;
  private escKey?: Phaser.Input.Keyboard.Key;

  constructor() {
    super({ key: "MapScene" });
  }

  init(data: SceneData): void {
    this.currentMapKey = data.mapKey || "moonbase";
    this.spawnX = data.playerX;
    this.spawnY = data.playerY;
    this.isMoving = false;
    this.isWarping = false;
    this.moveQueue = null;
    this.animFrame = 0;
    this.animTimer = 0;
    this.startingBattle = false;
    if (data.playerState) {
      this.playerState = data.playerState;
    } else if (data.playerInstance) {
      // Legacy compat
      this.playerState = {
        party: [data.playerInstance],
        box: [],
        items: [{ id: "moon_capsule", count: 5 }],
        money: 1000,
        defeatedTrainers: [],
      };
    }
    // Track defeated trainer
    if (data.trainerDefeated && this.playerState) {
      if (!this.playerState.defeatedTrainers.includes(data.trainerDefeated)) {
        this.playerState.defeatedTrainers.push(data.trainerDefeated);
      }
    }
  }

  create(): void {
    this.mapData = this.cache.json.get(
      `map-${this.currentMapKey}`
    ) as MapData;
    this.tileSize = this.mapData.tileSize;

    // New game: give player a starter usamon
    if (!this.playerState) {
      this.playerState = this.createDefaultPlayerState();
    }

    this.drawMap();
    this.drawBuildings();
    this.createPlayer();
    this.setupInput();
    this.setupCamera();
    this.setupBattleKey();
    this.loadEncounterData();
    this.placeTrainers();

    // Fade in
    this.cameras.main.fadeIn(300, 0, 0, 0);

    // Show map name overlay
    this.showMapName(this.mapData.name);
  }

  // Sand tile IDs that should animate
  private static SAND_TILE_IDS = [5, 6, 7, 8, 9, 10, 11, 12, 32, 33, 34, 35, 36];
  // Sparkle frame mapping: sand tile -> [sparkle frame A, sparkle frame B]
  // Sparkle tiles: A=41-48, B=49-56 (8 variants each)
  private static SPARKLE_MAP: Record<number, [number, number]> = {
    5: [41, 49], 6: [42, 50], 7: [43, 51], 8: [44, 52],
    9: [45, 53], 10: [46, 54], 11: [47, 55], 12: [48, 56],
    32: [41, 49], 33: [42, 50], 34: [43, 51], 35: [44, 52],
    36: [45, 53],
  };

  private drawMap(): void {
    const { width, height, layers, tileSize } = this.mapData;
    this.animatedTileSprites.clear();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tileId = layers.floor[y][x];
        const key = `tile-${tileId}`;
        const img = this.add.image(
          x * tileSize + tileSize / 2,
          y * tileSize + tileSize / 2,
          key
        );
        // Track sand tiles for animation
        if (MapScene.SAND_TILE_IDS.includes(tileId)) {
          this.animatedTileSprites.set(`${x},${y}`, img);
        }
      }
    }
  }

  private drawBuildings(): void {
    const buildings = (this.mapData as MapData & { buildings?: { sprite: string; x: number; y: number; width: number; height: number }[] }).buildings;
    if (!buildings) return;
    const ts = this.tileSize;
    for (const bldg of buildings) {
      if (this.textures.exists(bldg.sprite)) {
        const img = this.add.image(
          bldg.x * ts + (bldg.width * ts) / 2,
          bldg.y * ts + (bldg.height * ts) / 2,
          bldg.sprite
        );
        img.setDepth(5);
        img.setDisplaySize(bldg.width * ts, bldg.height * ts);
      }
    }
  }

  private createPlayer(): void {
    if (this.spawnX !== undefined && this.spawnY !== undefined) {
      this.gridX = this.spawnX;
      this.gridY = this.spawnY;
    } else {
      this.gridX = this.mapData.playerStart.x;
      this.gridY = this.mapData.playerStart.y;
    }

    // Find first walkable position if start is blocked
    if (this.isCollision(this.gridX, this.gridY)) {
      for (let y = 0; y < this.mapData.height; y++) {
        for (let x = 0; x < this.mapData.width; x++) {
          if (!this.isCollision(x, y)) {
            this.gridX = x;
            this.gridY = y;
            break;
          }
        }
        if (!this.isCollision(this.gridX, this.gridY)) break;
      }
    }

    this.player = this.add.image(
      this.gridX * this.tileSize + this.tileSize / 2,
      this.gridY * this.tileSize + this.tileSize / 2,
      "player-frame-0"
    );
    this.player.setDepth(10);
  }

  private setupInput(): void {
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = {
        W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
      this.mKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.M);
      this.escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    }
  }

  private setupCamera(): void {
    const cam = this.cameras.main;
    const ts = this.tileSize;
    const worldW = this.mapData.width * ts;
    const worldH = this.mapData.height * ts;
    const canvasW = this.scale.width;
    const canvasH = this.scale.height;

    // Target: ~17 tiles visible horizontally (original size feel)
    const targetZoom = canvasW / (17 * ts);

    // Minimum zoom: map must fill the entire screen (no empty space)
    const minZoomX = canvasW / worldW;
    const minZoomY = canvasH / worldH;
    const minZoom = Math.max(minZoomX, minZoomY);

    const zoom = Math.max(targetZoom, minZoom);
    cam.setZoom(zoom);

    // Camera bounds: clamp to map edges
    cam.setBounds(0, 0, worldW, worldH);
    cam.startFollow(this.player, true, 0.1, 0.1);
  }

  private showMapName(name: string): void {
    const w = this.cameras.main.width;

    // Semi-transparent black bar
    const bar = this.add.graphics().setScrollFactor(0).setDepth(200);
    bar.fillStyle(0x000000, 0.7);
    bar.fillRect(0, 16, w, 40);
    bar.setAlpha(0);

    // Map name text
    const text = this.add
      .text(w / 2, 36, name, {
        fontSize: "18px",
        color: "#ffffff",
        fontFamily: "monospace",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201)
      .setAlpha(0);

    // Fade in → hold → fade out
    this.tweens.add({
      targets: [bar, text],
      alpha: 1,
      duration: 400,
      ease: "Power2",
      onComplete: () => {
        this.time.delayedCall(2000, () => {
          this.tweens.add({
            targets: [bar, text],
            alpha: 0,
            duration: 400,
            ease: "Power2",
            onComplete: () => {
              bar.destroy();
              text.destroy();
            },
          });
        });
      },
    });
  }

  private setupBattleKey(): void {
    if (this.input.keyboard) {
      this.battleKey = this.input.keyboard.addKey(
        Phaser.Input.Keyboard.KeyCodes.B
      );
    }
  }

  private startBattle(
    enemyDataId?: string,
    enemyLevel?: number,
    trainerData?: TrainerData
  ): void {
    if (this.startingBattle || this.isWarping) return;
    this.startingBattle = true;
    this.moveQueue = null;

    this.scene.start("BattleScene", {
      mapKey: this.currentMapKey,
      playerX: this.gridX,
      playerY: this.gridY,
      playerState: this.playerState,
      enemyDataId,
      enemyLevel,
      isWild: !trainerData,
      trainerData,
    });
  }

  private loadEncounterData(): void {
    this.encounterData = this.cache.json.get("encounters") as EncounterData;
    this.allTrainers = (this.cache.json.get("trainers") || []) as TrainerData[];
  }

  private placeTrainers(): void {
    this.trainerSprites.clear();
    const mapTrainers = this.allTrainers.filter(
      t => t.mapKey === this.currentMapKey
    );

    for (const trainer of mapTrainers) {
      // Skip defeated trainers
      if (this.playerState?.defeatedTrainers.includes(trainer.id)) continue;

      const sprite = this.add.image(
        trainer.x * this.tileSize + this.tileSize / 2,
        trainer.y * this.tileSize + this.tileSize / 2,
        "player-frame-0"
      ).setDepth(9).setTint(0xff6644);
      this.trainerSprites.set(trainer.id, sprite);
    }
  }

  private checkTrainerSight(): void {
    if (this.startingBattle || this.isWarping) return;
    const mapTrainers = this.allTrainers.filter(
      t => t.mapKey === this.currentMapKey
    );

    for (const trainer of mapTrainers) {
      if (this.playerState?.defeatedTrainers.includes(trainer.id)) continue;

      let inSight = false;
      const dx = this.gridX - trainer.x;
      const dy = this.gridY - trainer.y;

      switch (trainer.direction) {
        case "down":
          inSight = dx === 0 && dy > 0 && dy <= trainer.sightRange;
          break;
        case "up":
          inSight = dx === 0 && dy < 0 && Math.abs(dy) <= trainer.sightRange;
          break;
        case "left":
          inSight = dy === 0 && dx < 0 && Math.abs(dx) <= trainer.sightRange;
          break;
        case "right":
          inSight = dy === 0 && dx > 0 && dx <= trainer.sightRange;
          break;
      }

      if (inSight) {
        this.startBattle(undefined, undefined, trainer);
        return;
      }
    }
  }

  private checkRandomEncounter(): void {
    if (this.startingBattle || this.isWarping) return;

    // Check encounter table for this map
    const table = this.encounterData?.[this.currentMapKey];
    if (!table) return;

    // Check if current tile is sand (tileId === 5)
    const { layers } = this.mapData;
    const tileId = layers.floor[this.gridY]?.[this.gridX];
    // Sand tiles: 5-12, 14-21 (edges), 32-36 (variants)
    const sandTiles = [5,6,7,8,9,10,11,12,14,15,16,17,18,19,20,21,32,33,34,35,36];
    if (!sandTiles.includes(tileId)) return;

    // Use encounter rate from data
    if (Math.random() < table.encounterRate) {
      const result = rollEncounter(table);
      if (result) {
        this.startBattle(result.monsterId, result.level);
      }
    }
  }

  private checkWarp(): void {
    if (!this.mapData.warps || this.isWarping) return;

    const warp = this.mapData.warps.find(
      (w) => w.x === this.gridX && w.y === this.gridY
    );

    if (warp) {
      this.isWarping = true;
      this.moveQueue = null;

      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once("camerafadeoutcomplete", () => {
        this.scene.restart({
          mapKey: warp.targetMap,
          playerX: warp.targetX,
          playerY: warp.targetY,
        });
      });
    }
  }

  private getInputDirection(): Direction | null {
    // External gamepad D-pad (mobile)
    const gp = typeof window !== "undefined" ? (window as any).__gamepad : null;
    if (gp?.dpad) return gp.dpad as Direction;

    // Keyboard
    if (!this.input.keyboard) return null;

    if (this.cursors.up.isDown || this.wasd.W.isDown) return "up";
    if (this.cursors.down.isDown || this.wasd.S.isDown) return "down";
    if (this.cursors.left.isDown || this.wasd.A.isDown) return "left";
    if (this.cursors.right.isDown || this.wasd.D.isDown) return "right";

    return null;
  }

  private isCollision(x: number, y: number): boolean {
    const { width, height, layers } = this.mapData;
    if (x < 0 || x >= width || y < 0 || y >= height) return true;
    return layers.collision[y][x] === 1;
  }

  private tryMove(dir: Direction): void {
    if (this.isMoving || this.isWarping) {
      if (!this.isWarping) this.moveQueue = dir;
      return;
    }

    let targetX = this.gridX;
    let targetY = this.gridY;

    switch (dir) {
      case "up":
        targetY--;
        break;
      case "down":
        targetY++;
        break;
      case "left":
        targetX--;
        break;
      case "right":
        targetX++;
        break;
    }

    if (this.isCollision(targetX, targetY)) return;

    this.isMoving = true;
    this.gridX = targetX;
    this.gridY = targetY;

    this.tweens.add({
      targets: this.player,
      x: targetX * this.tileSize + this.tileSize / 2,
      y: targetY * this.tileSize + this.tileSize / 2,
      duration: 150,
      ease: "Linear",
      onComplete: () => {
        this.isMoving = false;

        // Check for warp after movement completes
        this.checkWarp();

        // Check trainer sight
        this.checkTrainerSight();

        // Check random encounter
        this.checkRandomEncounter();

        // Process queued move (only if not warping)
        if (this.moveQueue && !this.isWarping) {
          const queued = this.moveQueue;
          this.moveQueue = null;
          this.tryMove(queued);
        }
      },
    });
  }

  update(_time: number, delta: number): void {
    if (this.isWarping || this.startingBattle) return;

    // --- Gamepad button reads ---
    const gp = typeof window !== "undefined" ? (window as any).__gamepad : null;
    let gpMenu = false, gpA = false, gpB = false;
    if (gp) {
      if (gp.menuJust) { gpMenu = true; gp.menuJust = false; }
      if (gp.aJust) { gpA = true; gp.aJust = false; }
      if (gp.bJust) { gpB = true; gp.bJust = false; }
    }
    const kbMenu = this.mKey && Phaser.Input.Keyboard.JustDown(this.mKey);
    const kbEsc = this.escKey && Phaser.Input.Keyboard.JustDown(this.escKey);

    // --- Menu open/close ---
    if (this.menuOpen) {
      this.updateMenu(gpA, gpB || !!kbEsc, gpMenu || !!kbMenu, gp?.dpad || null);
      return; // freeze game while menu open
    }
    if (gpMenu || kbMenu) { this.openMenu(); return; }

    // B key → battle (test)
    if (
      this.battleKey &&
      Phaser.Input.Keyboard.JustDown(this.battleKey)
    ) {
      this.startBattle();
      return;
    }

    // Walk animation
    this.animTimer += delta;
    if (this.animTimer > 250) {
      this.animTimer = 0;
      this.animFrame = this.animFrame === 0 ? 1 : 0;
      if (this.isMoving) {
        this.player.setTexture(`player-frame-${this.animFrame}`);
      } else {
        this.player.setTexture("player-frame-0");
      }
    }

    // Tile animation (sand sparkle) - cycle every 800ms
    this.tileAnimTimer += delta;
    if (this.tileAnimTimer > 800) {
      this.tileAnimTimer = 0;
      this.tileAnimFrame = (this.tileAnimFrame + 1) % 3; // 0=base, 1=sparkleA, 2=sparkleB
      this.animatedTileSprites.forEach((sprite, key) => {
        const [xStr, yStr] = key.split(",");
        const tx = parseInt(xStr); const ty = parseInt(yStr);
        const tileId = this.mapData.layers.floor[ty]?.[tx];
        if (tileId === undefined) return;
        const sparkle = MapScene.SPARKLE_MAP[tileId];
        if (!sparkle) return;
        if (this.tileAnimFrame === 0) {
          sprite.setTexture(`tile-${tileId}`);
        } else if (this.tileAnimFrame === 1) {
          sprite.setTexture(`tile-${sparkle[0]}`);
        } else {
          sprite.setTexture(`tile-${sparkle[1]}`);
        }
      });
    }

    // Movement input
    const dir = this.getInputDirection();
    if (dir) {
      this.tryMove(dir);
    }
  }

  // ========== MENU SYSTEM ==========

  private clearMenuElements(): void {
    this.menuElements.forEach(el => el.destroy());
    this.menuElements = [];
  }

  private openMenu(): void {
    this.menuOpen = true;
    this.menuSelectedIndex = 0;
    this.menuSubScreen = "none";
    this.menuGpPrevDpad = null;
    this.drawMainMenu();
  }

  private closeMenu(): void {
    this.menuOpen = false;
    this.clearMenuElements();
    this.menuGpPrevDpad = null;
  }

  private drawMainMenu(): void {
    this.clearMenuElements();
    // Compensate camera zoom for scrollFactor(0) UI
    const zoom = this.cameras.main.zoom;
    const W = this.scale.width / zoom;
    const H = this.scale.height / zoom;

    // Dark overlay
    const overlay = this.add.graphics().setScrollFactor(0).setDepth(200);
    overlay.fillStyle(0x000000, 0.4);
    overlay.fillRect(0, 0, W, H);
    this.menuElements.push(overlay);

    // Panel (right side, Pokemon-style)
    const pw = 200, pad = 14;
    const px = W - pw - 16;
    const ph = MENU_LABELS.length * 42 + pad * 2;
    const py = 20;

    const panel = this.add.graphics().setScrollFactor(0).setDepth(201);
    panel.fillStyle(0x0a1628, 0.95);
    panel.fillRoundedRect(px, py, pw, ph, 12);
    panel.lineStyle(2, 0x3366aa);
    panel.strokeRoundedRect(px, py, pw, ph, 12);
    this.menuElements.push(panel);

    // Items
    MENU_LABELS.forEach((label, i) => {
      const iy = py + pad + i * 42;
      const bg = this.add.graphics().setScrollFactor(0).setDepth(202);
      const arrow = this.add.text(px + 12, iy + 16, "▶", {
        fontSize: "14px", color: "#66aaff", fontFamily: "monospace",
      }).setScrollFactor(0).setDepth(203).setOrigin(0, 0.5);
      const text = this.add.text(px + 32, iy + 16, label, {
        fontSize: "18px", color: "#ffffff", fontFamily: "monospace",
      }).setScrollFactor(0).setDepth(203).setOrigin(0, 0.5);
      this.menuElements.push(bg, arrow, text);
    });

    this.highlightMenuItem(this.menuSelectedIndex);
  }

  private highlightMenuItem(idx: number): void {
    const zoom = this.cameras.main.zoom;
    const pw = 200, px = this.scale.width / zoom - pw - 16, pad = 14, py = 20;
    for (let i = 0; i < MENU_LABELS.length; i++) {
      const base = 2 + i * 3;
      const bg = this.menuElements[base] as Phaser.GameObjects.Graphics;
      const arrow = this.menuElements[base + 1] as Phaser.GameObjects.Text;
      const text = this.menuElements[base + 2] as Phaser.GameObjects.Text;
      const iy = py + pad + i * 42;
      bg.clear();
      if (i === idx) {
        bg.fillStyle(0x1a3366, 0.9);
        bg.fillRoundedRect(px + 4, iy + 1, pw - 8, 32, 6);
        arrow.setVisible(true);
        text.setColor("#ffffff");
      } else {
        arrow.setVisible(false);
        text.setColor("#8899aa");
      }
    }
  }

  private updateMenu(a: boolean, b: boolean, menu: boolean, dpad: string | null): void {
    if (this.menuSubScreen !== "none") {
      if (b || menu) { this.closeSubScreen(); return; }
      // Sub-screen specific: save confirm
      if (this.menuSubScreen === "save" && a) { this.doSave(); return; }
      return;
    }

    // Close menu
    if (b || menu) { this.closeMenu(); return; }

    // D-pad navigation (edge detection)
    const justUp = dpad === "up" && this.menuGpPrevDpad !== "up";
    const justDown = dpad === "down" && this.menuGpPrevDpad !== "down";
    this.menuGpPrevDpad = dpad;

    // Keyboard arrows
    if (this.input.keyboard && this.cursors) {
      if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) { this.menuSelectedIndex = (this.menuSelectedIndex - 1 + MENU_LABELS.length) % MENU_LABELS.length; this.highlightMenuItem(this.menuSelectedIndex); return; }
      if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) { this.menuSelectedIndex = (this.menuSelectedIndex + 1) % MENU_LABELS.length; this.highlightMenuItem(this.menuSelectedIndex); return; }
      if (Phaser.Input.Keyboard.JustDown(this.input.keyboard.addKey("ENTER"))) { this.selectMenuItem(); return; }
    }

    if (justUp) {
      this.menuSelectedIndex = (this.menuSelectedIndex - 1 + MENU_LABELS.length) % MENU_LABELS.length;
      this.highlightMenuItem(this.menuSelectedIndex);
    } else if (justDown) {
      this.menuSelectedIndex = (this.menuSelectedIndex + 1) % MENU_LABELS.length;
      this.highlightMenuItem(this.menuSelectedIndex);
    }
    if (a) this.selectMenuItem();
  }

  private selectMenuItem(): void {
    switch (this.menuSelectedIndex) {
      case 0: this.showStubScreen("ずかん"); break;
      case 1: this.showPartyScreen(); break;
      case 2: this.showStubScreen("どうぐ"); break;
      case 3: this.showPlayerInfoScreen(); break;
      case 4: this.showSaveScreen(); break;
      case 5: this.showStubScreen("せってい"); break;
      case 6: this.closeMenu(); break;
    }
  }

  // ---- Party Screen ----
  private showPartyScreen(): void {
    this.menuSubScreen = "party";
    this.clearMenuElements();
    const zoom = this.cameras.main.zoom;
    const W = this.scale.width / zoom, H = this.scale.height / zoom;
    const allMonsters = this.cache.json.get("monsters") as MonsterData[];
    const allMoves = this.cache.json.get("moves") as MoveData[];
    const party = this.playerState?.party || [];

    // Background
    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.97);
    bg.fillRect(0, 0, W, H);
    this.menuElements.push(bg);

    // Title
    const title = this.add.text(W / 2, 24, "てもち", {
      fontSize: "22px", color: "#66aaff", fontFamily: "monospace", fontStyle: "bold",
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(title);

    const hint = this.add.text(W / 2, H - 30, "Bボタンでもどる", {
      fontSize: "13px", color: "#556677", fontFamily: "monospace",
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(hint);

    if (party.length === 0) {
      const empty = this.add.text(W / 2, H / 2, "なかまが いない", {
        fontSize: "18px", color: "#667788", fontFamily: "monospace",
      }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
      this.menuElements.push(empty);
      return;
    }

    const cardH = 100, gap = 8, startY = 55;
    party.forEach((mon, i) => {
      const data = allMonsters.find(m => m.id === mon.dataId);
      if (!data) return;
      const cy = startY + i * (cardH + gap);

      // Card bg
      const card = this.add.graphics().setScrollFactor(0).setDepth(201);
      card.fillStyle(0x152040, 0.9);
      card.fillRoundedRect(20, cy, W - 40, cardH, 8);
      card.lineStyle(1, 0x334466);
      card.strokeRoundedRect(20, cy, W - 40, cardH, 8);
      this.menuElements.push(card);

      // Name + Level + Type
      const nameStr = `${data.name}  Lv.${mon.level}`;
      const nameT = this.add.text(40, cy + 12, nameStr, {
        fontSize: "17px", color: "#ffffff", fontFamily: "monospace", fontStyle: "bold",
      }).setScrollFactor(0).setDepth(202);
      this.menuElements.push(nameT);

      const typeT = this.add.text(W - 50, cy + 12, data.type, {
        fontSize: "13px", color: "#88aacc", fontFamily: "monospace",
      }).setScrollFactor(0).setDepth(202).setOrigin(1, 0);
      this.menuElements.push(typeT);

      // HP bar
      const hpRatio = mon.currentHp / mon.maxHp;
      const barW = 180, barH = 10, barX = 40, barY = cy + 36;
      const hpBar = this.add.graphics().setScrollFactor(0).setDepth(202);
      hpBar.fillStyle(0x333333); hpBar.fillRect(barX, barY, barW, barH);
      const hpColor = hpRatio > 0.5 ? 0x22cc44 : hpRatio > 0.2 ? 0xcccc22 : 0xcc2222;
      hpBar.fillStyle(hpColor); hpBar.fillRect(barX, barY, Math.floor(barW * hpRatio), barH);
      this.menuElements.push(hpBar);

      const hpT = this.add.text(barX + barW + 8, barY - 1, `${mon.currentHp}/${mon.maxHp}`, {
        fontSize: "12px", color: "#aabbcc", fontFamily: "monospace",
      }).setScrollFactor(0).setDepth(202);
      this.menuElements.push(hpT);

      // Moves
      const moveNames = mon.moves.map(mid => allMoves.find(m => m.id === mid)?.name || "???").join(" / ");
      const movT = this.add.text(40, cy + 54, moveNames, {
        fontSize: "12px", color: "#7799aa", fontFamily: "monospace",
      }).setScrollFactor(0).setDepth(202);
      this.menuElements.push(movT);

      // Stats
      const statsStr = `ATK:${mon.stats.attack}  DEF:${mon.stats.defense}  SPD:${mon.stats.speed}`;
      const statT = this.add.text(40, cy + 74, statsStr, {
        fontSize: "12px", color: "#667788", fontFamily: "monospace",
      }).setScrollFactor(0).setDepth(202);
      this.menuElements.push(statT);
    });
  }

  // ---- Player Info Screen ----
  private showPlayerInfoScreen(): void {
    this.menuSubScreen = "stub";
    this.clearMenuElements();
    const zoom = this.cameras.main.zoom;
    const W = this.scale.width / zoom, H = this.scale.height / zoom;

    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.97); bg.fillRect(0, 0, W, H);
    this.menuElements.push(bg);

    let playerName = "???";
    try { playerName = JSON.parse(localStorage.getItem("usamon-player-setup") || "{}").playerName || "???"; } catch(e) {}

    const money = this.playerState?.money || 0;
    const badges = this.playerState?.defeatedTrainers.length || 0;
    const party = this.playerState?.party.length || 0;

    const title = this.add.text(W/2, 30, "プレイヤー情報", {
      fontSize: "22px", color: "#66aaff", fontFamily: "monospace", fontStyle: "bold",
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(title);

    const lines = [
      `なまえ:  ${playerName}`,
      `しょじきん: ${money}円`,
      `てもち:  ${party}匹`,
      `たおしたトレーナー: ${badges}人`,
    ];
    lines.forEach((line, i) => {
      const t = this.add.text(60, 80 + i * 44, line, {
        fontSize: "18px", color: "#ccddee", fontFamily: "monospace",
      }).setScrollFactor(0).setDepth(201);
      this.menuElements.push(t);
    });

    const hint = this.add.text(W/2, H - 30, "Bボタンでもどる", {
      fontSize: "13px", color: "#556677", fontFamily: "monospace",
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(hint);
  }

  // ---- Save Screen ----
  private showSaveScreen(): void {
    this.menuSubScreen = "save";
    this.clearMenuElements();
    const zoom = this.cameras.main.zoom;
    const W = this.scale.width / zoom, H = this.scale.height / zoom;

    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.97); bg.fillRect(0, 0, W, H);
    this.menuElements.push(bg);

    const panel = this.add.graphics().setScrollFactor(0).setDepth(201);
    panel.fillStyle(0x152040, 0.95);
    panel.fillRoundedRect(W/2 - 200, H/2 - 80, 400, 160, 12);
    panel.lineStyle(2, 0x3366aa);
    panel.strokeRoundedRect(W/2 - 200, H/2 - 80, 400, 160, 12);
    this.menuElements.push(panel);

    const msg = this.add.text(W/2, H/2 - 30, "レポートに きろくしますか？", {
      fontSize: "20px", color: "#ffffff", fontFamily: "monospace",
    }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
    this.menuElements.push(msg);

    const hint = this.add.text(W/2, H/2 + 30, "Aボタン: はい  /  Bボタン: いいえ", {
      fontSize: "16px", color: "#88aacc", fontFamily: "monospace",
    }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
    this.menuElements.push(hint);
  }

  private doSave(): void {
    try {
      const saveData = {
        playerState: this.playerState,
        mapKey: this.currentMapKey,
        gridX: this.gridX,
        gridY: this.gridY,
        timestamp: Date.now(),
      };
      localStorage.setItem("usamon-save-data", JSON.stringify(saveData));
    } catch(e) { /* ignore */ }

    // Show success
    this.clearMenuElements();
    const zoom = this.cameras.main.zoom;
    const W = this.scale.width / zoom, H = this.scale.height / zoom;

    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.97); bg.fillRect(0, 0, W, H);
    this.menuElements.push(bg);

    const msg = this.add.text(W/2, H/2, "レポートに きろくしました！", {
      fontSize: "22px", color: "#44cc88", fontFamily: "monospace", fontStyle: "bold",
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(msg);

    // Auto-close after 1.2s
    this.menuSubScreen = "stub"; // prevent double-save
    this.time.delayedCall(1200, () => {
      if (this.menuOpen) this.closeMenu();
    });
  }

  // ---- Stub Screen ----
  private showStubScreen(title: string): void {
    this.menuSubScreen = "stub";
    this.clearMenuElements();
    const zoom = this.cameras.main.zoom;
    const W = this.scale.width / zoom, H = this.scale.height / zoom;

    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.97); bg.fillRect(0, 0, W, H);
    this.menuElements.push(bg);

    const t = this.add.text(W/2, H/2 - 20, title, {
      fontSize: "24px", color: "#66aaff", fontFamily: "monospace", fontStyle: "bold",
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(t);

    const sub = this.add.text(W/2, H/2 + 20, "― じゅんびちゅう ―", {
      fontSize: "16px", color: "#556677", fontFamily: "monospace",
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(sub);

    const hint = this.add.text(W/2, H - 30, "Bボタンでもどる", {
      fontSize: "13px", color: "#556677", fontFamily: "monospace",
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(hint);
  }

  private closeSubScreen(): void {
    this.menuSubScreen = "none";
    this.drawMainMenu();
  }

  // ---- Default starter ----
  private createDefaultPlayerState(): PlayerState {
    const allMonsters = this.cache.json.get("monsters") as MonsterData[];
    const usamon = allMonsters.find(m => m.id === "usamon")!;
    const stats = calculateStats(usamon, 5);
    const moves = usamon.learnset
      .filter(e => e.level <= 5)
      .map(e => e.moveId)
      .slice(-4);
    const instance: MonsterInstance = {
      dataId: "usamon",
      level: 5,
      exp: getExpForLevel(5),
      currentHp: stats.hp,
      maxHp: stats.hp,
      stats,
      moves,
    };
    return {
      party: [instance],
      box: [],
      items: [{ id: "moon_capsule", count: 5 }],
      money: 1000,
      defeatedTrainers: [],
    };
  }
}
