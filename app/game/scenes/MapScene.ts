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

  // Rival NPC (Moon Town)
  private rivalSprite?: Phaser.GameObjects.Image;
  private rivalNpcX = 14;
  private rivalNpcY = 12;

  // Mom NPC (player/rival home interiors)
  private momSprite?: Phaser.GameObjects.Image;
  private momNpcX = 2;
  private momNpcY = 3;

  // Shopkeeper NPC (Planet Shop) — npc tile is the counter front; the sprite
  // is drawn one tile behind it (RSE-style talking across the counter).
  private shopkeeperSprite?: Phaser.GameObjects.Image;
  private shopkeeperNpcX = 2;
  private shopkeeperNpcY = 2;

  // Researcher NPCs (Medical Center) — talk-only
  private researcher1Sprite?: Phaser.GameObjects.Image;
  private researcher1NpcX = 3;
  private researcher1NpcY = 3;
  private researcher2Sprite?: Phaser.GameObjects.Image;
  private researcher2NpcX = 6;
  private researcher2NpcY = 3;

  // Resident NPC (house interiors) — talk-only
  private residentSprite?: Phaser.GameObjects.Image;
  private residentNpcX = 3;
  private residentNpcY = 3;

  // Lab researcher NPCs (Moonbase = 博士の研究所) — talk-only
  private labRes1Sprite?: Phaser.GameObjects.Image;
  private labRes1X = 6;
  private labRes1Y = 8;
  private labRes2Sprite?: Phaser.GameObjects.Image;
  private labRes2X = 17;
  private labRes2Y = 8;

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
  // Party reorder state
  private partySelIndex = 0;
  private partyPickIndex = -1;
  private partyGpPrevDpad: string | null = null;

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
    this.rivalSprite = undefined;
    this.momSprite = undefined;
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

    this.applyAstronautFrames();
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
      this.placeMoonbaseDecor();
      this.placeKinoshitaNpc();
      this.placeLabNpcs();
    }

    // Place Nurse NPC in recovery pod
    if (this.currentMapKey === "recovery_pod") {
      this.placeRecoveryPodDecor();
      this.placeNurseNpc();
    }

    // Place Shopkeeper NPC in planet shop
    if (this.currentMapKey === "planet_shop") {
      this.placePlanetShopDecor();
      this.placeShopkeeperNpc();
    }

    // Place Rival NPC in moon town
    if (this.currentMapKey === "moon_town") {
      this.placeRivalNpc();
    }

    // Home interiors (player / rival)
    if (this.currentMapKey === "player_home" || this.currentMapKey === "rival_home") {
      this.placeHomeDecor(this.currentMapKey === "player_home");
      this.placeMomNpc();
    }

    // Medical Center interior — two researchers to talk to
    if (this.currentMapKey === "medical_center") {
      this.placeMedicalNpcs();
    }

    // House interiors — cozy home + a resident to talk to
    if (this.currentMapKey.startsWith("house_")) {
      this.placeHomeDecor(false);
      this.placeResidentNpc();
    }
  }

  // Animated tile base IDs (sand sparkle + farm crops). 70 = farm crop bed.
  private static SAND_TILE_IDS = [5, 6, 7, 8, 9, 10, 11, 12, 32, 33, 34, 35, 36, 70];
  // Base tile -> [frame A, frame B] cycled every 800ms (base -> A -> B).
  // Sand sparkle: A=41-48, B=49-56. Farm crop: 70 -> 71/72.
  private static SPARKLE_MAP: Record<number, [number, number]> = {
    5: [41, 49], 6: [42, 50], 7: [43, 51], 8: [44, 52],
    9: [45, 53], 10: [46, 54], 11: [47, 55], 12: [48, 56],
    32: [41, 49], 33: [42, 50], 34: [43, 51], 35: [44, 52],
    36: [45, 53], 70: [71, 72],
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

    // Consistent "walking" scale across every map (interiors and outdoors alike)
    // so the player never appears to change size between a town and a small room.
    // ~2.5x sits between the old zoomed-out towns and the very zoomed-in interiors.
    const zoom = 2.5;
    cam.setZoom(zoom);

    // Bounds so the camera never scrolls past the map edges. Maps smaller than
    // the viewport get extra "padding" bounds so the camera can centre them
    // (the padded area shows the black background, which the design allows).
    const viewW = canvasW / zoom;
    const viewH = canvasH / zoom;
    const boundX = worldW >= viewW ? 0 : (worldW - viewW) / 2;
    const boundY = worldH >= viewH ? 0 : (worldH - viewH) / 2;
    const boundW = Math.max(worldW, viewW);
    const boundH = Math.max(worldH, viewH);
    cam.setBounds(boundX, boundY, boundW, boundH);
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
      .setAlpha(0)
      .setResolution(Math.max(1, this.cameras.main.zoom));

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
    if (this.rivalSprite && x === this.rivalNpcX && y === this.rivalNpcY) return true;
    if (this.momSprite && x === this.momNpcX && y === this.momNpcY) return true;
    if (this.researcher1Sprite && x === this.researcher1NpcX && y === this.researcher1NpcY) return true;
    if (this.researcher2Sprite && x === this.researcher2NpcX && y === this.researcher2NpcY) return true;
    if (this.residentSprite && x === this.residentNpcX && y === this.residentNpcY) return true;
    if (this.labRes1Sprite && x === this.labRes1X && y === this.labRes1Y) return true;
    if (this.labRes2Sprite && x === this.labRes2X && y === this.labRes2Y) return true;
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
  /**
   * Render text objects at the camera-zoom resolution. UI text on zoomed
   * interior maps is otherwise rasterized tiny and scaled up, which makes
   * the glyphs look thin and blurry.
   */
  private applyTextResolution(objs: Phaser.GameObjects.GameObject[]): void {
    const r = Math.max(1, this.cameras.main.zoom);
    for (const o of objs) {
      if (o instanceof Phaser.GameObjects.Text) o.setResolution(r);
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
    this.applyTextResolution(this.menuElements);
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
      if (this.menuSubScreen === "party") { this.updatePartyScreen(a, b, menu, dpad); return; }
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

  // Party reorder: move a cursor, pick a monster (A), then pick a target (A) to swap.
  private updatePartyScreen(a: boolean, b: boolean, menu: boolean, dpad: string | null): void {
    const n = this.playerState?.party.length || 0;
    if (n === 0) { if (b || menu) this.closeSubScreen(); return; }

    const justUp = (dpad === "up" || dpad === "left") && this.partyGpPrevDpad !== dpad;
    const justDown = (dpad === "down" || dpad === "right") && this.partyGpPrevDpad !== dpad;
    this.partyGpPrevDpad = dpad;

    let kbUp = false, kbDown = false, kbEnter = false;
    if (this.input.keyboard && this.cursors) {
      kbUp = Phaser.Input.Keyboard.JustDown(this.cursors.up) || Phaser.Input.Keyboard.JustDown(this.cursors.left);
      kbDown = Phaser.Input.Keyboard.JustDown(this.cursors.down) || Phaser.Input.Keyboard.JustDown(this.cursors.right);
      kbEnter = Phaser.Input.Keyboard.JustDown(this.input.keyboard.addKey("ENTER"));
    }

    if (b || menu) {
      if (this.partyPickIndex >= 0) { this.partyPickIndex = -1; this.drawPartyScreen(); }
      else this.closeSubScreen();
      return;
    }
    if (justUp || kbUp) { this.partySelIndex = (this.partySelIndex - 1 + n) % n; this.drawPartyScreen(); return; }
    if (justDown || kbDown) { this.partySelIndex = (this.partySelIndex + 1) % n; this.drawPartyScreen(); return; }
    if (a || kbEnter) {
      if (this.partyPickIndex < 0) {
        this.partyPickIndex = this.partySelIndex;
      } else {
        if (this.partyPickIndex !== this.partySelIndex && this.playerState) {
          const p = this.playerState.party;
          const tmp = p[this.partyPickIndex];
          p[this.partyPickIndex] = p[this.partySelIndex];
          p[this.partySelIndex] = tmp;
        }
        this.partyPickIndex = -1;
      }
      this.drawPartyScreen();
      return;
    }
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
    this.partySelIndex = 0;
    this.partyPickIndex = -1;
    this.partyGpPrevDpad = null;
    this.drawPartyScreen();
  }

  private drawPartyScreen(): void {
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
    const picking = this.partyPickIndex >= 0;
    this.menuElements.push(
      this.add.text(this.uiX(14), this.uiY(barY + barH / 2),
        picking ? "いれかえる あいてを えらんで" : "いれかえる アルモンを えらんで", {
        fontSize: `${this.uiS(13)}px`, color: "#303030", fontFamily: F, ...STK2,
        stroke: "#ffffff", strokeThickness: 0,
      }).setScrollFactor(0).setDepth(211).setOrigin(0, 0.5)
    );
    this.menuElements.push(
      this.add.text(this.uiX(W - 10), this.uiY(barY + barH / 2), picking ? "B:キャンセル" : "B:もどる", {
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
        const img = this.add.image(this.uiX(cx), this.uiY(iconCY), iconKey)
          .setScrollFactor(0).setDepth(203);
        // Fit within the icon box, preserving aspect (sprites are tight-cropped).
        img.setScale(Math.min(this.uiS(iconS) / img.width, this.uiS(iconS) / img.height));
        this.menuElements.push(img);
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
        const img = this.add.image(
          this.uiX(cx + 4 + rightIconSize / 2),
          this.uiY(cy + rightSlotH / 2),
          iconKey
        ).setScrollFactor(0).setDepth(203);
        // Fit within the icon box, preserving aspect (sprites are tight-cropped).
        img.setScale(Math.min(this.uiS(rightIconSize) / img.width, this.uiS(rightIconSize) / img.height));
        this.menuElements.push(img);
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

    // ---- Selection cursor & pick highlight (for reordering) ----
    const slotRect = (i: number) => i === 0
      ? { x: leadX, y: leadY, w: leadW, h: leadH }
      : { x: rightX, y: rightStartY + (i - 1) * (rightSlotH + gap), w: rightW, h: rightSlotH };
    const hl = this.add.graphics().setScrollFactor(0).setDepth(205);
    if (this.partyPickIndex >= 0 && this.partyPickIndex < party.length) {
      const r = slotRect(this.partyPickIndex);
      hl.lineStyle(5, 0xffd23c);
      hl.strokeRoundedRect(this.uiX(r.x - 4), this.uiY(r.y - 4), this.uiS(r.w + 8), this.uiS(r.h + 8), this.uiS(10));
    }
    if (this.partySelIndex >= 0 && this.partySelIndex < party.length) {
      const r = slotRect(this.partySelIndex);
      hl.lineStyle(4, 0x66ddff);
      hl.strokeRoundedRect(this.uiX(r.x - 2), this.uiY(r.y - 2), this.uiS(r.w + 4), this.uiS(r.h + 4), this.uiS(9));
    }
    this.menuElements.push(hl);

    this.applyTextResolution(this.menuElements);
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
    this.applyTextResolution(this.menuElements);
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
    this.applyTextResolution(this.menuElements);
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
    this.applyTextResolution(this.menuElements);

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
    this.applyTextResolution(this.menuElements);
  }

  private closeSubScreen(): void {
    this.menuSubScreen = "none";
    this.drawMainMenu();
  }

  /**
   * Override the generated suit sprite with the hand-drawn astronaut protagonist
   * (cast char0). Runs on every MapScene entry so it wins over BootScene/SetupScene
   * suit frames regardless of how the scene was reached. Frame 1 (walk) bobs 1px up.
   */
  private applyAstronautFrames(): void {
    const dirs: Record<string, string> = {
      down: "cast-char0-down",
      up: "cast-char0-up",
      left: "cast-char0-left",
      right: "cast-char0-right",
    };
    for (const [dir, key] of Object.entries(dirs)) {
      if (!this.textures.exists(key)) return; // assets missing → keep suit sprite
      const src = this.textures.get(key).getSourceImage() as CanvasImageSource;
      for (let i = 0; i < 2; i++) {
        const canvas = document.createElement("canvas");
        canvas.width = 32; canvas.height = 32;
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(src, 0, i === 1 ? -1 : 0);
        const tk = `player-${dir}-${i}`;
        if (this.textures.exists(tk)) this.textures.remove(tk);
        this.textures.addCanvas(tk, canvas);
      }
    }
    for (let i = 0; i < 2; i++) {
      const tk = `player-frame-${i}`;
      const sk = `player-down-${i}`;
      if (this.textures.exists(sk)) {
        if (this.textures.exists(tk)) this.textures.remove(tk);
        this.textures.addCanvas(
          tk,
          this.textures.get(sk).getSourceImage() as HTMLCanvasElement
        );
      }
    }
  }

  // ========== NPC & DIALOG SYSTEM ==========

  /** Prefer the hand-drawn cast sprite when it loaded, else the canvas fallback. */
  private npcTex(cast: string, fallback: string): string {
    return this.textures.exists(cast) ? cast : fallback;
  }

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
      this.npcTex("cast-char6-down", "npc-kinoshita")
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

    // Nurse stands one tile behind the reception counter; her interaction tile
    // (nurseNpcX/Y) is the counter front, so the player talks across it.
    this.nurseSprite = this.add.image(
      this.nurseNpcX * this.tileSize + this.tileSize / 2,
      (this.nurseNpcY - 1) * this.tileSize + this.tileSize / 2,
      this.npcTex("cast-char1-down", "npc-nurse")
    ).setDepth(7);
  }

  // Pokemon-Center-style interior decorations for the recovery pod.
  private placeRecoveryPodDecor(): void {
    const ts = this.tileSize;
    this.genPodTextures();

    // Warm cream floor overlay over the interior (rows 1-6, cols 1-8),
    // with the official-style ring of dot clusters in the room center.
    const fo = this.add.graphics().setDepth(1);
    fo.fillStyle(0xf3e9cf, 1);
    fo.fillRect(ts, ts, 8 * ts, 6 * ts);
    fo.fillStyle(0xfbf5e4, 1);              // lighter central walk path
    fo.fillRect(4 * ts, ts, 2 * ts, 6 * ts);
    // soft checker shading (subtle 16px tiles)
    fo.fillStyle(0xe9dcba, 0.5);
    for (let y = ts; y < 7 * ts; y += 16) {
      for (let x = ts; x < 9 * ts; x += 16) {
        if (((x / 16) + (y / 16)) % 2 === 0) fo.fillRect(x, y, 16, 16);
      }
    }
    // central dotted ring (like the Pokemon Center floor motif)
    const rcx = 5 * ts, rcy = Math.round(4.4 * ts);
    const dot = (dx: number, dy: number, r: number, col: number) => {
      fo.fillStyle(col, 1); fo.fillCircle(rcx + dx, rcy + dy, r);
    };
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      dot(Math.cos(a) * 42, Math.sin(a) * 30, 4, 0xe6c98e);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      dot(Math.cos(a) * 22, Math.sin(a) * 15, 3, 0xdeba76);
    }
    dot(0, 0, 4, 0xd8ac5e);

    // Healing machine (back), reception counter (front), plants, PC, bench.
    this.add.image(5 * ts, Math.round(1.35 * ts), "pod-machine").setDepth(6);
    this.add.image(5 * ts, Math.round(2.55 * ts), "pod-counter").setDepth(8);
    this.add.image(1 * ts + ts / 2, Math.round(1.35 * ts), "pod-plant").setDepth(6);
    this.add.image(8 * ts + ts / 2, Math.round(1.35 * ts), "pod-plant").setDepth(6);
    this.add.image(8 * ts + ts / 2, Math.round(5.9 * ts), "pod-pc").setDepth(6);
    this.add.image(1 * ts + ts / 2, 6 * ts + ts / 2, "pod-bench").setDepth(6);
  }

  private genPodTextures(): void {
    const mk = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
      if (this.textures.exists(key)) return;
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      draw(ctx);
      this.textures.addCanvas(key, c);
    };
    // Moon capsule: navy top (gold crescent+star), gold band, white bottom.
    const capsule = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => {
      ctx.fillStyle = "#e9ebf2"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI); ctx.fill();
      ctx.fillStyle = "#d0d4e2"; ctx.beginPath(); ctx.arc(cx, cy + r * 0.35, r * 0.8, 0, Math.PI); ctx.fill();
      ctx.fillStyle = "#2c3a6e"; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "#48588f"; ctx.beginPath(); ctx.arc(cx - r * 0.35, cy - r * 0.42, r * 0.3, 0, Math.PI * 2); ctx.fill();
      // gold band
      ctx.fillStyle = "#d8ac38"; ctx.fillRect(cx - r, cy - Math.max(1, r * 0.12), r * 2, Math.max(2, r * 0.24));
      // gold crescent + star on the navy half
      ctx.strokeStyle = "#f0c84a"; ctx.lineWidth = Math.max(1, r * 0.18);
      ctx.beginPath(); ctx.arc(cx - r * 0.05, cy - r * 0.45, r * 0.34, Math.PI * 0.55, Math.PI * 1.85); ctx.stroke();
      ctx.fillStyle = "#f6d76a"; ctx.fillRect(cx + r * 0.32, cy - r * 0.62, Math.max(1, r * 0.16), Math.max(1, r * 0.16));
      // outline
      ctx.strokeStyle = "#141a2e"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    };
    // Healing machine: 128x64 (chassis + glass star-dome + capsule trays)
    mk("pod-machine", 128, 64, (ctx) => {
      // chassis with shading bands
      ctx.fillStyle = "#e3e8f0"; this.roundRect(ctx, 8, 18, 112, 44, 6); ctx.fill();
      ctx.fillStyle = "#f4f7fb"; this.roundRect(ctx, 10, 20, 108, 8, 4); ctx.fill();   // top highlight
      ctx.fillStyle = "#c3cbdb"; ctx.fillRect(8, 46, 112, 8);                            // mid shade
      ctx.fillStyle = "#98a2b8"; ctx.fillRect(8, 54, 112, 8);                            // base
      // vertical seams
      ctx.fillStyle = "#b4bdd0";
      ctx.fillRect(40, 22, 2, 30); ctx.fillRect(86, 22, 2, 30);
      // central glass dome: night sky + stars (the "moon" scanner)
      ctx.fillStyle = "#101a38"; this.roundRect(ctx, 46, 24, 36, 26, 5); ctx.fill();
      ctx.fillStyle = "#26346a"; this.roundRect(ctx, 48, 26, 32, 10, 4); ctx.fill();
      ctx.fillStyle = "#f6d76a";
      ctx.fillRect(53, 30, 2, 2); ctx.fillRect(63, 27, 2, 2); ctx.fillRect(73, 32, 2, 2);
      ctx.fillRect(58, 40, 2, 2); ctx.fillRect(70, 43, 2, 2);
      // gold crescent in the dome
      ctx.strokeStyle = "#f0c84a"; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(64, 38, 6, Math.PI * 0.5, Math.PI * 1.8); ctx.stroke();
      ctx.strokeStyle = "#3c4a80"; ctx.lineWidth = 1.6;
      this.roundRect(ctx, 46, 24, 36, 26, 5); ctx.stroke();
      // indicator lights
      ctx.fillStyle = "#f0d040"; ctx.fillRect(16, 32, 6, 5);
      ctx.fillStyle = "#f05040"; ctx.fillRect(16, 40, 6, 5);
      ctx.fillStyle = "#50d0f0"; ctx.fillRect(106, 32, 6, 5);
      ctx.fillStyle = "#8ef0a0"; ctx.fillRect(106, 40, 6, 5);
      // outline
      ctx.strokeStyle = "#39415c"; ctx.lineWidth = 2; this.roundRect(ctx, 8, 18, 112, 44, 6); ctx.stroke();
      // capsule trays on top (3 + 3 moon capsules)
      ctx.fillStyle = "#aab4c8"; this.roundRect(ctx, 12, 8, 42, 12, 4); ctx.fill();
      this.roundRect(ctx, 74, 8, 42, 12, 4); ctx.fill();
      ctx.strokeStyle = "#6a7590"; ctx.lineWidth = 1.5;
      this.roundRect(ctx, 12, 8, 42, 12, 4); ctx.stroke(); this.roundRect(ctx, 74, 8, 42, 12, 4); ctx.stroke();
      for (let i = 0; i < 3; i++) capsule(ctx, 21 + i * 12, 13, 6);
      for (let i = 0; i < 3; i++) capsule(ctx, 83 + i * 12, 13, 6);
    });
    // Reception counter: 128x40 (cream top, warm wood front, moon capsules)
    mk("pod-counter", 128, 40, (ctx) => {
      ctx.fillStyle = "#f4ecd8"; this.roundRect(ctx, 4, 4, 120, 14, 7); ctx.fill();     // top surface
      ctx.fillStyle = "#fdf8ec"; this.roundRect(ctx, 6, 5, 116, 5, 4); ctx.fill();      // top sheen
      ctx.fillStyle = "#e0a850"; ctx.fillRect(6, 16, 116, 14);                            // front panel
      ctx.fillStyle = "#c98c34"; ctx.fillRect(6, 25, 116, 5);                             // panel shade
      ctx.fillStyle = "#a06a20"; ctx.fillRect(6, 30, 116, 6);                             // base
      // panel seams
      ctx.fillStyle = "#b47c2c"; ctx.fillRect(42, 17, 2, 12); ctx.fillRect(84, 17, 2, 12);
      ctx.strokeStyle = "#6e4a14"; ctx.lineWidth = 2; this.roundRect(ctx, 4, 4, 120, 32, 7); ctx.stroke();
      capsule(ctx, 20, 11, 6); capsule(ctx, 108, 11, 6);
    });
    // Potted plant: 32x48 (3-tone leaves + rimmed pot)
    mk("pod-plant", 32, 48, (ctx) => {
      ctx.fillStyle = "#2e7032"; ctx.beginPath(); ctx.arc(16, 18, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#3f9444"; ctx.beginPath();
      ctx.arc(10, 14, 7, 0, Math.PI * 2); ctx.arc(22, 15, 7, 0, Math.PI * 2); ctx.arc(16, 8, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#5cb860"; ctx.beginPath();
      ctx.arc(12, 10, 3.5, 0, Math.PI * 2); ctx.arc(20, 12, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#1d4a20"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(16, 18, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#c87a3a"; ctx.beginPath();
      ctx.moveTo(6, 30); ctx.lineTo(26, 30); ctx.lineTo(23, 46); ctx.lineTo(9, 46); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#e09a54"; ctx.fillRect(5, 29, 22, 5);                              // rim
      ctx.fillStyle = "#96551e"; ctx.fillRect(9, 42, 14, 4);                              // pot base shade
      ctx.strokeStyle = "#6e3c12"; ctx.lineWidth = 1.5; ctx.strokeRect(5, 29, 22, 5);
    });
    // Storage PC: 32x48 (monitor + keyboard base with vents)
    mk("pod-pc", 32, 48, (ctx) => {
      ctx.fillStyle = "#4a5470"; this.roundRect(ctx, 5, 30, 22, 16, 2); ctx.fill();      // base
      ctx.fillStyle = "#333c54"; ctx.fillRect(7, 40, 18, 4);                               // vent shade
      ctx.fillStyle = "#5f6b8c"; ctx.fillRect(7, 33, 18, 3);                               // key row
      ctx.fillStyle = "#1c2234"; this.roundRect(ctx, 3, 4, 26, 26, 3); ctx.fill();        // monitor
      ctx.fillStyle = "#123258"; ctx.fillRect(6, 7, 20, 18);                               // screen
      ctx.fillStyle = "#49d0e0"; ctx.fillRect(8, 10, 10, 3); ctx.fillRect(8, 15, 14, 3);   // text lines
      ctx.fillStyle = "#8ef0a0"; ctx.fillRect(8, 20, 6, 3);
      ctx.fillStyle = "#f6d76a"; ctx.fillRect(22, 10, 2, 2);                               // blinking cursor
      ctx.strokeStyle = "#0e1220"; ctx.lineWidth = 1.5; this.roundRect(ctx, 3, 4, 26, 26, 3); ctx.stroke();
    });
    // Bench: 48x28 (cushion with sheen + shaded legs)
    mk("pod-bench", 48, 28, (ctx) => {
      ctx.fillStyle = "#d8bc90"; this.roundRect(ctx, 3, 8, 42, 12, 4); ctx.fill();
      ctx.fillStyle = "#ecd4ae"; this.roundRect(ctx, 5, 9, 38, 4, 3); ctx.fill();          // sheen
      ctx.fillStyle = "#b8946a"; ctx.fillRect(5, 16, 38, 4);                                // cushion shade
      ctx.fillStyle = "#8a6a40"; ctx.fillRect(6, 20, 6, 6); ctx.fillRect(36, 20, 6, 6);     // legs
      ctx.fillStyle = "#6a4e2c"; ctx.fillRect(6, 24, 6, 2); ctx.fillRect(36, 24, 6, 2);
      ctx.strokeStyle = "#6e5430"; ctx.lineWidth = 1.5; this.roundRect(ctx, 3, 8, 42, 12, 4); ctx.stroke();
    });
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
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
    if (this.rivalSprite && fx === this.rivalNpcX && fy === this.rivalNpcY) {
      this.triggerRivalEvent();
      return;
    }
    if (this.momSprite && fx === this.momNpcX && fy === this.momNpcY) {
      this.triggerMomEvent();
      return;
    }
    if (this.researcher1Sprite && fx === this.researcher1NpcX && fy === this.researcher1NpcY) {
      this.triggerResearcher1Event();
      return;
    }
    if (this.researcher2Sprite && fx === this.researcher2NpcX && fy === this.researcher2NpcY) {
      this.triggerResearcher2Event();
      return;
    }
    if (this.residentSprite && fx === this.residentNpcX && fy === this.residentNpcY) {
      this.triggerResidentEvent();
      return;
    }
    if (this.labRes1Sprite && fx === this.labRes1X && fy === this.labRes1Y) {
      this.triggerLabRes1Event();
      return;
    }
    if (this.labRes2Sprite && fx === this.labRes2X && fy === this.labRes2Y) {
      this.triggerLabRes2Event();
      return;
    }
  }

  // ---- Home interiors (player / rival) ----
  private placeHomeDecor(isPlayer: boolean): void {
    const ts = this.tileSize;
    this.genPodTextures();     // reuse plant
    this.genHomeTextures();

    // Warm wood floor overlay (rows 1-6, cols 1-8) + rug + planks.
    const fo = this.add.graphics().setDepth(1);
    fo.fillStyle(0xe0c79a, 1);
    fo.fillRect(ts, ts, 8 * ts, 6 * ts);
    fo.fillStyle(0xd6ba86, 1);                 // plank seams
    for (let y = 1; y < 7; y++) fo.fillRect(ts, y * ts + ts - 2, 8 * ts, 2);
    // rug (center)
    fo.fillStyle(isPlayer ? 0x6a8ad0 : 0xd06a6a, 0.85);
    fo.fillRect(4 * ts + 6, 3 * ts + 6, 3 * ts - 12, 2 * ts - 12);
    fo.fillStyle(0xffffff, 0.18);
    fo.fillRect(4 * ts + 12, 3 * ts + 12, 3 * ts - 24, 2 * ts - 24);

    // Furniture: kitchen counter (cols 1-3 row1), TV (cols 4-5 row1),
    // table+chairs (cols 5-6 rows 3-4), bed (col1 rows 4-5), plant (col8 row1).
    this.add.image(2 * ts, Math.round(1.6 * ts), "home-kitchen").setDepth(6);
    this.add.image(Math.round(4.5 * ts), Math.round(1.5 * ts), "home-tv").setDepth(6);
    this.add.image(Math.round(5.5 * ts), Math.round(3.9 * ts), "home-table").setDepth(6);
    this.add.image(1 * ts + ts / 2, Math.round(4.9 * ts), "home-bed").setDepth(6);
    this.add.image(8 * ts + ts / 2, 1 * ts + ts / 2 - 4, "pod-plant").setDepth(6);
  }

  private genHomeTextures(): void {
    const mk = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
      if (this.textures.exists(key)) return;
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false; draw(ctx);
      this.textures.addCanvas(key, c);
    };
    // Kitchen counter 96x36
    mk("home-kitchen", 96, 36, (ctx) => {
      ctx.fillStyle = "#e6ebf0"; this.roundRect(ctx, 2, 6, 92, 12, 3); ctx.fill();   // countertop
      ctx.fillStyle = "#c3ccd8"; ctx.fillRect(2, 16, 92, 16);
      ctx.fillStyle = "#a9b4c4"; ctx.fillRect(2, 28, 92, 4);
      ctx.fillStyle = "#8b97a8"; ctx.fillRect(28, 18, 2, 12); ctx.fillRect(60, 18, 2, 12); // seams
      // sink + faucet
      ctx.fillStyle = "#9fb0c4"; this.roundRect(ctx, 10, 8, 20, 8, 2); ctx.fill();
      ctx.fillStyle = "#5f6b80"; ctx.fillRect(19, 3, 2, 6); ctx.fillRect(19, 3, 6, 2);
      // stove burners
      ctx.fillStyle = "#3a4252"; ctx.beginPath(); ctx.arc(50, 12, 4, 0, Math.PI*2); ctx.arc(64, 12, 4, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = "#7a8698"; ctx.lineWidth = 2; this.roundRect(ctx, 2, 6, 92, 26, 3); ctx.stroke();
    });
    // TV / monitor stand 48x40
    mk("home-tv", 48, 40, (ctx) => {
      ctx.fillStyle = "#20242c"; this.roundRect(ctx, 2, 2, 44, 26, 3); ctx.fill();
      ctx.fillStyle = "#3a6db0"; ctx.fillRect(5, 5, 38, 20);
      ctx.fillStyle = "#5f93d8"; ctx.fillRect(7, 7, 16, 8);
      ctx.fillStyle = "#8ef0a0"; ctx.fillRect(7, 18, 10, 3);
      ctx.strokeStyle = "#0e1220"; ctx.lineWidth = 2; this.roundRect(ctx, 2, 2, 44, 26, 3); ctx.stroke();
      ctx.fillStyle = "#8a6a44"; ctx.fillRect(10, 28, 28, 10);      // stand
      ctx.fillStyle = "#6e5030"; ctx.fillRect(10, 34, 28, 4);
    });
    // Round table + 2 chairs 64x64
    mk("home-table", 64, 64, (ctx) => {
      // chairs
      ctx.fillStyle = "#b07840"; this.roundRect(ctx, 6, 24, 12, 14, 3); ctx.fill();
      this.roundRect(ctx, 46, 24, 12, 14, 3); ctx.fill();
      ctx.fillStyle = "#8a5a28"; ctx.fillRect(6, 34, 12, 4); ctx.fillRect(46, 34, 12, 4);
      // table top
      ctx.fillStyle = "#d8b070"; ctx.beginPath(); ctx.ellipse(32, 30, 22, 14, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#eecb8c"; ctx.beginPath(); ctx.ellipse(32, 27, 20, 11, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#a87c40"; ctx.fillRect(30, 40, 4, 16);      // leg
      ctx.fillStyle = "#8a5a28"; ctx.fillRect(24, 56, 16, 4);
      ctx.strokeStyle = "#7a5222"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(32, 30, 22, 14, 0, 0, Math.PI*2); ctx.stroke();
      // cup on table
      ctx.fillStyle = "#e86a8a"; this.roundRect(ctx, 28, 22, 8, 8, 2); ctx.fill();
    });
    // Bed 40x64 (headboard top)
    mk("home-bed", 40, 64, (ctx) => {
      ctx.fillStyle = "#8a6a44"; this.roundRect(ctx, 2, 2, 36, 10, 3); ctx.fill();        // headboard
      ctx.fillStyle = "#e9edf2"; this.roundRect(ctx, 4, 10, 32, 20, 3); ctx.fill();       // pillow area
      ctx.fillStyle = "#5f8ad0"; this.roundRect(ctx, 4, 24, 32, 36, 4); ctx.fill();       // blanket
      ctx.fillStyle = "#7aa4e4"; ctx.fillRect(4, 24, 32, 5);                                // fold
      ctx.fillStyle = "#ffffff"; this.roundRect(ctx, 8, 13, 24, 10, 3); ctx.fill();        // pillow
      ctx.strokeStyle = "#3a5a90"; ctx.lineWidth = 2; this.roundRect(ctx, 2, 10, 36, 50, 4); ctx.stroke();
    });
  }

  private placeMomNpc(): void {
    if (!this.textures.exists("npc-mom")) {
      const c = document.createElement("canvas"); c.width = 32; c.height = 32;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      // teal dress
      ctx.fillStyle = "#3aa088"; ctx.fillRect(6, 14, 20, 18);
      ctx.fillStyle = "#2e8874"; ctx.fillRect(6, 26, 20, 6);
      ctx.fillStyle = "#f0e0d0"; ctx.fillRect(13, 16, 6, 4);   // collar
      // head
      ctx.fillStyle = "#f0d8b8"; ctx.beginPath(); ctx.arc(16, 11, 8, 0, Math.PI*2); ctx.fill();
      // brown hair (bun)
      ctx.fillStyle = "#8a5a34"; ctx.fillRect(8, 3, 16, 7); ctx.fillRect(7, 6, 3, 6); ctx.fillRect(22, 6, 3, 6);
      ctx.beginPath(); ctx.arc(16, 3, 4, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#222"; ctx.fillRect(12, 10, 2, 2); ctx.fillRect(18, 10, 2, 2);
      ctx.strokeStyle = "#cc7766"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(16, 14, 3, 0.1*Math.PI, 0.9*Math.PI); ctx.stroke();
      this.textures.addCanvas("npc-mom", c);
    }
    this.momSprite = this.add.image(
      this.momNpcX * this.tileSize + this.tileSize / 2,
      this.momNpcY * this.tileSize + this.tileSize / 2,
      this.npcTex("cast-char5-down", "npc-mom")
    ).setDepth(9);
  }

  private triggerMomEvent(): void {
    const isPlayerHome = this.currentMapKey === "player_home";
    if (isPlayerHome) {
      this.showDialog([
        "おかえり！ 元気にしてた？",
        "アルモンと 一緒なら 安心ね。",
        "困ったら いつでも 帰ってきなさい。\nゆっくり 休んでいってね！",
      ]);
    } else {
      this.showDialog([
        "あら、いらっしゃい。",
        "うちの子なら 出かけちゃったわよ。\nまた 勝負したいって 言ってたわ。",
      ]);
    }
  }

  // ---- Researcher NPCs (Medical Center) — talk only ----
  private placeMedicalNpcs(): void {
    this.researcher1Sprite = this.add.image(
      this.researcher1NpcX * this.tileSize + this.tileSize / 2,
      this.researcher1NpcY * this.tileSize + this.tileSize / 2,
      this.npcTex("cast-char4-down", "npc-kinoshita")
    ).setDepth(9);
    this.researcher2Sprite = this.add.image(
      this.researcher2NpcX * this.tileSize + this.tileSize / 2,
      this.researcher2NpcY * this.tileSize + this.tileSize / 2,
      this.npcTex("cast-char8-down", "npc-kinoshita")
    ).setDepth(9);
  }

  private triggerResearcher1Event(): void {
    this.showDialog([
      "ようこそ メディカルセンターへ。",
      "ここでは アルモンの けんこうを\n研究しているんだ。",
      "ケガをした アルモンは リカバリーポッドで\n手当てしてもらえるよ。",
    ]);
  }

  private triggerResearcher2Event(): void {
    this.showDialog([
      "わたしは 月面の アルモンの 生態を\n調べているの。",
      "しんかする アルモンも いるのよ。\n育てるのが 楽しみね！",
    ]);
  }

  // ---- Resident NPC (house interiors) — talk only ----
  private placeResidentNpc(): void {
    const cast: Record<string, string> = {
      house_1: "cast-char2-down", house_2: "cast-char7-down",
      house_3: "cast-char4-down", house_4: "cast-char8-down",
    };
    this.residentSprite = this.add.image(
      this.residentNpcX * this.tileSize + this.tileSize / 2,
      this.residentNpcY * this.tileSize + this.tileSize / 2,
      this.npcTex(cast[this.currentMapKey] ?? "cast-char2-down", "npc-mom")
    ).setDepth(9);
  }

  private triggerResidentEvent(): void {
    const lines: Record<string, string[]> = {
      house_1: [
        "やあ、クレーターシティへ ようこそ！",
        "この街は アルモンたちと 一緒に\n暮らしているんだ。",
        "ジムの リーダーは とても 強いぞ。\n挑むなら 気をつけてな！",
      ],
      house_2: [
        "あら、こんにちは。",
        "月面の 暮らしにも すっかり\n慣れちゃったわ。",
        "メディカルセンターの 人たちは\nとても 親切なのよ。",
      ],
      house_3: [
        "この街は 静かの海に あるんだ。",
        "アポロ11号が 人類で はじめて\n降り立った 場所なんだよ。",
      ],
      house_4: [
        "農園ドームでは 月で 食べものを\n育てているの。",
        "水も 空気も 自分たちで つくる。\n月で 暮らすって そういうことね。",
      ],
    };
    this.showDialog(lines[this.currentMapKey] ?? lines.house_1);
  }

  // ---- Moonbase (博士の研究所) equipment fit-out ----
  private placeMoonbaseDecor(): void {
    const ts = this.tileSize;
    this.genMoonbaseTextures();
    // Cool tech floor overlay across the main hall (x3-20, y3-15) + central corridor.
    const fo = this.add.graphics().setDepth(1);
    fo.fillStyle(0xdfe6ee, 1); fo.fillRect(3 * ts, 3 * ts, 17 * ts, 13 * ts);
    fo.fillStyle(0xccd5df, 1);                                   // panel seams
    for (let x = 3; x <= 20; x += 2) fo.fillRect(x * ts, 3 * ts, 2, 13 * ts);
    for (let y = 3; y <= 15; y += 2) fo.fillRect(3 * ts, y * ts, 17 * ts, 2);
    fo.fillStyle(0xdfe6ee, 1); fo.fillRect(11 * ts, 16 * ts, 2 * ts, 11 * ts);   // corridor
    // glowing emblem ring under the central holo-projector
    const cx = 12 * ts, cy = Math.round(9.7 * ts);
    fo.fillStyle(0x8fc0ea, 0.45); fo.fillCircle(cx, cy, 52);
    fo.fillStyle(0xbfe4f7, 0.4); fo.fillCircle(cx, cy, 34);
    fo.lineStyle(2, 0x6fb0e0, 0.6); fo.strokeCircle(cx, cy, 52);

    // Equipment sprites (sit on the non-walkable equipment tiles).
    this.add.image(12 * ts, Math.round(9.2 * ts), "mb-holo").setDepth(6);      // centerpiece
    this.add.image(Math.round(6.5 * ts), Math.round(13.4 * ts), "mb-console").setDepth(6);   // bottom-left cluster
    this.add.image(Math.round(16.6 * ts), Math.round(13.3 * ts), "mb-tank").setDepth(6);     // bottom-right cluster
    this.add.image(Math.round(17.7 * ts), Math.round(13.3 * ts), "mb-tank").setDepth(6);
    this.add.image(Math.round(4.5 * ts), Math.round(20.4 * ts), "mb-console-s").setDepth(6); // lower-left room
    this.add.image(Math.round(17.5 * ts), Math.round(20.3 * ts), "mb-server").setDepth(6);   // lower-right room
    this.add.image(Math.round(19.5 * ts), Math.round(21.4 * ts), "mb-console-s").setDepth(6);
  }

  private genMoonbaseTextures(): void {
    const mk = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
      if (this.textures.exists(key)) return;
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false; draw(ctx);
      this.textures.addCanvas(key, c);
    };
    // Central holo-projector 128x104: metal base + cyan beam + moon hologram
    mk("mb-holo", 128, 104, (ctx) => {
      ctx.fillStyle = "#4a5566"; this.roundRect(ctx, 34, 84, 60, 16, 5); ctx.fill();       // base
      ctx.fillStyle = "#6b7789"; this.roundRect(ctx, 40, 80, 48, 8, 3); ctx.fill();
      ctx.fillStyle = "#3a4454"; ctx.fillRect(46, 88, 36, 4);
      // projection beam (cone)
      const g = ctx.createLinearGradient(0, 30, 0, 84);
      g.addColorStop(0, "rgba(120,220,255,0.30)"); g.addColorStop(1, "rgba(120,220,255,0.02)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(52, 82); ctx.lineTo(76, 82); ctx.lineTo(96, 34); ctx.lineTo(32, 34); ctx.closePath(); ctx.fill();
      // moon hologram sphere
      const mg = ctx.createRadialGradient(58, 40, 4, 64, 44, 24);
      mg.addColorStop(0, "#eaf6ff"); mg.addColorStop(1, "#7fb8e6");
      ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(64, 44, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(90,150,200,0.55)";                                              // craters
      for (const [dx, dy, r] of [[-8, -6, 4], [6, 2, 5], [-2, 8, 3], [10, -8, 2]] as [number, number, number][]) { ctx.beginPath(); ctx.arc(64 + dx, 44 + dy, r, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = "rgba(150,220,255,0.7)"; ctx.lineWidth = 1.5;                        // orbit ring
      ctx.beginPath(); ctx.ellipse(64, 44, 30, 10, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#bff0ff"; ctx.beginPath(); ctx.arc(94, 44, 2.5, 0, Math.PI * 2); ctx.fill();
    });
    // Almon specimen tank 48x92: glass tube + liquid + specimen + bubbles
    mk("mb-tank", 48, 92, (ctx) => {
      ctx.fillStyle = "#3a4454"; this.roundRect(ctx, 6, 82, 36, 10, 4); ctx.fill();          // base
      ctx.fillStyle = "#525d70"; ctx.fillRect(10, 8, 28, 6);                                  // top cap
      ctx.fillStyle = "#6b7789"; ctx.fillRect(12, 4, 24, 5);
      const lg = ctx.createLinearGradient(0, 14, 0, 82);                                      // liquid
      lg.addColorStop(0, "#7fe0dc"); lg.addColorStop(1, "#3aa6c8");
      ctx.fillStyle = lg; this.roundRect(ctx, 10, 14, 28, 68, 8); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(13, 18, 4, 60);                  // glass sheen
      // specimen silhouette (little almon)
      ctx.fillStyle = "rgba(30,60,80,0.6)"; ctx.beginPath(); ctx.arc(24, 50, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(20, 34, 3, 10); ctx.fillRect(26, 34, 3, 10);                               // ears
      ctx.fillStyle = "rgba(255,255,255,0.7)";                                                // bubbles
      for (const [bx, by, r] of [[18, 60, 2], [30, 44, 1.5], [22, 30, 1.5], [28, 66, 2]] as [number, number, number][]) { ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = "#8fb4cc"; ctx.lineWidth = 2; this.roundRect(ctx, 10, 14, 28, 68, 8); ctx.stroke();
    });
    // Research console 76x64: desk + angled monitor with data
    mk("mb-console", 76, 64, (ctx) => {
      ctx.fillStyle = "#4a5566"; this.roundRect(ctx, 6, 30, 64, 30, 4); ctx.fill();           // desk
      ctx.fillStyle = "#5c6879"; ctx.fillRect(8, 32, 60, 4);
      ctx.fillStyle = "#20304a"; this.roundRect(ctx, 12, 6, 52, 28, 4); ctx.fill();           // monitor
      ctx.fillStyle = "#0e2340"; ctx.fillRect(15, 9, 46, 22);
      ctx.strokeStyle = "#4fd0e0"; ctx.lineWidth = 1;                                          // data lines
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(18, 13 + i * 5); ctx.lineTo(18 + (10 + i * 7 % 30), 13 + i * 5); ctx.stroke(); }
      ctx.fillStyle = "#8effa0"; ctx.fillRect(52, 12, 6, 4);
      ctx.fillStyle = "#2a3a52"; ctx.fillRect(20, 40, 36, 10);                                 // keyboard
      ctx.fillStyle = "#6fb0e0"; for (let i = 0; i < 6; i++) ctx.fillRect(22 + i * 6, 42, 4, 3);
    });
    // Small terminal 40x48
    mk("mb-console-s", 40, 48, (ctx) => {
      ctx.fillStyle = "#4a5566"; this.roundRect(ctx, 6, 26, 28, 20, 3); ctx.fill();
      ctx.fillStyle = "#20304a"; this.roundRect(ctx, 8, 6, 24, 22, 3); ctx.fill();
      ctx.fillStyle = "#123"; ctx.fillRect(10, 9, 20, 16);
      ctx.fillStyle = "#4fd0e0"; ctx.fillRect(12, 12, 12, 2); ctx.fillRect(12, 16, 8, 2);
      ctx.fillStyle = "#ffd86f"; ctx.fillRect(24, 20, 4, 3);
    });
    // Server rack 48x66: blinking LEDs
    mk("mb-server", 48, 66, (ctx) => {
      ctx.fillStyle = "#2f3846"; this.roundRect(ctx, 6, 4, 36, 58, 4); ctx.fill();
      ctx.fillStyle = "#3c4757"; ctx.fillRect(9, 7, 30, 54);
      for (let r = 0; r < 6; r++) {
        ctx.fillStyle = "#141c28"; ctx.fillRect(11, 10 + r * 8, 26, 6);
        const cols = ["#8effa0", "#4fd0e0", "#ffd86f", "#ff8f8f"];
        for (let i = 0; i < 3; i++) { ctx.fillStyle = cols[(r + i) % 4]; ctx.fillRect(13 + i * 5, 12 + r * 8, 3, 2); }
      }
      ctx.fillStyle = "#20283440"; ctx.fillRect(6, 60, 36, 3);
    });
  }

  // ---- Lab researcher NPCs (Moonbase / 博士の研究所) — talk only ----
  private placeLabNpcs(): void {
    this.labRes1Sprite = this.add.image(
      this.labRes1X * this.tileSize + this.tileSize / 2,
      this.labRes1Y * this.tileSize + this.tileSize / 2,
      this.npcTex("cast-char4-down", "npc-kinoshita")
    ).setDepth(9);
    this.labRes2Sprite = this.add.image(
      this.labRes2X * this.tileSize + this.tileSize / 2,
      this.labRes2Y * this.tileSize + this.tileSize / 2,
      this.npcTex("cast-char8-down", "npc-kinoshita")
    ).setDepth(9);
  }

  private triggerLabRes1Event(): void {
    this.showDialog([
      "ぼくは アルモンの 生態を\n記録している 研究員さ。",
      "ここは ムーンベース——\n月面開発プロジェクトの 拠点だよ。",
      "きみの 冒険の データも\n大事な 研究資料に なるんだ。",
    ]);
  }

  private triggerLabRes2Event(): void {
    this.showDialog([
      "博士は おおらかな 人でしょう？",
      "でも アルモン研究にかけては\n月いちの 天才なのよ。",
      "困ったら 博士に 相談してみてね。",
    ]);
  }

  // ---- Rival NPC (Moon Town) ----
  private placeRivalNpc(): void {
    if (!this.textures.exists("npc-rival")) {
      const c = document.createElement("canvas");
      c.width = 32; c.height = 32;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      // Orange jacket body
      ctx.fillStyle = "#e07030";
      ctx.fillRect(6, 14, 20, 18);
      // Jacket zipper + collar
      ctx.fillStyle = "#f0e8e0";
      ctx.fillRect(15, 16, 2, 12);
      ctx.fillStyle = "#c05820";
      ctx.fillRect(6, 14, 20, 3);
      // Head
      ctx.fillStyle = "#f0d8b8";
      ctx.beginPath(); ctx.arc(16, 11, 8, 0, Math.PI * 2); ctx.fill();
      // Spiky red hair
      ctx.fillStyle = "#c83820";
      ctx.fillRect(8, 2, 16, 6);
      ctx.beginPath();
      ctx.moveTo(7, 8); ctx.lineTo(10, 1); ctx.lineTo(13, 6);
      ctx.lineTo(16, 0); ctx.lineTo(19, 6); ctx.lineTo(22, 1); ctx.lineTo(25, 8);
      ctx.closePath(); ctx.fill();
      // Eyes (confident)
      ctx.fillStyle = "#222";
      ctx.fillRect(11, 10, 3, 2);
      ctx.fillRect(18, 10, 3, 2);
      // Smirk
      ctx.strokeStyle = "#aa7766";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(13, 15); ctx.lineTo(19, 14); ctx.stroke();
      this.textures.addCanvas("npc-rival", c);
    }

    this.rivalSprite = this.add.image(
      this.rivalNpcX * this.tileSize + this.tileSize / 2,
      this.rivalNpcY * this.tileSize + this.tileSize / 2,
      this.npcTex("cast-eezen-down", "npc-rival")
    ).setDepth(9);
  }

  private triggerRivalEvent(): void {
    const hasStarter = this.playerState && this.playerState.party.length > 0;
    if (hasStarter) {
      this.showDialog([
        "よう！ もうアルモンを もらったのか。",
        "オレは 砂場で とっくに\nきたえてるぜ。",
        "そのうち しょうぶだ！\nまけるなよ！",
      ]);
    } else {
      this.showDialog([
        "よう！ おまえも キノシタ博士に\n呼ばれたのか？",
        "ムーンベースの 中に いるぜ。\n早く 行ってみろよ！",
      ]);
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

    // Clerk stands one tile behind the counter (talks across it).
    this.shopkeeperSprite = this.add.image(
      this.shopkeeperNpcX * this.tileSize + this.tileSize / 2,
      (this.shopkeeperNpcY - 1) * this.tileSize + this.tileSize / 2,
      this.npcTex("cast-char9-down", "npc-shopkeeper")
    ).setDepth(7);
  }

  // Poke-Mart-style interior decorations for the planet shop.
  private placePlanetShopDecor(): void {
    const ts = this.tileSize;
    this.genPodTextures();      // reuse plant
    this.genShopTextures();

    // Cool blue-teal floor overlay (rows 1-6, cols 1-8) + checker + door mat.
    const fo = this.add.graphics().setDepth(1);
    fo.fillStyle(0xd7e4ea, 1);
    fo.fillRect(ts, ts, 8 * ts, 6 * ts);
    fo.fillStyle(0xc4d6df, 0.6);
    for (let y = ts; y < 7 * ts; y += 16) {
      for (let x = ts; x < 9 * ts; x += 16) {
        if (((x / 16) + (y / 16)) % 2 === 0) fo.fillRect(x, y, 16, 16);
      }
    }
    fo.fillStyle(0x9fc2d2, 1);                 // door mat
    fo.fillRect(4 * ts + 4, 6 * ts + 8, 2 * ts - 8, ts - 12);
    fo.fillStyle(0xbcd8e4, 1);
    fo.fillRect(4 * ts + 8, 6 * ts + 12, 2 * ts - 16, ts - 20);

    // Counter (left, cols 1-3 row 2) + goods shelves (cols 5-8, rows 2 & 4) + plants.
    this.add.image(2.5 * ts, Math.round(2.55 * ts), "shop-counter").setDepth(8);
    this.add.image(7 * ts, Math.round(2.35 * ts), "shop-shelf").setDepth(6);
    this.add.image(7 * ts, Math.round(4.35 * ts), "shop-shelf").setDepth(6);
    this.add.image(1 * ts + ts / 2, 6 * ts + ts / 2 - 6, "pod-plant").setDepth(6);
    this.add.image(8 * ts + ts / 2, 6 * ts + ts / 2 - 6, "pod-plant").setDepth(6);
  }

  private genShopTextures(): void {
    const mk = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
      if (this.textures.exists(key)) return;
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      draw(ctx);
      this.textures.addCanvas(key, c);
    };
    // Mini moon capsule for shelf goods
    const cap = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => {
      ctx.fillStyle = "#e9ebf2"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI); ctx.fill();
      ctx.fillStyle = "#2c3a6e"; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "#d8ac38"; ctx.fillRect(cx - r, cy - 1, r * 2, 2);
      ctx.strokeStyle = "#141a2e"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    };
    // Tech counter: 96x40 (white top, blue front, register)
    mk("shop-counter", 96, 40, (ctx) => {
      ctx.fillStyle = "#eef2f6"; this.roundRect(ctx, 3, 4, 90, 13, 6); ctx.fill();
      ctx.fillStyle = "#fbfdff"; this.roundRect(ctx, 5, 5, 86, 5, 4); ctx.fill();
      ctx.fillStyle = "#4a78b8"; ctx.fillRect(5, 16, 86, 14);
      ctx.fillStyle = "#39619a"; ctx.fillRect(5, 25, 86, 5);
      ctx.fillStyle = "#2a4a78"; ctx.fillRect(5, 30, 86, 6);
      ctx.fillStyle = "#5f8cc8"; ctx.fillRect(32, 17, 2, 12); ctx.fillRect(62, 17, 2, 12);   // seams
      // register
      ctx.fillStyle = "#2a3248"; this.roundRect(ctx, 66, 0, 22, 12, 2); ctx.fill();
      ctx.fillStyle = "#49d0e0"; ctx.fillRect(69, 2, 16, 5);
      ctx.strokeStyle = "#24406a"; ctx.lineWidth = 2; this.roundRect(ctx, 3, 4, 90, 32, 6); ctx.stroke();
    });
    // Goods shelf: 128x52 (two boards of items incl. moon capsules)
    mk("shop-shelf", 128, 52, (ctx) => {
      ctx.fillStyle = "#c8d2dc"; this.roundRect(ctx, 3, 2, 122, 46, 4); ctx.fill();     // frame
      ctx.fillStyle = "#aab6c4"; ctx.fillRect(3, 44, 122, 6);                             // base
      ctx.strokeStyle = "#5a6a80"; ctx.lineWidth = 2; this.roundRect(ctx, 3, 2, 122, 46, 4); ctx.stroke();
      // two shelf boards with shadow
      for (const by of [20, 40]) {
        ctx.fillStyle = "#8c98a8"; ctx.fillRect(6, by, 116, 4);
        ctx.fillStyle = "#6d7888"; ctx.fillRect(6, by + 3, 116, 2);
      }
      // goods row 1: bottles (repair gels)
      const bottle = (x: number, col: string) => {
        ctx.fillStyle = col; this.roundRect(ctx, x, 8, 8, 12, 2); ctx.fill();
        ctx.fillStyle = "#f4f7fb"; ctx.fillRect(x + 2, 6, 4, 3);
        ctx.strokeStyle = "#243040"; ctx.lineWidth = 1; this.roundRect(ctx, x, 8, 8, 12, 2); ctx.stroke();
      };
      bottle(12, "#58c0e8"); bottle(26, "#58c0e8"); bottle(40, "#e86a8a"); bottle(54, "#e86a8a");
      bottle(70, "#8ee08a"); bottle(84, "#8ee08a"); bottle(98, "#f0c04a"); bottle(112, "#f0c04a");
      // goods row 2: moon capsules
      for (let i = 0; i < 6; i++) cap(ctx, 16 + i * 19, 33, 6);
    });
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

    // Compact panel sized to content (no dead space below the list).
    const px = 20, py = 24;
    const pw = W - 40;
    const itemH = 40;
    const itemStartY = py + 48;
    const descY = itemStartY + totalOptions * itemH + 10;
    const moneyY = descY + 52;
    const hintY = moneyY + 30;
    const ph = hintY + 20 - py;
    const panel = this.add.graphics().setScrollFactor(0).setDepth(201);
    panel.fillStyle(0x0a1628, 0.96);
    panel.fillRoundedRect(this.uiX(px), this.uiY(py), this.uiS(pw), this.uiS(ph), this.uiS(12));
    panel.lineStyle(2, 0xcc8833);
    panel.strokeRoundedRect(this.uiX(px), this.uiY(py), this.uiS(pw), this.uiS(ph), this.uiS(12));
    this.shopElements.push(panel);

    // Title
    this.shopElements.push(
      this.add.text(this.uiX(W / 2), this.uiY(py + 24), "★ プラネットショップ", {
        fontSize: FS(22), color: "#ffcc44", fontFamily: F, fontStyle: "bold", ...STK,
      }).setScrollFactor(0).setDepth(202).setOrigin(0.5)
    );

    // Items list
    for (let i = 0; i < totalOptions; i++) {
      const iy = itemStartY + i * itemH;
      const isSelected = i === this.shopSelectedIndex;
      const isQuit = i >= inventory.length;

      // Selection highlight
      if (isSelected) {
        const bg = this.add.graphics().setScrollFactor(0).setDepth(202);
        bg.fillStyle(0x1a3366, 0.9);
        bg.fillRoundedRect(this.uiX(px + 6), this.uiY(iy + 2), this.uiS(pw - 12), this.uiS(itemH - 4), this.uiS(6));
        this.shopElements.push(bg);
      }

      // Arrow
      if (isSelected) {
        this.shopElements.push(
          this.add.text(this.uiX(px + 12), this.uiY(iy + itemH / 2), "▶", {
            fontSize: FS(15), color: "#ffcc44", fontFamily: F, ...STK,
          }).setScrollFactor(0).setDepth(203).setOrigin(0, 0.5)
        );
      }

      if (isQuit) {
        this.shopElements.push(
          this.add.text(this.uiX(px + 34), this.uiY(iy + itemH / 2), "やめる", {
            fontSize: FS(19), color: isSelected ? "#ffffff" : "#8899aa", fontFamily: F, ...STK,
          }).setScrollFactor(0).setDepth(203).setOrigin(0, 0.5)
        );
      } else {
        const item = inventory[i];
        // Capsule icon for capsule items
        let nameX = px + 34;
        if (item.id.includes("capsule") && this.textures.exists("item-moon-capsule")) {
          const icon = this.add.image(this.uiX(px + 46), this.uiY(iy + itemH / 2), "item-moon-capsule")
            .setScrollFactor(0).setDepth(203);
          icon.setScale(this.uiS(26) / icon.width);
          if (item.id === "star_capsule") icon.setTint(0xffe28a);   // star variant: gold tint
          this.shopElements.push(icon);
          nameX = px + 64;
        }
        // Name
        this.shopElements.push(
          this.add.text(this.uiX(nameX), this.uiY(iy + itemH / 2), item.name, {
            fontSize: FS(19), color: isSelected ? "#ffffff" : "#8899aa", fontFamily: F, ...STK,
          }).setScrollFactor(0).setDepth(203).setOrigin(0, 0.5)
        );
        // Owned count
        const owned = this.playerState?.items.find(it => it.id === item.id)?.count || 0;
        if (owned > 0) {
          this.shopElements.push(
            this.add.text(this.uiX(px + pw - 92), this.uiY(iy + itemH / 2), `×${owned}`, {
              fontSize: FS(14), color: "#88aacc", fontFamily: F, ...STK,
            }).setScrollFactor(0).setDepth(203).setOrigin(1, 0.5)
          );
        }
        // Price
        this.shopElements.push(
          this.add.text(this.uiX(px + pw - 14), this.uiY(iy + itemH / 2), `¥${item.price}`, {
            fontSize: FS(17), color: isSelected ? "#aaffaa" : "#668866", fontFamily: F, ...STK,
          }).setScrollFactor(0).setDepth(203).setOrigin(1, 0.5)
        );
      }
    }

    // Separator
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
      this.add.text(this.uiX(px + 14), this.uiY(descY + 10), descStr, {
        fontSize: FS(16), color: "#ccddee", fontFamily: F, ...STK,
        wordWrap: { width: this.uiS(pw - 28) }, lineSpacing: this.uiS(4),
      }).setScrollFactor(0).setDepth(203)
    );

    // Money
    const money = this.playerState?.money || 0;
    this.shopElements.push(
      this.add.text(this.uiX(px + pw - 14), this.uiY(moneyY), `しょじきん: ${money}円`, {
        fontSize: FS(17), color: "#ffdd88", fontFamily: F, ...STK,
      }).setScrollFactor(0).setDepth(203).setOrigin(1, 0)
    );

    // Status message (purchase result)
    if (this.shopMessage) {
      const msgColor = this.shopMessage.includes("たりない") ? "#ff8888" : "#88ff88";
      this.shopElements.push(
        this.add.text(this.uiX(px + 14), this.uiY(moneyY), this.shopMessage, {
          fontSize: FS(16), color: msgColor, fontFamily: F, ...STK,
        }).setScrollFactor(0).setDepth(203)
      );
    }

    // Controls hint
    this.shopElements.push(
      this.add.text(this.uiX(W / 2), this.uiY(hintY), "A:かう  B:やめる", {
        fontSize: FS(13), color: "#8899aa", fontFamily: F,
      }).setScrollFactor(0).setDepth(203).setOrigin(0.5)
    );

    this.applyTextResolution(this.shopElements);
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
    const boxH = 130;
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
    const text = this.add.text(this.uiX(margin + 18), this.uiY(boxY + 20), msg, {
      fontSize: `${this.uiS(24)}px`, color: "#ffffff", fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 4,
      wordWrap: { width: this.uiS(W - margin*2 - 52) }, lineSpacing: this.uiS(8),
    }).setScrollFactor(0).setDepth(301);
    this.dialogElements.push(text);

    // Advance indicator
    if (this.dialogIndex < this.dialogMessages.length - 1 || this.dialogCallback) {
      const indicator = this.add.text(this.uiX(W - margin - 18), this.uiY(boxY + boxH - 22), "▼", {
        fontSize: `${this.uiS(16)}px`, color: "#66aaff", fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(301);
      this.dialogElements.push(indicator);
    }

    // Tap to advance
    const zone = this.add.zone(this.uiX(W/2), this.uiY(boxY + boxH/2), this.uiS(W), this.uiS(boxH))
      .setScrollFactor(0).setDepth(302).setOrigin(0.5).setInteractive();
    zone.on("pointerdown", () => this.advanceDialog());
    this.dialogElements.push(zone);

    this.applyTextResolution(this.dialogElements);
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
