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
  // Trainer sighted the player and is walking over (player is locked)
  private trainerApproaching = false;
  // Player state
  private playerState?: PlayerState;
  // Encounter & trainers
  private encounterData?: EncounterData;
  private allTrainers: TrainerData[] = [];
  private trainerSprites: Map<string, Phaser.GameObjects.Image> = new Map();

  // Facing direction (for NPC interaction)
  private facingDirection: Direction = "down";

  // NPC / Dialog
  private kinoshitaSprite?: Phaser.GameObjects.Image;
  private kinoshitaNpcX = 11;
  private kinoshitaNpcY = 6;
  private dialogActive = false;
  private dialogMessages: string[] = [];
  private dialogIndex = 0;
  private dialogCallback?: () => void;
  private dialogElements: Phaser.GameObjects.GameObject[] = [];

  // Nurse NPC (Recovery Pod)
  private nurseSprite?: Phaser.GameObjects.Image;
  private nurseNpcX = 5;
  private nurseNpcY = 2;

  // Shopkeeper NPC (Planet Shop)
  private shopkeeperSprite?: Phaser.GameObjects.Image;
  private shopkeeperNpcX = 5;
  private shopkeeperNpcY = 2;

  // Shop system
  private shopOpen = false;
  private shopSelectedIndex = 0;
  private shopElements: Phaser.GameObjects.GameObject[] = [];
  private shopGpPrevDpad: string | null = null;
  private shopMessage = "";
  private static SHOP_INVENTORY = ["repair_gel", "hi_repair_gel", "moon_capsule", "star_capsule"];

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
    this.trainerApproaching = false;
    this.kinoshitaSprite = undefined;
    this.nurseSprite = undefined;
    this.shopkeeperSprite = undefined;
    this.shopOpen = false;
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

    // Place Kinoshita NPC on moonbase
    if (this.currentMapKey === "moonbase") {
      this.placeKinoshitaNpc();
    }

    // Place Nurse NPC in recovery pod
    if (this.currentMapKey === "recovery_pod") {
      this.placeNurseNpc();
    }

    // Place Shopkeeper NPC in planet shop
    if (this.currentMapKey === "planet_shop") {
      this.placeShopkeeperNpc();
    }
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
    const w = this.scale.width;

    // Semi-transparent black bar
    const bar = this.add.graphics().setScrollFactor(0).setDepth(200);
    bar.fillStyle(0x000000, 0.7);
    bar.fillRect(this.uiX(0), this.uiY(20), this.uiS(w), this.uiS(40));
    bar.setAlpha(0);

    // Map name text
    const text = this.add
      .text(this.uiX(w / 2), this.uiY(40), name, {
        fontSize: "18px",
        color: "#ffffff",
        fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 3,
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
    if (this.startingBattle || this.isWarping || this.trainerApproaching) return;
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
        this.beginTrainerApproach(trainer);
        return;
      }
    }
  }

  // Ruby/Sapphire-style: on being spotted, a "！" pops over the trainer, the
  // player is frozen, and the trainer walks up to the player before the battle.
  private beginTrainerApproach(trainer: TrainerData): void {
    this.trainerApproaching = true;
    this.moveQueue = null;
    const sprite = this.trainerSprites.get(trainer.id);
    if (!sprite) {
      this.startBattle(undefined, undefined, trainer);
      return;
    }

    const bubble = this.add.text(
      sprite.x,
      sprite.y - this.tileSize * 0.7,
      "！",
      {
        fontSize: `${Math.round(this.tileSize * 0.85)}px`,
        color: "#ffdd33",
        fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 4,
      }
    ).setOrigin(0.5).setDepth(30).setScale(0);

    this.tweens.add({
      targets: bubble,
      scale: 1,
      duration: 200,
      ease: "Back.out",
      onComplete: () => {
        this.time.delayedCall(350, () => {
          bubble.destroy();
          this.walkTrainerToPlayer(trainer, sprite);
        });
      },
    });
  }

  private walkTrainerToPlayer(
    trainer: TrainerData,
    sprite: Phaser.GameObjects.Image
  ): void {
    let tx = trainer.x;
    let ty = trainer.y;
    const stepX = Math.sign(this.gridX - tx);
    const stepY = Math.sign(this.gridY - ty);

    const step = () => {
      const dist = Math.abs(this.gridX - tx) + Math.abs(this.gridY - ty);
      if (dist <= 1) {
        this.startBattle(undefined, undefined, trainer);
        return;
      }
      tx += stepX;
      ty += stepY;
      this.tweens.add({
        targets: sprite,
        x: tx * this.tileSize + this.tileSize / 2,
        y: ty * this.tileSize + this.tileSize / 2,
        duration: 150,
        ease: "Linear",
        onComplete: step,
      });
    };
    step();
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
      // Block exit if player has no almon
      if (!this.playerState || this.playerState.party.length === 0) {
        this.showDialog([
          "まだ アルモンを もっていないぞ！",
          "外は 野生のアルモンだらけだ。",
          "危ないから まずキノシタ博士に\n会っておいで！",
        ]);
        // Push player back
        this.gridY--;
        this.player.setY(this.gridY * this.tileSize + this.tileSize / 2);
        return;
      }
      this.isWarping = true;
      this.moveQueue = null;

      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once("camerafadeoutcomplete", () => {
        this.scene.restart({
          mapKey: warp.targetMap,
          playerX: warp.targetX,
          playerY: warp.targetY,
          playerState: this.playerState,
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
    if (layers.collision[y][x] === 1) return true;
    // NPC collision
    if (this.kinoshitaSprite && x === this.kinoshitaNpcX && y === this.kinoshitaNpcY) return true;
    if (this.nurseSprite && x === this.nurseNpcX && y === this.nurseNpcY) return true;
    if (this.shopkeeperSprite && x === this.shopkeeperNpcX && y === this.shopkeeperNpcY) return true;
    return false;
  }

  private tryMove(dir: Direction): void {
    this.facingDirection = dir;
    if (this.isMoving || this.isWarping) {
      // Do not buffer input while moving: a single tap = a single tile.
      // Continuous movement on hold is driven by the live-input check below.
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

        // Continue moving only while a direction is still held at completion
        // time: a quick tap moves exactly one tile, a long press keeps moving
        // (gapless, since the tween chains straight into the next one).
        if (!this.isWarping && !this.startingBattle) {
          const held = this.getInputDirection();
          if (held) this.tryMove(held);
        }
      },
    });
  }

  update(_time: number, delta: number): void {
    if (this.isWarping || this.startingBattle || this.trainerApproaching) return;

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

    // --- Dialog ---
    if (this.dialogActive) {
      if (gpA) this.advanceDialog();
      return;
    }

    // --- Shop ---
    if (this.shopOpen) {
      this.updateShop(gpA, gpB || !!kbEsc, gp?.dpad || null);
      return;
    }

    // --- Menu open/close ---
    if (this.menuOpen) {
      this.updateMenu(gpA, gpB || !!kbEsc, gpMenu || !!kbMenu, gp?.dpad || null);
      return;
    }
    if (gpMenu || kbMenu) { this.openMenu(); return; }

    // --- A button: NPC interaction ---
    if (gpA && !this.isMoving) {
      this.checkNpcInteraction();
    }

    // B key → battle (test)
    if (
      this.battleKey &&
      Phaser.Input.Keyboard.JustDown(this.battleKey)
    ) {
      this.startBattle();
      return;
    }

    // Walk animation (direction-aware)
    this.animTimer += delta;
    if (this.animTimer > 200) {
      this.animTimer = 0;
      this.animFrame = this.animFrame === 0 ? 1 : 0;
    }
    const faceDir = this.facingDirection;
    const dirKey = `player-${faceDir}-${this.isMoving ? this.animFrame : 0}`;
    if (this.textures.exists(dirKey)) {
      this.player.setTexture(dirKey);
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

  // ========== UI COORDINATE HELPERS (zoom-safe) ==========
  /** Convert screen X → scrollFactor(0) object X */
  private uiX(sx: number): number {
    const z = this.cameras.main.zoom;
    return sx / z + this.scale.width / 2 * (1 - 1 / z);
  }
  /** Convert screen Y → scrollFactor(0) object Y */
  private uiY(sy: number): number {
    const z = this.cameras.main.zoom;
    return sy / z + this.scale.height / 2 * (1 - 1 / z);
  }
  /** Convert screen size → scrollFactor(0) size */
  private uiS(s: number): number {
    return s / this.cameras.main.zoom;
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
    const W = this.scale.width;
    const H = this.scale.height;

    // Dark overlay
    const overlay = this.add.graphics().setScrollFactor(0).setDepth(200);
    overlay.fillStyle(0x000000, 0.4);
    overlay.fillRect(this.uiX(0), this.uiY(0), this.uiS(W), this.uiS(H));
    this.menuElements.push(overlay);

    // Panel (right side, Pokemon-style)
    const pw = 200, pad = 14;
    const px = W - pw - 20;
    const ph = MENU_LABELS.length * 42 + pad * 2;
    const py = 30;

    const panel = this.add.graphics().setScrollFactor(0).setDepth(201);
    panel.fillStyle(0x0a1628, 0.95);
    panel.fillRoundedRect(this.uiX(px), this.uiY(py), this.uiS(pw), this.uiS(ph), this.uiS(12));
    panel.lineStyle(2, 0x3366aa);
    panel.strokeRoundedRect(this.uiX(px), this.uiY(py), this.uiS(pw), this.uiS(ph), this.uiS(12));
    this.menuElements.push(panel);

    // Items
    MENU_LABELS.forEach((label, i) => {
      const iy = py + pad + i * 42;
      const bg = this.add.graphics().setScrollFactor(0).setDepth(202);
      const arrow = this.add.text(this.uiX(px + 12), this.uiY(iy + 16), "▶", {
        fontSize: "14px", color: "#66aaff", fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(203).setOrigin(0, 0.5);
      const text = this.add.text(this.uiX(px + 32), this.uiY(iy + 16), label, {
        fontSize: "18px", color: "#ffffff", fontFamily: "'DotGothic16', monospace",
      }).setScrollFactor(0).setDepth(203).setOrigin(0, 0.5);
      this.menuElements.push(bg, arrow, text);
    });

    this.highlightMenuItem(this.menuSelectedIndex);
  }

  private highlightMenuItem(idx: number): void {
    const pw = 200, px = this.scale.width - pw - 20, pad = 14, py = 30;
    for (let i = 0; i < MENU_LABELS.length; i++) {
      const base = 2 + i * 3;
      const bg = this.menuElements[base] as Phaser.GameObjects.Graphics;
      const arrow = this.menuElements[base + 1] as Phaser.GameObjects.Text;
      const text = this.menuElements[base + 2] as Phaser.GameObjects.Text;
      const iy = py + pad + i * 42;
      bg.clear();
      if (i === idx) {
        bg.fillStyle(0x1a3366, 0.9);
        bg.fillRoundedRect(this.uiX(px + 4), this.uiY(iy + 1), this.uiS(pw - 8), this.uiS(32), this.uiS(6));
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

  // ---- Party Screen (ポケモン ルビサファ風) ----
  private showPartyScreen(): void {
    this.menuSubScreen = "party";
    this.clearMenuElements();
    const W = this.scale.width, H = this.scale.height;
    const allMonsters = this.cache.json.get("monsters") as MonsterData[];
    const allMoves = this.cache.json.get("moves") as MoveData[];
    const party = this.playerState?.party || [];
    const F = "'DotGothic16', monospace";
    const STK = { stroke: "#000000", strokeThickness: 3 };
    const STK2 = { stroke: "#000000", strokeThickness: 2 };

    // ---- Background: deep green diagonal stripes ----
    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x1a3a2a); bg.fillRect(this.uiX(0), this.uiY(0), this.uiS(W), this.uiS(H));
    const stripeW = 12, stripeGap = 12, period = stripeW + stripeGap;
    bg.fillStyle(0x285838, 0.7);
    for (let offset = -H; offset < W + H; offset += period) {
      bg.beginPath();
      bg.moveTo(this.uiX(offset), this.uiY(0));
      bg.lineTo(this.uiX(offset + stripeW), this.uiY(0));
      bg.lineTo(this.uiX(offset + stripeW + H), this.uiY(H));
      bg.lineTo(this.uiX(offset + H), this.uiY(H));
      bg.closePath();
      bg.fillPath();
    }
    this.menuElements.push(bg);

    // ---- ③ Bottom message bar ----
    const barH = 32;
    const barY = H - barH;
    const bar = this.add.graphics().setScrollFactor(0).setDepth(210);
    bar.fillStyle(0xf0f4f8); bar.fillRect(this.uiX(0), this.uiY(barY), this.uiS(W), this.uiS(barH));
    bar.fillStyle(0xd8e0e8); bar.fillRect(this.uiX(0), this.uiY(barY), this.uiS(W), this.uiS(2));
    this.menuElements.push(bar);
    this.menuElements.push(
      this.add.text(this.uiX(14), this.uiY(barY + barH / 2), "アルモンを えらんで ください", {
        fontSize: `${this.uiS(13)}px`, color: "#303030", fontFamily: F, ...STK2,
        stroke: "#ffffff", strokeThickness: 0,
      }).setScrollFactor(0).setDepth(211).setOrigin(0, 0.5)
    );
    this.menuElements.push(
      this.add.text(this.uiX(W - 10), this.uiY(barY + barH / 2), "B:もどる", {
        fontSize: `${this.uiS(10)}px`, color: "#707880", fontFamily: F,
      }).setScrollFactor(0).setDepth(211).setOrigin(1, 0.5)
    );

    if (party.length === 0) {
      this.menuElements.push(
        this.add.text(this.uiX(W / 2), this.uiY(H / 2), "なかまが いない", {
          fontSize: `${this.uiS(16)}px`, color: "#ffffff", fontFamily: F, ...STK,
        }).setScrollFactor(0).setDepth(201).setOrigin(0.5)
      );
      return;
    }

    // ---- Helper: draw capsule HP bar ----
    const drawCapsuleBar = (g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, ratio: number, fillColor: number) => {
      const r = h / 2;
      g.fillStyle(0x101818);
      g.fillRoundedRect(this.uiX(x - 1), this.uiY(y - 1), this.uiS(w + 2), this.uiS(h + 2), this.uiS(r + 1));
      g.fillStyle(0x282828);
      g.fillRoundedRect(this.uiX(x), this.uiY(y), this.uiS(w), this.uiS(h), this.uiS(r));
      const fillW = Math.floor(w * Phaser.Math.Clamp(ratio, 0, 1));
      if (fillW > 0) {
        g.fillStyle(fillColor);
        g.fillRoundedRect(this.uiX(x), this.uiY(y), this.uiS(Math.max(fillW, h)), this.uiS(h), this.uiS(r));
      }
    };
    const HP_GREEN = 0x78f868;
    const HP_YELLOW = 0xf0d840;
    const HP_RED = 0xf05048;
    const hpColor = (ratio: number) => ratio > 0.5 ? HP_GREEN : ratio > 0.2 ? HP_YELLOW : HP_RED;
    const EXP_BLUE = 0x58a8e8;

    // ===== Layout: scale to fill vertical space =====
    const margin = 8;
    const topPad = 6;
    const usableH = barY - topPad;

    // Right column: 5 slots sized so 5 rows fill the full height
    const maxRightSlots = 5;
    const rightSlotH = Math.floor(usableH / (maxRightSlots + (maxRightSlots - 1) / 20));
    const gap = Math.max(2, Math.floor(rightSlotH / 20));
    const rightSlotCount = Math.max(party.length - 1, 1);
    const rightIconSize = rightSlotH - 8;
    const rightStartY = topPad;

    // Left column: ~1/3 width, height ~half usable
    const leadW = Math.floor(W * 0.33);
    const leadX = margin;
    const leadY = topPad;
    const leadIconSize = Math.min(leadW - 16, Math.floor(rightSlotH * 1.6));
    const leadH = Math.min(Math.floor(usableH * 0.55), leadIconSize + Math.floor(rightSlotH * 1.8));

    // Right column position
    const rightX = leadX + leadW + gap + 4;
    const rightW = W - rightX - margin;

    // ===== Slot 0: Lead card (small card at top-left) =====
    const lead = party[0];
    const leadData = allMonsters.find(m => m.id === lead.dataId);
    if (leadData) {
      const card = this.add.graphics().setScrollFactor(0).setDepth(201);
      // Orange highlight border
      card.lineStyle(3, 0xf8a830);
      card.strokeRoundedRect(this.uiX(leadX - 3), this.uiY(leadY - 3), this.uiS(leadW + 6), this.uiS(leadH + 6), this.uiS(10));
      // Inner panel
      card.fillStyle(0x4080c0);
      card.fillRoundedRect(this.uiX(leadX), this.uiY(leadY), this.uiS(leadW), this.uiS(leadH), this.uiS(8));
      card.fillStyle(0x58a0e0, 0.4);
      card.fillRect(this.uiX(leadX + 3), this.uiY(leadY + 3), this.uiS(leadW - 6), this.uiS(14));
      this.menuElements.push(card);

      // Self-contained vertical layout: every part is anchored to a fraction
      // of leadH so the contents always fit inside the card, for any party size.
      // Fonts go through uiS() so they render at the intended on-screen size
      // regardless of the current camera zoom.
      const cx = leadX + leadW / 2;
      const pad = Math.max(4, Math.round(leadH * 0.03));
      const hpLX = leadX + pad;
      const barBx = hpLX + Math.round(leadW * 0.20);
      const barW = Math.max(20, leadX + leadW - pad - barBx);

      // Icon (top, centered)
      const iconS = Math.min(leadW - pad * 2, Math.round(leadH * 0.34));
      const iconCY = leadY + pad + iconS / 2;
      const iconKey = this.textures.exists(`monster-${leadData.id}`) ? `monster-${leadData.id}` : `icon-${leadData.id}`;
      if (this.textures.exists(iconKey)) {
        this.menuElements.push(
          this.add.image(this.uiX(cx), this.uiY(iconCY), iconKey)
            .setScrollFactor(0).setDepth(203)
            .setDisplaySize(this.uiS(iconS), this.uiS(iconS))
        );
      }

      // Name + level
      this.menuElements.push(
        this.add.text(this.uiX(cx), this.uiY(leadY + Math.round(leadH * 0.46)), leadData.name, {
          fontSize: `${this.uiS(Math.round(leadH * 0.056))}px`, color: "#ffffff", fontFamily: F, fontStyle: "bold", ...STK,
        }).setScrollFactor(0).setDepth(204).setOrigin(0.5)
      );
      this.menuElements.push(
        this.add.text(this.uiX(cx), this.uiY(leadY + Math.round(leadH * 0.555)), `Lv${lead.level}`, {
          fontSize: `${this.uiS(Math.round(leadH * 0.048))}px`, color: "#ffffff", fontFamily: F, ...STK2,
        }).setScrollFactor(0).setDepth(204).setOrigin(0.5)
      );

      // HP label + bar
      const hpRatio = lead.currentHp / lead.maxHp;
      const hpRowY = leadY + Math.round(leadH * 0.65);
      const hpBarH = Math.max(5, Math.round(leadH * 0.042));
      this.menuElements.push(
        this.add.text(this.uiX(hpLX), this.uiY(hpRowY), "HP", {
          fontSize: `${this.uiS(Math.round(leadH * 0.044))}px`, color: "#f8a830", fontFamily: F, fontStyle: "bold", ...STK2,
        }).setScrollFactor(0).setDepth(204).setOrigin(0, 0.5)
      );
      const hpG = this.add.graphics().setScrollFactor(0).setDepth(203);
      drawCapsuleBar(hpG, barBx, hpRowY - hpBarH / 2, barW, hpBarH, hpRatio, hpColor(hpRatio));
      this.menuElements.push(hpG);
      // HP number below bar
      this.menuElements.push(
        this.add.text(this.uiX(cx), this.uiY(leadY + Math.round(leadH * 0.725)), `${lead.currentHp} / ${lead.maxHp}`, {
          fontSize: `${this.uiS(Math.round(leadH * 0.05))}px`, color: "#ffffff", fontFamily: F, fontStyle: "bold", ...STK,
        }).setScrollFactor(0).setDepth(204).setOrigin(0.5)
      );

      // EXP label + bar (progress toward next level)
      const expCur = getExpForLevel(lead.level);
      const expNext = getExpForLevel(lead.level + 1);
      const expRatio = Phaser.Math.Clamp((lead.exp - expCur) / Math.max(1, expNext - expCur), 0, 1);
      const expToNext = Math.max(0, expNext - lead.exp);
      const expRowY = leadY + Math.round(leadH * 0.82);
      const expBarH = Math.max(4, Math.round(leadH * 0.036));
      this.menuElements.push(
        this.add.text(this.uiX(hpLX), this.uiY(expRowY), "EXP", {
          fontSize: `${this.uiS(Math.round(leadH * 0.04))}px`, color: "#58a8e8", fontFamily: F, fontStyle: "bold", ...STK2,
        }).setScrollFactor(0).setDepth(204).setOrigin(0, 0.5)
      );
      const expG = this.add.graphics().setScrollFactor(0).setDepth(203);
      drawCapsuleBar(expG, barBx, expRowY - expBarH / 2, barW, expBarH, expRatio, EXP_BLUE);
      this.menuElements.push(expG);
      this.menuElements.push(
        this.add.text(this.uiX(cx), this.uiY(leadY + Math.round(leadH * 0.91)), `つぎまで ${expToNext}`, {
          fontSize: `${this.uiS(Math.round(leadH * 0.04))}px`, color: "#cfe8ff", fontFamily: F, ...STK2,
        }).setScrollFactor(0).setDepth(204).setOrigin(0.5)
      );
    }

    // ===== Slots 1-5: Right column (packed from top, tight gap) =====
    for (let i = 1; i < party.length; i++) {
      const mon = party[i];
      const data = allMonsters.find(m => m.id === mon.dataId);
      if (!data) continue;

      const slotIdx = i - 1;
      const cy = rightStartY + slotIdx * (rightSlotH + gap);
      const cx = rightX;

      // Row card
      const card = this.add.graphics().setScrollFactor(0).setDepth(201);
      card.fillStyle(0x5898d0);
      card.fillRoundedRect(this.uiX(cx), this.uiY(cy), this.uiS(rightW), this.uiS(rightSlotH), this.uiS(5));
      card.fillStyle(0x68a8e0, 0.3);
      card.fillRect(this.uiX(cx + 3), this.uiY(cy + 3), this.uiS(rightW - 6), this.uiS(8));
      this.menuElements.push(card);

      // Scale factor (base design was rightSlotH=42); uiS keeps the rendered
      // size correct under the camera zoom. Font scale is capped so text
      // (esp. names) never overflows these oversized cards horizontally.
      const s = rightSlotH / 42;
      const fsScale = Math.min(s, 2.4);
      const fs = (base: number) => `${this.uiS(base * fsScale)}px`;

      // Icon (left, spans full row height)
      const iconKey = this.textures.exists(`monster-${data.id}`) ? `monster-${data.id}` : `icon-${data.id}`;
      if (this.textures.exists(iconKey)) {
        this.menuElements.push(
          this.add.image(
            this.uiX(cx + 4 + rightIconSize / 2),
            this.uiY(cy + rightSlotH / 2),
            iconKey
          ).setScrollFactor(0).setDepth(203)
            .setDisplaySize(this.uiS(rightIconSize), this.uiS(rightIconSize))
        );
      }

      // Two-row text: top=name, bottom=Lv+HP bar+HP num
      const tx = cx + rightIconSize + Math.round(10 * s);
      const row1Y = cy + Math.round(4 * s);
      this.menuElements.push(
        this.add.text(this.uiX(tx), this.uiY(row1Y), data.name, {
          fontSize: fs(12), color: "#ffffff", fontFamily: F, fontStyle: "bold", ...STK2,
        }).setScrollFactor(0).setDepth(204)
      );

      const row2Y = cy + Math.round(22 * s);
      const rBarH = Math.max(6, Math.round(7 * s));
      // Lv label
      this.menuElements.push(
        this.add.text(this.uiX(tx), this.uiY(row2Y), `Lv${mon.level}`, {
          fontSize: fs(10), color: "#ffffff", fontFamily: F, ...STK2,
        }).setScrollFactor(0).setDepth(204)
      );
      // HP label right after Lv
      const hpLabelX = tx + Math.round(36 * s);
      this.menuElements.push(
        this.add.text(this.uiX(hpLabelX), this.uiY(row2Y), "HP", {
          fontSize: fs(9), color: "#f8a830", fontFamily: F, fontStyle: "bold", ...STK2,
        }).setScrollFactor(0).setDepth(204)
      );
      // HP bar: stretch from after HP label to before HP numbers
      const hpBx = hpLabelX + Math.round(22 * s);
      const hpNumW = Math.round(42 * s); // space reserved for "28/34" text
      const hpBarEndX = cx + rightW - 6 - hpNumW;
      const hpBarLen = Math.max(20, hpBarEndX - hpBx);
      const hpRatio = mon.currentHp / mon.maxHp;
      const hpG = this.add.graphics().setScrollFactor(0).setDepth(203);
      drawCapsuleBar(hpG, hpBx, row2Y + 2, hpBarLen, rBarH, hpRatio, hpColor(hpRatio));
      this.menuElements.push(hpG);
      // HP numbers right-aligned
      this.menuElements.push(
        this.add.text(this.uiX(cx + rightW - 6), this.uiY(row2Y - 1), `${mon.currentHp}/${mon.maxHp}`, {
          fontSize: fs(9), color: "#ffffff", fontFamily: F, ...STK2,
        }).setScrollFactor(0).setDepth(204).setOrigin(1, 0)
      );
      // EXP label + bar (third row)
      const row3Y = cy + Math.round(34 * s);
      const rExpBarH = Math.max(4, Math.round(5 * s));
      this.menuElements.push(
        this.add.text(this.uiX(tx), this.uiY(row3Y), "EXP", {
          fontSize: fs(8), color: "#58a8e8", fontFamily: F, fontStyle: "bold", ...STK2,
        }).setScrollFactor(0).setDepth(204)
      );
      const eExpCur = getExpForLevel(mon.level);
      const eExpNext = getExpForLevel(mon.level + 1);
      const eExpRatio = Phaser.Math.Clamp((mon.exp - eExpCur) / Math.max(1, eExpNext - eExpCur), 0, 1);
      const expG = this.add.graphics().setScrollFactor(0).setDepth(203);
      drawCapsuleBar(expG, hpBx, row3Y + 2, hpBarLen, rExpBarH, eExpRatio, EXP_BLUE);
      this.menuElements.push(expG);
    }

    // If only 1 mon
    if (party.length === 1) {
      this.menuElements.push(
        this.add.text(this.uiX(rightX + rightW / 2), this.uiY(rightStartY + Math.round(80 * (rightSlotH / 42))), "ほかの なかまは\nまだ いない", {
          fontSize: `${this.uiS(12 * Math.min(rightSlotH / 42, 2.4))}px`, color: "#ffffff", fontFamily: F, ...STK2, align: "center",
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5)
      );
    }
  }

  // ---- Player Info Screen ----
  private showPlayerInfoScreen(): void {
    this.menuSubScreen = "stub";
    this.clearMenuElements();
    const W = this.scale.width, H = this.scale.height;

    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.97); bg.fillRect(this.uiX(0), this.uiY(0), this.uiS(W), this.uiS(H));
    this.menuElements.push(bg);

    let playerName = "???";
    try { playerName = JSON.parse(localStorage.getItem("usamon-player-setup") || "{}").playerName || "???"; } catch(e) {}

    const money = this.playerState?.money || 0;
    const badges = this.playerState?.defeatedTrainers.length || 0;
    const party = this.playerState?.party.length || 0;

    const title = this.add.text(this.uiX(W/2), this.uiY(30), "プレイヤー情報", {
      fontSize: "22px", color: "#66aaff", fontFamily: "'DotGothic16', monospace", fontStyle: "bold", stroke: "#000000", strokeThickness: 3 }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(title);

    const lines = [
      `なまえ:  ${playerName}`,
      `しょじきん: ${money}円`,
      `てもち:  ${party}匹`,
      `たおしたトレーナー: ${badges}人`,
    ];
    lines.forEach((line, i) => {
      const t = this.add.text(this.uiX(60), this.uiY(80 + i * 44), line, {
        fontSize: "18px", color: "#ccddee", fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(201);
      this.menuElements.push(t);
    });

    const hint = this.add.text(this.uiX(W/2), this.uiY(H - 30), "Bボタンでもどる", {
      fontSize: "13px", color: "#ffffff", fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(hint);
  }

  // ---- Save Screen ----
  private showSaveScreen(): void {
    this.menuSubScreen = "save";
    this.clearMenuElements();
    const W = this.scale.width, H = this.scale.height;

    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.97); bg.fillRect(this.uiX(0), this.uiY(0), this.uiS(W), this.uiS(H));
    this.menuElements.push(bg);

    const panel = this.add.graphics().setScrollFactor(0).setDepth(201);
    panel.fillStyle(0x152040, 0.95);
    panel.fillRoundedRect(this.uiX(W/2 - 200), this.uiY(H/2 - 80), this.uiS(400), this.uiS(160), this.uiS(12));
    panel.lineStyle(2, 0x3366aa);
    panel.strokeRoundedRect(this.uiX(W/2 - 200), this.uiY(H/2 - 80), this.uiS(400), this.uiS(160), this.uiS(12));
    this.menuElements.push(panel);

    const msg = this.add.text(this.uiX(W/2), this.uiY(H/2 - 30), "レポートに きろくしますか？", {
      fontSize: "20px", color: "#ffffff", fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
    this.menuElements.push(msg);

    const hint = this.add.text(this.uiX(W/2), this.uiY(H/2 + 30), "Aボタン: はい  /  Bボタン: いいえ", {
      fontSize: "16px", color: "#88aacc", fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 3,
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
    const W = this.scale.width, H = this.scale.height;

    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.97); bg.fillRect(this.uiX(0), this.uiY(0), this.uiS(W), this.uiS(H));
    this.menuElements.push(bg);

    const msg = this.add.text(this.uiX(W/2), this.uiY(H/2), "レポートに きろくしました！", {
      fontSize: "22px", color: "#44cc88", fontFamily: "'DotGothic16', monospace", fontStyle: "bold", stroke: "#000000", strokeThickness: 3 }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
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
    const W = this.scale.width, H = this.scale.height;

    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.97); bg.fillRect(this.uiX(0), this.uiY(0), this.uiS(W), this.uiS(H));
    this.menuElements.push(bg);

    const t = this.add.text(this.uiX(W/2), this.uiY(H/2 - 20), title, {
      fontSize: "24px", color: "#66aaff", fontFamily: "'DotGothic16', monospace", fontStyle: "bold", stroke: "#000000", strokeThickness: 3 }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(t);

    const sub = this.add.text(this.uiX(W/2), this.uiY(H/2 + 20), "― じゅんびちゅう ―", {
      fontSize: "16px", color: "#ffffff", fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(sub);

    const hint = this.add.text(this.uiX(W/2), this.uiY(H - 30), "Bボタンでもどる", {
      fontSize: "13px", color: "#ffffff", fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(hint);
  }

  private closeSubScreen(): void {
    this.menuSubScreen = "none";
    this.drawMainMenu();
  }

  // ========== NPC & DIALOG SYSTEM ==========

  private placeKinoshitaNpc(): void {
    // Generate NPC sprite at same scale as player (fills 32x32 canvas)
    if (!this.textures.exists("npc-kinoshita")) {
      const c = document.createElement("canvas");
      c.width = 32; c.height = 32;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      // Lab coat body (fills canvas like player sprite)
      ctx.fillStyle = "#e0e0f0";
      ctx.fillRect(4, 14, 24, 18);
      // Coat collar
      ctx.fillStyle = "#c8c8e0";
      ctx.fillRect(4, 14, 24, 4);
      // Coat buttons
      ctx.fillStyle = "#aaaacc";
      ctx.fillRect(15, 20, 2, 2);
      ctx.fillRect(15, 25, 2, 2);
      // Head
      ctx.fillStyle = "#f0d8b8";
      ctx.beginPath(); ctx.arc(16, 11, 9, 0, Math.PI * 2); ctx.fill();
      // Hair (gray, receding)
      ctx.fillStyle = "#8888a0";
      ctx.fillRect(8, 2, 16, 6);
      ctx.fillRect(7, 5, 3, 5);
      ctx.fillRect(22, 5, 3, 5);
      // Glasses
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(9, 9, 6, 5);
      ctx.fillRect(17, 9, 6, 5);
      ctx.strokeStyle = "#334";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(9, 9, 6, 5);
      ctx.strokeRect(17, 9, 6, 5);
      ctx.beginPath(); ctx.moveTo(15, 11); ctx.lineTo(17, 11); ctx.stroke();
      // Eyes behind glasses
      ctx.fillStyle = "#222";
      ctx.fillRect(11, 11, 2, 2);
      ctx.fillRect(20, 11, 2, 2);
      // Smile
      ctx.strokeStyle = "#aa7766";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(16, 15, 3, 0.1*Math.PI, 0.9*Math.PI); ctx.stroke();
      this.textures.addCanvas("npc-kinoshita", c);
    }

    this.kinoshitaSprite = this.add.image(
      this.kinoshitaNpcX * this.tileSize + this.tileSize / 2,
      this.kinoshitaNpcY * this.tileSize + this.tileSize / 2,
      "npc-kinoshita"
    ).setDepth(9);
  }

  private placeNurseNpc(): void {
    if (!this.textures.exists("npc-nurse")) {
      const c = document.createElement("canvas");
      c.width = 32; c.height = 32;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      // White medical suit body
      ctx.fillStyle = "#e8e8f0";
      ctx.fillRect(6, 14, 20, 18);
      // Pink accent collar
      ctx.fillStyle = "#f0a0b0";
      ctx.fillRect(6, 14, 20, 3);
      // Red cross on chest
      ctx.fillStyle = "#e04060";
      ctx.fillRect(14, 19, 4, 8);
      ctx.fillRect(12, 22, 8, 4);
      // Head
      ctx.fillStyle = "#f0d8b8";
      ctx.beginPath(); ctx.arc(16, 11, 8, 0, Math.PI * 2); ctx.fill();
      // Hair (pink, tied up)
      ctx.fillStyle = "#e07890";
      ctx.fillRect(9, 3, 14, 5);
      ctx.fillRect(8, 5, 3, 6);
      ctx.fillRect(21, 5, 3, 6);
      // Hair buns
      ctx.beginPath(); ctx.arc(8, 6, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(24, 6, 3, 0, Math.PI * 2); ctx.fill();
      // Eyes
      ctx.fillStyle = "#222";
      ctx.fillRect(12, 10, 2, 2);
      ctx.fillRect(18, 10, 2, 2);
      // Smile
      ctx.strokeStyle = "#cc7766";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(16, 14, 3, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
      // Nurse cap
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(10, 2, 12, 4);
      ctx.fillStyle = "#e04060";
      ctx.fillRect(14, 2, 4, 3);
      this.textures.addCanvas("npc-nurse", c);
    }

    this.nurseSprite = this.add.image(
      this.nurseNpcX * this.tileSize + this.tileSize / 2,
      this.nurseNpcY * this.tileSize + this.tileSize / 2,
      "npc-nurse"
    ).setDepth(9);
  }

  private checkNpcInteraction(): void {
    let fx = this.gridX, fy = this.gridY;
    switch (this.facingDirection) {
      case "up": fy--; break;
      case "down": fy++; break;
      case "left": fx--; break;
      case "right": fx++; break;
    }
    if (this.kinoshitaSprite && fx === this.kinoshitaNpcX && fy === this.kinoshitaNpcY) {
      this.triggerKinoshitaEvent();
      return;
    }
    if (this.nurseSprite && fx === this.nurseNpcX && fy === this.nurseNpcY) {
      this.triggerNurseEvent();
      return;
    }
    if (this.shopkeeperSprite && fx === this.shopkeeperNpcX && fy === this.shopkeeperNpcY) {
      this.triggerShopkeeperEvent();
      return;
    }
  }

  private triggerKinoshitaEvent(): void {
    const hasStarter = this.playerState && this.playerState.party.length > 0;

    if (hasStarter) {
      // Return visit
      this.showDialog([
        "おお！ 元気そうだな！",
        "冒険は順調かい？\n困ったら いつでも戻っておいで！",
        "アルモンたちも\nきみと一緒で 嬉しそうだな。",
      ]);
      return;
    }

    // First meeting: introduction + give usamon
    this.showDialog([
      "やあやあ！ よく来たね！",
      "ここは月面開発プロジェクトの基地…\nムーンベースだ。",
      "わしは キノシタ。\nこの基地で アルモンの\n研究をしておるよ。",
      "アルモンというのはね、\n月に住む 不思議な生き物のことだ。",
      "きみも アルモンと一緒に\n月面を冒険してみないかね？",
      "実はこの子だけ\nもらい手がなくてなぁ…",
      "最後に売れ残ってたやつなんだが…\nどうかね？",
    ], () => {
      // Give usamon
      this.playerState = this.createDefaultPlayerState();
      this.showDialog([
        "★ うさもん（Lv.5）を もらった！",
        "大事にしてやってくれ！\nてもちから いつでも\n様子を 見られるぞ。",
        "それと…\nムーンカプセルも 5個つけておいた。\n野生のアルモンを 捕まえるのに使うんだ。",
        "さあ、南の出口から\n外に出てみるといい。\n月面には 色んなアルモンがいるぞ！",
      ]);
    });
  }

  private triggerNurseEvent(): void {
    this.showDialog([
      "ようこそ リカバリーポッドへ！",
      "アルモンを 回復しますね。\nしばらく おまちください…",
    ], () => {
      this.healParty();
      this.showDialog([
        "おまちどうさま！\nアルモンたちは すっかり\n元気になりましたよ！",
        "またいつでも いらしてくださいね！",
      ]);
    });
  }

  private healParty(): void {
    if (!this.playerState) return;
    const allMonsters = this.cache.json.get("monsters") as MonsterData[];
    for (const mon of this.playerState.party) {
      const data = allMonsters.find(m => m.id === mon.dataId);
      if (data) {
        const stats = calculateStats(data, mon.level);
        mon.currentHp = stats.hp;
        mon.maxHp = stats.hp;
      }
    }
  }

  // ========== SHOP SYSTEM ==========

  private placeShopkeeperNpc(): void {
    if (!this.textures.exists("npc-shopkeeper")) {
      const c = document.createElement("canvas");
      c.width = 32; c.height = 32;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      // Blue apron body
      ctx.fillStyle = "#4070b0";
      ctx.fillRect(6, 14, 20, 18);
      // Apron front
      ctx.fillStyle = "#5090d0";
      ctx.fillRect(10, 16, 12, 16);
      // Apron pocket
      ctx.fillStyle = "#3868a0";
      ctx.fillRect(12, 22, 8, 5);
      // Head
      ctx.fillStyle = "#f0d8b8";
      ctx.beginPath(); ctx.arc(16, 11, 8, 0, Math.PI * 2); ctx.fill();
      // Hair (brown, short)
      ctx.fillStyle = "#806040";
      ctx.fillRect(9, 3, 14, 5);
      ctx.fillRect(8, 5, 2, 4);
      ctx.fillRect(22, 5, 2, 4);
      // Eyes
      ctx.fillStyle = "#222";
      ctx.fillRect(12, 10, 2, 2);
      ctx.fillRect(18, 10, 2, 2);
      // Big smile
      ctx.strokeStyle = "#aa7766";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(16, 14, 4, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
      this.textures.addCanvas("npc-shopkeeper", c);
    }

    this.shopkeeperSprite = this.add.image(
      this.shopkeeperNpcX * this.tileSize + this.tileSize / 2,
      this.shopkeeperNpcY * this.tileSize + this.tileSize / 2,
      "npc-shopkeeper"
    ).setDepth(9);
  }

  private triggerShopkeeperEvent(): void {
    this.showDialog([
      "いらっしゃいませ！\nプラネットショップへ ようこそ！",
      "なにを おかいもとめですか？",
    ], () => {
      this.openShop();
    });
  }

  private openShop(): void {
    this.shopOpen = true;
    this.shopSelectedIndex = 0;
    this.shopGpPrevDpad = null;
    this.shopMessage = "";
    this.dialogActive = false;
    this.drawShopUI();
  }

  private closeShop(): void {
    this.shopOpen = false;
    this.clearShopElements();
    this.shopGpPrevDpad = null;
  }

  private clearShopElements(): void {
    this.shopElements.forEach(el => el.destroy());
    this.shopElements = [];
  }

  private drawShopUI(): void {
    this.clearShopElements();
    const W = this.scale.width;
    const H = this.scale.height;
    const F = "'DotGothic16', monospace";
    const STK = { stroke: "#000000", strokeThickness: 3 };
    // Zoom-safe font size: text is rendered under the camera zoom, so divide by
    // it here to keep the on-screen size matching the (screen-space) layout.
    const FS = (n: number) => `${this.uiS(n)}px`;

    const allItems = (this.cache.json.get("items") || []) as { id: string; name: string; description: string; price: number }[];
    const inventory = MapScene.SHOP_INVENTORY.map(id => allItems.find(i => i.id === id)!).filter(Boolean);
    const totalOptions = inventory.length + 1; // +1 for やめる

    // Dark overlay
    const overlay = this.add.graphics().setScrollFactor(0).setDepth(200);
    overlay.fillStyle(0x000000, 0.6);
    overlay.fillRect(this.uiX(0), this.uiY(0), this.uiS(W), this.uiS(H));
    this.shopElements.push(overlay);

    // Panel
    const px = 20, py = 16;
    const pw = W - 40, ph = H - 32;
    const panel = this.add.graphics().setScrollFactor(0).setDepth(201);
    panel.fillStyle(0x0a1628, 0.95);
    panel.fillRoundedRect(this.uiX(px), this.uiY(py), this.uiS(pw), this.uiS(ph), this.uiS(12));
    panel.lineStyle(2, 0xcc8833);
    panel.strokeRoundedRect(this.uiX(px), this.uiY(py), this.uiS(pw), this.uiS(ph), this.uiS(12));
    this.shopElements.push(panel);

    // Title
    this.shopElements.push(
      this.add.text(this.uiX(W / 2), this.uiY(py + 18), "★ プラネットショップ", {
        fontSize: FS(16), color: "#ffcc44", fontFamily: F, fontStyle: "bold", ...STK,
      }).setScrollFactor(0).setDepth(202).setOrigin(0.5)
    );

    // Items list
    const itemStartY = py + 42;
    const itemH = 28;
    for (let i = 0; i < totalOptions; i++) {
      const iy = itemStartY + i * itemH;
      const isSelected = i === this.shopSelectedIndex;
      const isQuit = i >= inventory.length;

      // Selection highlight
      if (isSelected) {
        const bg = this.add.graphics().setScrollFactor(0).setDepth(202);
        bg.fillStyle(0x1a3366, 0.9);
        bg.fillRoundedRect(this.uiX(px + 6), this.uiY(iy + 1), this.uiS(pw - 12), this.uiS(itemH - 2), this.uiS(4));
        this.shopElements.push(bg);
      }

      // Arrow
      if (isSelected) {
        this.shopElements.push(
          this.add.text(this.uiX(px + 12), this.uiY(iy + itemH / 2), "▶", {
            fontSize: FS(11), color: "#ffcc44", fontFamily: F, ...STK,
          }).setScrollFactor(0).setDepth(203).setOrigin(0, 0.5)
        );
      }

      if (isQuit) {
        this.shopElements.push(
          this.add.text(this.uiX(px + 28), this.uiY(iy + itemH / 2), "やめる", {
            fontSize: FS(14), color: isSelected ? "#ffffff" : "#8899aa", fontFamily: F, ...STK,
          }).setScrollFactor(0).setDepth(203).setOrigin(0, 0.5)
        );
      } else {
        const item = inventory[i];
        // Name
        this.shopElements.push(
          this.add.text(this.uiX(px + 28), this.uiY(iy + itemH / 2), item.name, {
            fontSize: FS(14), color: isSelected ? "#ffffff" : "#8899aa", fontFamily: F, ...STK,
          }).setScrollFactor(0).setDepth(203).setOrigin(0, 0.5)
        );
        // Owned count
        const owned = this.playerState?.items.find(it => it.id === item.id)?.count || 0;
        if (owned > 0) {
          this.shopElements.push(
            this.add.text(this.uiX(px + pw - 70), this.uiY(iy + itemH / 2), `×${owned}`, {
              fontSize: FS(11), color: "#88aacc", fontFamily: F, ...STK,
            }).setScrollFactor(0).setDepth(203).setOrigin(1, 0.5)
          );
        }
        // Price
        this.shopElements.push(
          this.add.text(this.uiX(px + pw - 12), this.uiY(iy + itemH / 2), `¥${item.price}`, {
            fontSize: FS(13), color: isSelected ? "#aaffaa" : "#668866", fontFamily: F, ...STK,
          }).setScrollFactor(0).setDepth(203).setOrigin(1, 0.5)
        );
      }
    }

    // Separator
    const descY = itemStartY + totalOptions * itemH + 6;
    const sep = this.add.graphics().setScrollFactor(0).setDepth(202);
    sep.fillStyle(0xcc8833, 0.4);
    sep.fillRect(this.uiX(px + 8), this.uiY(descY), this.uiS(pw - 16), this.uiS(1));
    this.shopElements.push(sep);

    // Description
    let descStr = "";
    if (this.shopSelectedIndex < inventory.length) {
      descStr = inventory[this.shopSelectedIndex].description;
    }
    this.shopElements.push(
      this.add.text(this.uiX(px + 14), this.uiY(descY + 8), descStr, {
        fontSize: FS(12), color: "#ccddee", fontFamily: F, ...STK,
        wordWrap: { width: this.uiS(pw - 28) },
      }).setScrollFactor(0).setDepth(203)
    );

    // Money
    const money = this.playerState?.money || 0;
    this.shopElements.push(
      this.add.text(this.uiX(px + pw - 12), this.uiY(descY + 46), `しょじきん: ${money}円`, {
        fontSize: FS(12), color: "#ffdd88", fontFamily: F, ...STK,
      }).setScrollFactor(0).setDepth(203).setOrigin(1, 0)
    );

    // Status message (purchase result)
    if (this.shopMessage) {
      const msgColor = this.shopMessage.includes("たりない") ? "#ff8888" : "#88ff88";
      this.shopElements.push(
        this.add.text(this.uiX(px + 14), this.uiY(descY + 46), this.shopMessage, {
          fontSize: FS(12), color: msgColor, fontFamily: F, ...STK,
        }).setScrollFactor(0).setDepth(203)
      );
    }

    // Controls hint
    this.shopElements.push(
      this.add.text(this.uiX(W / 2), this.uiY(py + ph - 10), "A:かう  B:やめる", {
        fontSize: FS(10), color: "#8899aa", fontFamily: F,
      }).setScrollFactor(0).setDepth(203).setOrigin(0.5)
    );
  }

  private updateShop(a: boolean, b: boolean, dpad: string | null): void {
    const allItems = (this.cache.json.get("items") || []) as { id: string; name: string; description: string; price: number }[];
    const inventory = MapScene.SHOP_INVENTORY.map(id => allItems.find(i => i.id === id)!).filter(Boolean);
    const totalOptions = inventory.length + 1;

    // D-pad edge detection
    const justUp = dpad === "up" && this.shopGpPrevDpad !== "up";
    const justDown = dpad === "down" && this.shopGpPrevDpad !== "down";
    this.shopGpPrevDpad = dpad;

    // Keyboard
    let kbUp = false, kbDown = false, kbEnter = false;
    if (this.input.keyboard && this.cursors) {
      kbUp = Phaser.Input.Keyboard.JustDown(this.cursors.up);
      kbDown = Phaser.Input.Keyboard.JustDown(this.cursors.down);
      kbEnter = Phaser.Input.Keyboard.JustDown(this.input.keyboard.addKey("ENTER"));
    }

    if (justUp || kbUp) {
      this.shopSelectedIndex = (this.shopSelectedIndex - 1 + totalOptions) % totalOptions;
      this.shopMessage = "";
      this.drawShopUI();
      return;
    }
    if (justDown || kbDown) {
      this.shopSelectedIndex = (this.shopSelectedIndex + 1) % totalOptions;
      this.shopMessage = "";
      this.drawShopUI();
      return;
    }

    if (b) {
      this.closeShop();
      this.showDialog(["ありがとうございました！\nまた おこしくださいね！"]);
      return;
    }

    if (a || kbEnter) {
      if (this.shopSelectedIndex >= inventory.length) {
        // やめる
        this.closeShop();
        this.showDialog(["ありがとうございました！\nまた おこしくださいね！"]);
      } else {
        this.purchaseItem(this.shopSelectedIndex);
      }
    }
  }

  private purchaseItem(idx: number): void {
    const allItems = (this.cache.json.get("items") || []) as { id: string; name: string; description: string; price: number }[];
    const inventory = MapScene.SHOP_INVENTORY.map(id => allItems.find(i => i.id === id)!).filter(Boolean);
    const item = inventory[idx];
    if (!item || !this.playerState) return;

    if (this.playerState.money < item.price) {
      this.shopMessage = "おかねが たりない！";
      this.drawShopUI();
      return;
    }

    this.playerState.money -= item.price;
    const existing = this.playerState.items.find(i => i.id === item.id);
    if (existing) {
      existing.count++;
    } else {
      this.playerState.items.push({ id: item.id, count: 1 });
    }
    this.shopMessage = `${item.name}を かった！`;
    this.drawShopUI();
  }

  // ---- Dialog System ----
  private showDialog(messages: string[], onComplete?: () => void): void {
    this.dialogActive = true;
    this.dialogMessages = messages;
    this.dialogIndex = 0;
    this.dialogCallback = onComplete;
    this.drawDialogMessage();
  }

  private drawDialogMessage(): void {
    this.clearDialogElements();
    const W = this.scale.width;
    const H = this.scale.height;
    const margin = 20;
    const boxH = 90;
    const boxY = H - boxH - 16;

    // Box background
    const bg = this.add.graphics().setScrollFactor(0).setDepth(300);
    bg.fillStyle(0x0a1628, 0.95);
    bg.fillRoundedRect(this.uiX(margin), this.uiY(boxY), this.uiS(W - margin*2), this.uiS(boxH), this.uiS(10));
    bg.lineStyle(2, 0x3366aa);
    bg.strokeRoundedRect(this.uiX(margin), this.uiY(boxY), this.uiS(W - margin*2), this.uiS(boxH), this.uiS(10));
    this.dialogElements.push(bg);

    // Text
    const msg = this.dialogMessages[this.dialogIndex];
    const text = this.add.text(this.uiX(margin + 16), this.uiY(boxY + 14), msg, {
      fontSize: `${this.uiS(14)}px`, color: "#ffffff", fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 3,
      wordWrap: { width: this.uiS(W - margin*2 - 48) }, lineSpacing: this.uiS(4),
    }).setScrollFactor(0).setDepth(301);
    this.dialogElements.push(text);

    // Advance indicator
    if (this.dialogIndex < this.dialogMessages.length - 1 || this.dialogCallback) {
      const indicator = this.add.text(this.uiX(W - margin - 16), this.uiY(boxY + boxH - 20), "▼", {
        fontSize: `${this.uiS(12)}px`, color: "#66aaff", fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(301);
      this.dialogElements.push(indicator);
    }

    // Tap to advance
    const zone = this.add.zone(this.uiX(W/2), this.uiY(boxY + boxH/2), this.uiS(W), this.uiS(boxH))
      .setScrollFactor(0).setDepth(302).setOrigin(0.5).setInteractive();
    zone.on("pointerdown", () => this.advanceDialog());
    this.dialogElements.push(zone);
  }

  private advanceDialog(): void {
    this.dialogIndex++;
    if (this.dialogIndex >= this.dialogMessages.length) {
      const cb = this.dialogCallback;
      this.dialogCallback = undefined;
      this.clearDialogElements();
      if (cb) {
        cb();
      } else {
        this.dialogActive = false;
      }
      return;
    }
    this.drawDialogMessage();
  }

  private clearDialogElements(): void {
    this.dialogElements.forEach(el => el.destroy());
    this.dialogElements = [];
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
