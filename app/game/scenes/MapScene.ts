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
  intro?: boolean; // play the wake-up prologue cutscene
}

export class MapScene extends Phaser.Scene {
  private mapData!: MapData;
  private player!: Phaser.GameObjects.Image;
  private tileSize!: number;
  private isMoving = false;
  private isWarping = false;
  private inCutscene = false;
  private introCutscene = false;
  private moveQueue: Direction | null = null;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private animFrame = 0;
  private animTimer = 0;
  // Sub-second carry for play-time accumulation (ms).
  private playSecAccum = 0;
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
  // Gym-leader gates: leader id -> trainers that must be beaten first.
  private static GYM_LEADER_GATES: Record<string, string[]> = {
    ryuma: ["genki", "kagen"],
  };
  private leaderGateNotified = false;

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

  // Two grandmothers gossiping in front of the north-west exit of Crater City.
  // They block the way to 砂場ルート2 until イーゼン (the cave boss) is beaten.
  private granny1Sprite?: Phaser.GameObjects.Image;
  private granny2Sprite?: Phaser.GameObjects.Image;
  private granny1X = 7; private granny1Y = 2;
  private granny2X = 8; private granny2Y = 2;

  // Farm researcher NPC (farm dome interior) — talk-only
  private farmResSprite?: Phaser.GameObjects.Image;
  private farmResX = 7;
  private farmResY = 4;

  // Meteorite (appears at the Crater City outskirts after the gym is cleared).
  // (meteorX,meteorY) is the TOP-LEFT of a 5x5 footprint; the cracked-open cave
  // entrance sits just below its bottom-centre.
  private meteorSprite?: Phaser.GameObjects.Image;
  private caveEntranceSprite?: Phaser.GameObjects.Image;
  private meteorX = 29;
  private meteorY = 21;
  private static METEOR_SIZE = 6;
  private caveEntranceX = 31;
  private caveEntranceY = 27;
  private lastTrainerDefeated?: string;

  // Moon-capsule field items scattered through the meteorite cave (heal items).
  private caveCapsuleSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private static CAVE_CAPSULES: { flag: string; mapKey: string; x: number; y: number; item: string; itemName: string }[] = [
    { flag: "cave_capsule_1", mapKey: "crater_cave", x: 10, y: 9, item: "hi_repair_gel", itemName: "ハイリペアジェル" },
    { flag: "cave_capsule_2", mapKey: "crater_cave_b1", x: 10, y: 7, item: "full_repair_gel", itemName: "フルリペアジェル" },
  ];

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
  private menuSubScreen: "none" | "party" | "save" | "stub" | "settings" | "restart-confirm" = "none";
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
    this.inCutscene = false;
    this.introCutscene = !!data.intro;
    this.kinoshitaSprite = undefined;
    this.nurseSprite = undefined;
    this.shopkeeperSprite = undefined;
    this.meteorSprite = undefined;
    this.caveEntranceSprite = undefined;
    this.caveCapsuleSprites.clear();
    this.farmResSprite = undefined;
    this.residentSprite = undefined;
    this.granny1Sprite = undefined;
    this.granny2Sprite = undefined;
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
    this.lastTrainerDefeated = data.trainerDefeated;
    if (data.trainerDefeated && this.playerState) {
      if (!this.playerState.defeatedTrainers.includes(data.trainerDefeated)) {
        this.playerState.defeatedTrainers.push(data.trainerDefeated);
      }
    }
  }

  create(): void {
    // Clear any transient touch/gamepad state that could linger across a scene
    // transition (e.g. a D-pad press that never received its touchend during
    // the intro→town warp), which would otherwise block/steal fresh input.
    if (typeof window !== "undefined" && (window as unknown as { __gamepad?: { dpad: string | null; dpadJust: string | null; aJust: boolean; bJust: boolean; menuJust: boolean } }).__gamepad) {
      const gp = (window as unknown as { __gamepad: { dpad: string | null; dpadJust: string | null; aJust: boolean; bJust: boolean; menuJust: boolean } }).__gamepad;
      gp.dpad = null; gp.dpadJust = null; gp.aJust = false; gp.bJust = false; gp.menuJust = false;
    }

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

    // Medical Center interior — research equipment + two researchers to talk to
    if (this.currentMapKey === "medical_center") {
      this.placeMedicalDecor();
      this.placeMedicalNpcs();
    }

    // Gym interior — a lavish battle hall (marble, pillars, banners, braziers)
    if (this.currentMapKey === "gym_1") {
      this.placeGymDecor();
    }

    // Farm dome interior — a researcher tending the plants
    if (this.currentMapKey === "farm_dome") {
      this.placeFarmResearcherNpc();
    }

    // House interiors — cozy home + a resident to talk to
    if (this.currentMapKey.startsWith("house_")) {
      this.placeHomeDecor(false);
      this.placeResidentNpc();
    }

    // Crater City: after the gym is cleared, a meteorite sits at the outskirts.
    if (this.currentMapKey === "crater_city" &&
        !!this.playerState?.defeatedTrainers.includes("ryuma")) {
      this.placeMeteor();
    }

    // Crater City: two grandmothers block the NW exit to 砂場ルート2 until the
    // cave boss イーゼン is beaten; after that the road north opens up.
    if (this.currentMapKey === "crater_city" &&
        !this.playerState?.defeatedTrainers.includes("eezen")) {
      this.placeCraterGrannies();
    }

    // Meteorite cave: scatter the moon-capsule items; award the rival's dropped
    // debris fragment once イーゼン (the deepest boss) has been beaten.
    if (this.currentMapKey.startsWith("crater_cave")) {
      this.placeCaveCapsules();
      if (this.currentMapKey === "crater_cave_b2" && this.lastTrainerDefeated === "eezen") {
        const pk = this.playerState?.pickups || [];
        if (!pk.includes("eezen_debris")) {
          this.time.delayedCall(450, () => this.awardEezenDebris());
        }
      }
    }

    // Gym: right after beating the leader, the ground shakes (meteor impact).
    if (this.currentMapKey === "gym_1" && this.lastTrainerDefeated === "ryuma") {
      const pk = this.playerState?.pickups || [];
      if (!pk.includes("gym1_quake")) {
        this.time.delayedCall(500, () => this.playGymClearCutscene());
      }
    }

    // Prologue: wake-up cutscene in the player's home
    if (this.introCutscene && this.currentMapKey === "player_home") {
      this.playIntroCutscene();
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

      // Use the trainer's hand-drawn NPC sprite (facing their set direction);
      // fall back to the old red-tinted marker only if that texture is missing.
      const owKey = (trainer as TrainerData & { overworldSprite?: string }).overworldSprite;
      const dir = trainer.direction || "down";
      const castKey = owKey ? `cast-${owKey}-${dir}` : "";
      const useCast = !!castKey && this.textures.exists(castKey);
      const sprite = this.add.image(
        trainer.x * this.tileSize + this.tileSize / 2,
        trainer.y * this.tileSize + this.tileSize / 2,
        useCast ? castKey : "player-frame-0"
      ).setDepth(9);
      if (!useCast) sprite.setTint(0xff6644);
      this.trainerSprites.set(trainer.id, sprite);
    }
  }

  private checkTrainerSight(): void {
    if (this.startingBattle || this.isWarping || this.trainerApproaching) return;
    const mapTrainers = this.allTrainers.filter(
      t => t.mapKey === this.currentMapKey
    );

    let leaderBlockedInSight = false;
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
        // Gym-leader gate: block the battle until the required trainers are beaten.
        const gate = MapScene.GYM_LEADER_GATES[trainer.id];
        if (gate && !gate.every(id => this.playerState?.defeatedTrainers.includes(id))) {
          if (!this.leaderGateNotified) {
            this.leaderGateNotified = true;
            this.showDialog([
              "……まだ 早い。",
              "このジムの トレーナー2人を\n倒してから 挑むがいい。",
            ]);
          }
          leaderBlockedInSight = true;
          continue;
        }
        this.beginTrainerApproach(trainer);
        return;
      }
    }
    // Re-arm the leader gate message once the player leaves the leader's sight.
    if (!leaderBlockedInSight) this.leaderGateNotified = false;
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

    // Only roll encounters on "wild" ground: desert sand or cave floor.
    const { layers } = this.mapData;
    const tileId = layers.floor[this.gridY]?.[this.gridX];
    // Sand tiles: 5-12, 14-21 (edges), 32-36 (variants). 80 = cave floor.
    const encounterTiles = [5,6,7,8,9,10,11,12,14,15,16,17,18,19,20,21,32,33,34,35,36,80];
    if (!encounterTiles.includes(tileId)) return;

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
      // Block ONLY entering a wild route with no almon (town/home/base transitions are fine).
      const WILD_MAPS = ["sand_route_1", "sand_route_2"];
      if (WILD_MAPS.includes(warp.targetMap) &&
          (!this.playerState || this.playerState.party.length === 0)) {
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
    if (this.granny1Sprite && x === this.granny1X && y === this.granny1Y) return true;
    if (this.granny2Sprite && x === this.granny2X && y === this.granny2Y) return true;
    if (this.farmResSprite && x === this.farmResX && y === this.farmResY) return true;
    if (this.meteorSprite &&
        x >= this.meteorX && x < this.meteorX + MapScene.METEOR_SIZE &&
        y >= this.meteorY && y < this.meteorY + MapScene.METEOR_SIZE) return true;
    if (this.labRes1Sprite && x === this.labRes1X && y === this.labRes1Y) return true;
    if (this.labRes2Sprite && x === this.labRes2X && y === this.labRes2Y) return true;
    // Uncollected cave capsules block their tile (pick up by facing + A).
    for (const c of MapScene.CAVE_CAPSULES) {
      if (c.mapKey === this.currentMapKey && c.x === x && c.y === y && this.caveCapsuleSprites.has(c.flag)) return true;
    }
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
    // Accumulate play time while on the overworld (persisted on レポート/save,
    // shown on the title screen's つづきから panel).
    if (this.playerState) {
      this.playSecAccum += delta;
      if (this.playSecAccum >= 1000) {
        const secs = Math.floor(this.playSecAccum / 1000);
        this.playerState.playSeconds = (this.playerState.playSeconds || 0) + secs;
        this.playSecAccum -= secs * 1000;
      }
    }

    if (this.isWarping || this.startingBattle || this.trainerApproaching) return;

    // --- Gamepad button reads ---
    const gp = typeof window !== "undefined" ? (window as any).__gamepad : null;
    let gpMenu = false, gpA = false, gpB = false;
    let gpDpadJust: Direction | null = null;
    if (gp) {
      if (gp.menuJust) { gpMenu = true; gp.menuJust = false; }
      if (gp.aJust) { gpA = true; gp.aJust = false; }
      if (gp.bJust) { gpB = true; gp.bJust = false; }
      // Consume the one-shot d-pad tap latch every frame so it never goes stale
      // across a dialog/menu/cutscene; it's applied to movement below.
      if (gp.dpadJust) { gpDpadJust = gp.dpadJust as Direction; gp.dpadJust = null; }
    }
    const kbMenu = this.mKey && Phaser.Input.Keyboard.JustDown(this.mKey);
    const kbEsc = this.escKey && Phaser.Input.Keyboard.JustDown(this.escKey);

    // --- Dialog ---
    if (this.dialogActive) {
      if (gpA) this.advanceDialog();
      return;
    }

    // --- Cutscene: block player control (movement is scripted); dialog above still advances ---
    if (this.inCutscene) return;

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

    // Movement input. A quick d-pad tap is delivered via the one-shot latch
    // (gpDpadJust) so it still moves one tile even if `dpad` was cleared before
    // this frame; a held press falls through to the live-input read below and
    // drives continuous movement.
    const dir = gpDpadJust ?? this.getInputDirection();
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
        fontSize: `${this.uiS(12)}px`, color: "#66aaff", fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 2,
      }).setScrollFactor(0).setDepth(203).setOrigin(0, 0.5);
      const text = this.add.text(this.uiX(px + 32), this.uiY(iy + 16), label, {
        fontSize: `${this.uiS(15)}px`, color: "#ffffff", fontFamily: "'DotGothic16', monospace",
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
      // Settings: A on "はじめからはじめる" opens a confirm
      if (this.menuSubScreen === "settings" && a) { this.showRestartConfirm(); return; }
      // Restart confirm: A wipes the save and starts a brand-new game
      if (this.menuSubScreen === "restart-confirm" && a) { this.doRestartGame(); return; }
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
      case 5: this.showSettingsScreen(); break;
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

      // Row 1: name + Lv (left) and HP numbers (right). Rows 2/3: long HP / EXP
      // bars that span almost the full card width (RSE party-screen style).
      const tx = cx + rightIconSize + Math.round(10 * s);
      const row1Y = cy + Math.round(4 * s);
      this.menuElements.push(
        this.add.text(this.uiX(tx), this.uiY(row1Y), `${data.name}  Lv${mon.level}`, {
          fontSize: fs(12), color: "#ffffff", fontFamily: F, fontStyle: "bold", ...STK2,
        }).setScrollFactor(0).setDepth(204)
      );
      // HP numbers right-aligned on the name row (above the long bar)
      this.menuElements.push(
        this.add.text(this.uiX(cx + rightW - 6), this.uiY(row1Y), `${mon.currentHp}/${mon.maxHp}`, {
          fontSize: fs(10), color: "#ffffff", fontFamily: F, fontStyle: "bold", ...STK2,
        }).setScrollFactor(0).setDepth(204).setOrigin(1, 0)
      );

      const row2Y = cy + Math.round(22 * s);
      const rBarH = Math.max(6, Math.round(7 * s));
      // "HP" label at the left, long bar filling the rest of the row
      this.menuElements.push(
        this.add.text(this.uiX(tx), this.uiY(row2Y), "HP", {
          fontSize: fs(9), color: "#f8a830", fontFamily: F, fontStyle: "bold", ...STK2,
        }).setScrollFactor(0).setDepth(204)
      );
      const hpBx = tx + Math.round(26 * s);
      const hpBarEndX = cx + rightW - 6;
      const hpBarLen = Math.max(20, hpBarEndX - hpBx);
      const hpRatio = mon.currentHp / mon.maxHp;
      const hpG = this.add.graphics().setScrollFactor(0).setDepth(203);
      drawCapsuleBar(hpG, hpBx, row2Y + 2, hpBarLen, rBarH, hpRatio, hpColor(hpRatio));
      this.menuElements.push(hpG);
      // EXP label + bar (third row), same long span
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
      fontSize: `${this.uiS(20)}px`, color: "#66aaff", fontFamily: "'DotGothic16', monospace", fontStyle: "bold", stroke: "#000000", strokeThickness: 3 }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(title);

    const lines = [
      `なまえ:  ${playerName}`,
      `しょじきん: ${money}円`,
      `てもち:  ${party}匹`,
      `たおしたトレーナー: ${badges}人`,
    ];
    lines.forEach((line, i) => {
      const t = this.add.text(this.uiX(60), this.uiY(80 + i * 44), line, {
        fontSize: `${this.uiS(15)}px`, color: "#ccddee", fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(201);
      this.menuElements.push(t);
    });

    const hint = this.add.text(this.uiX(W/2), this.uiY(H - 30), "Bボタンでもどる", {
      fontSize: `${this.uiS(12)}px`, color: "#ffffff", fontFamily: "'DotGothic16', monospace",
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
      fontSize: `${this.uiS(17)}px`, color: "#ffffff", fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
    this.menuElements.push(msg);

    const hint = this.add.text(this.uiX(W/2), this.uiY(H/2 + 30), "Aボタン: はい  /  Bボタン: いいえ", {
      fontSize: `${this.uiS(13)}px`, color: "#88aacc", fontFamily: "'DotGothic16', monospace",
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
      fontSize: `${this.uiS(18)}px`, color: "#44cc88", fontFamily: "'DotGothic16', monospace", fontStyle: "bold", stroke: "#000000", strokeThickness: 3 }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(msg);
    this.applyTextResolution(this.menuElements);

    // Auto-close after 1.2s
    this.menuSubScreen = "stub"; // prevent double-save
    this.time.delayedCall(1200, () => {
      if (this.menuOpen) this.closeMenu();
    });
  }

  // ---- Settings Screen ----
  private showSettingsScreen(): void {
    this.menuSubScreen = "settings";
    this.clearMenuElements();
    const W = this.scale.width, H = this.scale.height;
    const F = "'DotGothic16', monospace";

    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.97); bg.fillRect(this.uiX(0), this.uiY(0), this.uiS(W), this.uiS(H));
    this.menuElements.push(bg);

    this.menuElements.push(
      this.add.text(this.uiX(W/2), this.uiY(40), "せってい", {
        fontSize: `${this.uiS(20)}px`, color: "#66aaff", fontFamily: F, fontStyle: "bold",
        stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(201).setOrigin(0.5)
    );

    // Option row (single option for now)
    const panel = this.add.graphics().setScrollFactor(0).setDepth(201);
    panel.fillStyle(0x1a3366, 0.9);
    panel.fillRoundedRect(this.uiX(W/2 - 170), this.uiY(H/2 - 24), this.uiS(340), this.uiS(48), this.uiS(8));
    panel.lineStyle(2, 0x3366aa);
    panel.strokeRoundedRect(this.uiX(W/2 - 170), this.uiY(H/2 - 24), this.uiS(340), this.uiS(48), this.uiS(8));
    this.menuElements.push(panel);
    this.menuElements.push(
      this.add.text(this.uiX(W/2), this.uiY(H/2), "▶ はじめから はじめる", {
        fontSize: `${this.uiS(16)}px`, color: "#ffffff", fontFamily: F,
        stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(202).setOrigin(0.5)
    );

    this.menuElements.push(
      this.add.text(this.uiX(W/2), this.uiY(H - 30), "Aボタン: えらぶ  /  Bボタン: もどる", {
        fontSize: `${this.uiS(12)}px`, color: "#88aacc", fontFamily: F,
        stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(201).setOrigin(0.5)
    );
    this.applyTextResolution(this.menuElements);
  }

  private showRestartConfirm(): void {
    this.menuSubScreen = "restart-confirm";
    this.clearMenuElements();
    const W = this.scale.width, H = this.scale.height;
    const F = "'DotGothic16', monospace";

    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.97); bg.fillRect(this.uiX(0), this.uiY(0), this.uiS(W), this.uiS(H));
    this.menuElements.push(bg);

    const panel = this.add.graphics().setScrollFactor(0).setDepth(201);
    panel.fillStyle(0x2a1020, 0.95);
    panel.fillRoundedRect(this.uiX(W/2 - 200), this.uiY(H/2 - 90), this.uiS(400), this.uiS(180), this.uiS(12));
    panel.lineStyle(2, 0xcc5566);
    panel.strokeRoundedRect(this.uiX(W/2 - 200), this.uiY(H/2 - 90), this.uiS(400), this.uiS(180), this.uiS(12));
    this.menuElements.push(panel);

    this.menuElements.push(
      this.add.text(this.uiX(W/2), this.uiY(H/2 - 40), "セーブを けして\nはじめから やり直しますか？", {
        fontSize: `${this.uiS(15)}px`, color: "#ffffff", fontFamily: F, align: "center",
        stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(202).setOrigin(0.5)
    );
    this.menuElements.push(
      this.add.text(this.uiX(W/2), this.uiY(H/2 + 40), "Aボタン: はい  /  Bボタン: いいえ", {
        fontSize: `${this.uiS(13)}px`, color: "#ffaaaa", fontFamily: F,
        stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(202).setOrigin(0.5)
    );
    this.applyTextResolution(this.menuElements);
  }

  private doRestartGame(): void {
    // Wipe all saved progress + character setup, then start a brand-new game.
    try {
      localStorage.removeItem("usamon-save-data");
      localStorage.removeItem("usamon-player-setup");
    } catch (e) { /* ignore */ }
    this.menuOpen = false;
    this.menuSubScreen = "none";
    this.clearMenuElements();
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => {
      this.scene.start("SetupScene");
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
      fontSize: `${this.uiS(20)}px`, color: "#66aaff", fontFamily: "'DotGothic16', monospace", fontStyle: "bold", stroke: "#000000", strokeThickness: 3 }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(t);

    const sub = this.add.text(this.uiX(W/2), this.uiY(H/2 + 20), "― じゅんびちゅう ―", {
      fontSize: `${this.uiS(14)}px`, color: "#ffffff", fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(sub);

    const hint = this.add.text(this.uiX(W/2), this.uiY(H - 30), "Bボタンでもどる", {
      fontSize: `${this.uiS(12)}px`, color: "#ffffff", fontFamily: "'DotGothic16', monospace",
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
    // Moon-sand deposit: crater at the south edge of Crater City (23,33)
    if (this.currentMapKey === "crater_city" && fx === 23 && fy === 33) {
      this.tryPickMoonSand();
      return;
    }
    // Moon-capsule field items inside the meteorite cave
    const cap = MapScene.CAVE_CAPSULES.find(
      c => c.mapKey === this.currentMapKey && c.x === fx && c.y === fy && this.caveCapsuleSprites.has(c.flag)
    );
    if (cap) {
      this.tryPickCaveCapsule(cap);
      return;
    }
    // Meteorite investigation (Crater City outskirts): facing any of its tiles
    if (this.meteorSprite &&
        fx >= this.meteorX && fx < this.meteorX + MapScene.METEOR_SIZE &&
        fy >= this.meteorY && fy < this.meteorY + MapScene.METEOR_SIZE) {
      this.triggerMeteorEvent();
      return;
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
    if ((this.granny1Sprite && fx === this.granny1X && fy === this.granny1Y) ||
        (this.granny2Sprite && fx === this.granny2X && fy === this.granny2Y)) {
      this.triggerCraterGrannyEvent();
      return;
    }
    if (this.farmResSprite && fx === this.farmResX && fy === this.farmResY) {
      this.triggerFarmResearcherEvent();
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

  /** One-time pickup: investigate the moon crater to receive つきのすな. */
  private tryPickMoonSand(): void {
    if (!this.playerState) return;
    const flag = "crater_moon_sand";
    this.playerState.pickups = this.playerState.pickups || [];
    if (this.playerState.pickups.includes(flag)) {
      this.showDialog(["クレーターを しらべたが、\nもう なにも なさそうだ。"]);
      return;
    }
    this.playerState.pickups.push(flag);
    const existing = this.playerState.items.find(i => i.id === "moon_sand");
    if (existing) existing.count++;
    else this.playerState.items.push({ id: "moon_sand", count: 1 });
    this.showDialog([
      "クレーターを しらべた。",
      "きらきら 光る「つきのすな」を\nてにいれた！",
    ]);
  }

  // ---- Post-gym meteorite event (Chapter 4) ----
  private genMeteorTexture(): void {
    if (this.textures.exists("meteor-rock")) return;
    const s = 256;
    const c = document.createElement("canvas"); c.width = s; c.height = s;
    const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const cx = s / 2;
    // The rock is a big sphere sunk into the ground: its centre sits low so only
    // the TOP THIRD emerges. Ground/soil line (where the rock disappears) ~0.42s.
    const R = s * 0.40;
    const rockCy = s * 0.68;          // sphere centre (mostly below ground)
    const groundY = s * 0.42;         // where the buried soil mound crests

    // --- scorched impact crater on the ground (wide, dark, radiating) ---
    ctx.fillStyle = "rgba(34,22,16,0.5)";
    ctx.beginPath(); ctx.ellipse(cx, s * 0.72, s * 0.48, s * 0.20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(58,38,26,0.5)";
    ctx.beginPath(); ctx.ellipse(cx, s * 0.70, s * 0.38, s * 0.15, 0, 0, Math.PI * 2); ctx.fill();

    // --- exposed rock crown (only the emerging cap) ---
    const N = 20; const pts: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const rr = R * (0.86 + rnd() * 0.2);
      pts.push([cx + Math.cos(a) * rr, rockCy + Math.sin(a) * rr]);
    }
    const grd = ctx.createRadialGradient(cx - R * 0.3, groundY + R * 0.1, 8, cx, rockCy, R * 1.15);
    grd.addColorStop(0, "#7a675c"); grd.addColorStop(0.5, "#463831"); grd.addColorStop(1, "#221913");
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.fill();
    // surface craters on the exposed cap (kept above the soil line)
    ctx.fillStyle = "#2a211c";
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2, rr = rnd() * R * 0.75;
      const px = cx + Math.cos(a) * rr, py = rockCy + Math.sin(a) * rr;
      if (py > groundY - 6) continue;
      ctx.beginPath(); ctx.arc(px, py, 5 + rnd() * 11, 0, Math.PI * 2); ctx.fill();
    }
    // top rim highlight (sun catching the crown)
    ctx.strokeStyle = "rgba(168,146,128,0.75)"; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = Math.round(N * 0.55); i <= Math.round(N * 0.95); i++) {
      const p = pts[i % N]; if (i === Math.round(N * 0.55)) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();

    // --- buried soil mound: covers the lower 2/3 of the rock, so it looks sunk ---
    ctx.fillStyle = "#3a2a1e";
    ctx.beginPath();
    ctx.moveTo(0, s);
    ctx.lineTo(0, groundY + s * 0.06);
    // berm rises to meet the rock on the left, dips under it, rises on the right
    ctx.quadraticCurveTo(cx - R * 0.9, groundY - s * 0.02, cx - R * 0.5, groundY + s * 0.03);
    ctx.quadraticCurveTo(cx, groundY + s * 0.12, cx + R * 0.5, groundY + s * 0.03);
    ctx.quadraticCurveTo(cx + R * 0.9, groundY - s * 0.02, s, groundY + s * 0.06);
    ctx.lineTo(s, s); ctx.closePath(); ctx.fill();
    // mound texture: lighter kicked-up soil highlight along the crest
    ctx.strokeStyle = "#5a4230"; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, groundY + s * 0.06);
    ctx.quadraticCurveTo(cx - R * 0.9, groundY - s * 0.02, cx - R * 0.5, groundY + s * 0.03);
    ctx.quadraticCurveTo(cx, groundY + s * 0.12, cx + R * 0.5, groundY + s * 0.03);
    ctx.quadraticCurveTo(cx + R * 0.9, groundY - s * 0.02, s, groundY + s * 0.06);
    ctx.stroke();
    ctx.fillStyle = "#2c2016";
    for (let i = 0; i < 60; i++) { const x = rnd() * s, y = groundY + s * 0.06 + rnd() * (s - groundY); ctx.fillRect(x, y, 2, 2); }

    // --- molten glow + cracks along the buried contact line ---
    const glow = ctx.createLinearGradient(0, groundY - s * 0.05, 0, groundY + s * 0.14);
    glow.addColorStop(0, "rgba(255,120,40,0)");
    glow.addColorStop(0.5, "rgba(255,120,40,0.45)");
    glow.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.ellipse(cx, groundY + s * 0.05, R * 1.0, s * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#ff6a1e"; ctx.lineWidth = 3; ctx.lineCap = "round";
    for (const [x0, y0, x1, y1] of [
      [cx - R * 0.6, groundY + 8, cx - R * 0.2, groundY - R * 0.25],
      [cx + R * 0.1, groundY + 6, cx + R * 0.4, groundY - R * 0.3],
      [cx - R * 0.05, groundY + 10, cx + R * 0.05, groundY - R * 0.1],
    ] as [number, number, number, number][]) {
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    // embers rising from the contact line
    ctx.fillStyle = "#ffb347";
    for (let i = 0; i < 8; i++) { const x = cx + (rnd() - 0.5) * R * 1.6, y = groundY - rnd() * R * 0.5; ctx.beginPath(); ctx.arc(x, y, 2 + rnd() * 2, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "#ffe08a";
    for (let i = 0; i < 5; i++) { const x = cx + (rnd() - 0.5) * R * 1.2, y = groundY + (rnd() - 0.5) * s * 0.06; ctx.fillRect(x, y, 2, 2); }

    this.textures.addCanvas("meteor-rock", c);
  }

  private genCaveEntranceTexture(): void {
    if (this.textures.exists("cave-entrance")) return;
    const s = 64;
    const c = document.createElement("canvas"); c.width = s; c.height = s;
    const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
    // rocky rim
    ctx.fillStyle = "#3a2f28";
    ctx.beginPath(); ctx.ellipse(s / 2, s / 2, s * 0.46, s * 0.42, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#5a4a3f";
    ctx.beginPath(); ctx.ellipse(s / 2, s * 0.44, s * 0.46, s * 0.32, 0, 0, Math.PI); ctx.fill();
    // dark hole
    const g = ctx.createRadialGradient(s / 2, s * 0.55, 2, s / 2, s * 0.55, s * 0.4);
    g.addColorStop(0, "#000000"); g.addColorStop(0.7, "#0a0710"); g.addColorStop(1, "#241a22");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(s / 2, s * 0.55, s * 0.34, s * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    // faint ember glow from within
    ctx.fillStyle = "rgba(255,110,30,0.25)";
    ctx.beginPath(); ctx.ellipse(s / 2, s * 0.62, s * 0.16, s * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    this.textures.addCanvas("cave-entrance", c);
  }

  private placeMeteor(): void {
    this.genMeteorTexture();
    this.genCaveEntranceTexture();
    const ts = this.tileSize;
    const n = MapScene.METEOR_SIZE;
    this.meteorSprite = this.add.image(
      (this.meteorX + n / 2) * ts,
      (this.meteorY + n / 2) * ts,
      "meteor-rock"
    ).setDepth(9).setDisplaySize(ts * n, ts * n);
    // Cracked-open cave entrance just below the meteor's bottom-centre.
    this.caveEntranceSprite = this.add.image(
      this.caveEntranceX * ts + ts / 2,
      this.caveEntranceY * ts + ts / 2,
      "cave-entrance"
    ).setDepth(8).setDisplaySize(ts, ts);
    // Register the warp into the cave (idempotent).
    const warps = this.mapData.warps || (this.mapData.warps = []);
    if (!warps.some(w => w.x === this.caveEntranceX && w.y === this.caveEntranceY)) {
      warps.push({ x: this.caveEntranceX, y: this.caveEntranceY, targetMap: "crater_cave", targetX: 6, targetY: 10 });
    }
  }

  private triggerMeteorEvent(): void {
    this.showDialog([
      "空から 落ちてきた 巨大な 隕石だ。",
      "3ぶんの2は 地面に うまっていて、\nてっぺんだけが 顔を のぞかせている。",
      "衝突の しょうげきで 地面が われ、\nしたに ぽっかりと あなが あいている。",
      "熱い 空気が 奥から ふきあげている…。\n(あなに もぐって みよう。)",
    ]);
  }

  // ---- Moon-capsule field items inside the cave ----
  private genFieldCapsuleTexture(): void {
    if (this.textures.exists("field-capsule")) return;
    const s = 48;
    const c = document.createElement("canvas"); c.width = s; c.height = s;
    const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
    const cx = s / 2, cy = s / 2, r = s * 0.36;
    // soft drop shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.95, r * 0.9, r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
    // capsule body (moon-white top, silver bottom, like the throwing capsule)
    const grd = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    grd.addColorStop(0, "#f4f4fa"); grd.addColorStop(0.5, "#c8ccd8"); grd.addColorStop(1, "#8a8fa0");
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    // top hemisphere pale-blue tint
    ctx.fillStyle = "rgba(150,190,235,0.5)";
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, Math.PI * 2); ctx.fill();
    // equator band + centre button
    ctx.fillStyle = "#2b2f3a"; ctx.fillRect(cx - r, cy - 2, r * 2, 4);
    ctx.fillStyle = "#e8ecf6"; ctx.beginPath(); ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#2b2f3a"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2); ctx.stroke();
    // rim + specular highlight
    ctx.strokeStyle = "#6a7088"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath(); ctx.ellipse(cx - r * 0.35, cy - r * 0.45, r * 0.18, r * 0.1, -0.6, 0, Math.PI * 2); ctx.fill();
    this.textures.addCanvas("field-capsule", c);
  }

  private placeCaveCapsules(): void {
    this.genFieldCapsuleTexture();
    const ts = this.tileSize;
    const pk = this.playerState?.pickups || [];
    for (const cap of MapScene.CAVE_CAPSULES) {
      if (cap.mapKey !== this.currentMapKey) continue;
      if (pk.includes(cap.flag)) continue;   // already collected
      const sprite = this.add.image(
        cap.x * ts + ts / 2, cap.y * ts + ts / 2, "field-capsule"
      ).setDepth(6).setDisplaySize(ts * 0.8, ts * 0.8);
      this.caveCapsuleSprites.set(cap.flag, sprite);
    }
  }

  private tryPickCaveCapsule(cap: { flag: string; item: string; itemName: string }): void {
    if (!this.playerState) return;
    this.playerState.pickups = this.playerState.pickups || [];
    if (this.playerState.pickups.includes(cap.flag)) return;
    this.playerState.pickups.push(cap.flag);
    const sprite = this.caveCapsuleSprites.get(cap.flag);
    if (sprite) { sprite.destroy(); this.caveCapsuleSprites.delete(cap.flag); }
    const existing = this.playerState.items.find(i => i.id === cap.item);
    if (existing) existing.count++;
    else this.playerState.items.push({ id: cap.item, count: 1 });
    this.showDialog([
      "ムーンカプセルの かたちを した\nカプセルを ひろった！",
      `なかには「${cap.itemName}」が\nはいっていた！`,
    ]);
  }

  /** Reward for beating イーゼン at the bottom of the cave: his dropped debris. */
  private awardEezenDebris(): void {
    if (!this.playerState) return;
    this.playerState.pickups = this.playerState.pickups || [];
    if (this.playerState.pickups.includes("eezen_debris")) return;
    this.playerState.pickups.push("eezen_debris");
    const existing = this.playerState.items.find(i => i.id === "debris_fragment");
    if (existing) existing.count++;
    else this.playerState.items.push({ id: "debris_fragment", count: 1 });
    this.inCutscene = true;
    this.showDialog([
      "イーゼンが あわてて 出て いった あと、\nたいせつ そうな かけらが 落ちていた。",
      "「デブリのはへん」を てにいれた！",
      "隕石とともに 落ちてきた 金属片だ。\nリサイクルショップで お金に なるらしい…。",
    ], () => { this.inCutscene = false; });
  }

  /** Right after the gym leader falls, the ground shakes: a meteor has struck. */
  private playGymClearCutscene(): void {
    if (this.playerState) {
      this.playerState.pickups = this.playerState.pickups || [];
      if (this.playerState.pickups.includes("gym1_quake")) return;
      this.playerState.pickups.push("gym1_quake");
    }
    this.inCutscene = true;
    this.cameras.main.shake(1400, 0.012);
    this.time.delayedCall(1500, () => {
      this.showDialog([
        "ゴゴゴ…！ 地面が 大きく ゆれた！",
        "リューマ「なんだ…！？ 今の 揺れは…！」",
        "リューマ「街の はずれに 何かが\n落ちたようだ。」",
        "リューマ「きみ、様子を 見てきて\nくれ ないか。」",
      ], () => { this.inCutscene = false; });
    });
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

  // Three pieces of research equipment lined against the top wall of the
  // Medical Center so it reads as a lab rather than an empty room.
  private placeMedicalDecor(): void {
    const ts = this.tileSize;
    this.genMedicalTextures();
    // Row 1 (just below the top wall): scanner bed, holo-console, specimen tank
    this.add.image(Math.round(2.0 * ts), Math.round(1.5 * ts), "med-scanner").setDepth(6);
    this.add.image(Math.round(5.0 * ts), Math.round(1.4 * ts), "med-console").setDepth(6);
    this.add.image(Math.round(7.5 * ts), Math.round(1.5 * ts), "med-tank").setDepth(6);
  }

  private genMedicalTextures(): void {
    const mk = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
      if (this.textures.exists(key)) return;
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false; draw(ctx);
      this.textures.addCanvas(key, c);
    };
    // Scanner bed (health scanner) — white pad + blue readout arch
    mk("med-scanner", 88, 40, (ctx) => {
      ctx.fillStyle = "#e8eef4"; this.roundRect(ctx, 4, 14, 80, 22, 5); ctx.fill();      // bed pad
      ctx.fillStyle = "#c6d0dc"; ctx.fillRect(4, 30, 80, 6);
      ctx.fillStyle = "#aeb9c8"; ctx.fillRect(10, 36, 6, 4); ctx.fillRect(72, 36, 6, 4);  // legs
      ctx.strokeStyle = "#7fd0e6"; ctx.lineWidth = 3; ctx.beginPath();                    // scan arch
      ctx.arc(44, 20, 26, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      ctx.fillStyle = "#8ff0d8"; ctx.fillRect(20, 20, 48, 2);                             // scan line
    });
    // Holo-console — dark cabinet with a glowing vitals screen
    mk("med-console", 52, 46, (ctx) => {
      ctx.fillStyle = "#20242c"; this.roundRect(ctx, 4, 2, 44, 30, 4); ctx.fill();
      ctx.fillStyle = "#123b52"; ctx.fillRect(8, 6, 36, 22);
      ctx.strokeStyle = "#5fd0f0"; ctx.lineWidth = 1.5;                                   // heartbeat line
      ctx.beginPath(); ctx.moveTo(10, 18); ctx.lineTo(18, 18); ctx.lineTo(22, 10);
      ctx.lineTo(26, 26); ctx.lineTo(30, 18); ctx.lineTo(42, 18); ctx.stroke();
      ctx.fillStyle = "#a0ffc0"; ctx.fillRect(11, 24, 4, 2); ctx.fillStyle = "#ff9aa0"; ctx.fillRect(37, 24, 4, 2);
      ctx.fillStyle = "#3a4250"; ctx.fillRect(10, 34, 32, 10);                            // stand
    });
    // Specimen tank — glass cylinder with fluid + floating capsule
    mk("med-tank", 40, 52, (ctx) => {
      ctx.fillStyle = "#c6d0dc"; ctx.fillRect(6, 46, 28, 6);                              // base
      ctx.fillStyle = "rgba(90,180,210,0.55)"; this.roundRect(ctx, 8, 4, 24, 44, 10); ctx.fill(); // fluid
      ctx.strokeStyle = "#dfe8f0"; ctx.lineWidth = 2; this.roundRect(ctx, 8, 4, 24, 44, 10); ctx.stroke();
      ctx.fillStyle = "#eaf6ff"; this.roundRect(ctx, 12, 6, 6, 30, 3); ctx.fill();        // highlight
      ctx.fillStyle = "#ffe08a"; ctx.beginPath(); ctx.arc(22, 30, 5, 0, Math.PI * 2); ctx.fill(); // specimen
    });
  }

  // ---- Gym interior: lavish battle hall ----
  private placeGymDecor(): void {
    const ts = this.tileSize;
    this.genGymTextures();
    const { width, height, layers } = this.mapData;
    const floor = layers.floor;

    // (1) Luxurious marble floor laid over every walkable gym tile. Hall tiles
    // (10) get a warm champagne marble; arena tiles (38) a deep royal marble.
    const fo = this.add.graphics().setDepth(1);
    let seed = 20250708;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = floor[y][x];
        if (t !== 10 && t !== 38) continue;
        const px = x * ts, py = y * ts;
        const hall = t === 10;
        fo.fillStyle(hall ? 0x3b3550 : 0x2a2440, 1);
        fo.fillRect(px, py, ts, ts);
        // marble veining
        fo.lineStyle(1, hall ? 0x554d70 : 0x413a5e, 0.9);
        fo.beginPath();
        fo.moveTo(px + rnd() * ts, py);
        fo.lineTo(px + rnd() * ts, py + ts);
        fo.strokePath();
        // gold seam grid
        fo.lineStyle(1, 0xb9962f, 0.55);
        fo.strokeRect(px + 0.5, py + 0.5, ts - 1, ts - 1);
        // corner studs
        fo.fillStyle(0xe8c766, 0.8);
        fo.fillRect(px + 1, py + 1, 2, 2);
        fo.fillRect(px + ts - 3, py + 1, 2, 2);
        fo.fillRect(px + 1, py + ts - 3, 2, 2);
        fo.fillRect(px + ts - 3, py + ts - 3, 2, 2);
      }
    }

    // (2) Grand battlefield circle in the lower arena (cols5-14, rows9-14).
    const ring = this.add.graphics().setDepth(2);
    const bcx = 9.5 * ts, bcy = 11.5 * ts;
    ring.fillStyle(0x6a4fb0, 0.14); ring.fillEllipse(bcx, bcy, 9.2 * ts, 5.4 * ts);
    ring.lineStyle(3, 0xd8b24a, 0.85); ring.strokeEllipse(bcx, bcy, 8.6 * ts, 4.9 * ts);
    ring.lineStyle(2, 0x8f74d6, 0.7);  ring.strokeEllipse(bcx, bcy, 7.2 * ts, 4.0 * ts);
    ring.lineStyle(2, 0xd8b24a, 0.6);  ring.strokeEllipse(bcx, bcy, 2.4 * ts, 1.4 * ts);
    // centre emblem diamond
    ring.fillStyle(0xd8b24a, 0.5);
    ring.beginPath();
    ring.moveTo(bcx, bcy - 0.7 * ts); ring.lineTo(bcx + 0.55 * ts, bcy);
    ring.lineTo(bcx, bcy + 0.7 * ts); ring.lineTo(bcx - 0.55 * ts, bcy);
    ring.closePath(); ring.fill();

    // (3) Leader's dais glow (around the central device where リューマ stands).
    const dais = this.add.graphics().setDepth(2);
    const dcx = 9 * ts + ts / 2, dcy = 6.5 * ts + ts / 2;
    dais.fillStyle(0x8f74d6, 0.22); dais.fillEllipse(dcx, dcy, 4.6 * ts, 3.0 * ts);
    dais.lineStyle(3, 0xe8c766, 0.9); dais.strokeEllipse(dcx, dcy, 4.0 * ts, 2.5 * ts);

    // (4) Crest high on the arena's north wall, above the leader.
    this.add.image(9 * ts + ts / 2, 4 * ts + ts / 2, "gym-crest").setDepth(6);
    // (5) Banners flanking the crest.
    this.add.image(6 * ts + ts / 2, 4 * ts + ts / 2, "gym-banner").setDepth(6);
    this.add.image(12 * ts + ts / 2, 4 * ts + ts / 2, "gym-banner").setDepth(6);
    // (6) Ornate pillars at the arena's upper corners + hall.
    for (const [cx, cy] of [[3, 4], [15, 4], [2, 16], [16, 16]] as [number, number][]) {
      this.add.image(cx * ts + ts / 2, cy * ts + ts, "gym-pillar").setOrigin(0.5, 1).setDepth(6);
    }
    // (7) Flaming braziers flanking the leader's dais.
    for (const [cx, cy] of [[7, 5], [11, 5]] as [number, number][]) {
      this.add.image(cx * ts + ts / 2, cy * ts + ts * 0.9, "gym-brazier").setOrigin(0.5, 1).setDepth(6);
    }
  }

  private genGymTextures(): void {
    const mk = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
      if (this.textures.exists(key)) return;
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false; draw(ctx);
      this.textures.addCanvas(key, c);
    };
    // Ornate marble pillar with a gold capital and base.
    mk("gym-pillar", 30, 78, (ctx) => {
      ctx.fillStyle = "#c9c2dd"; ctx.fillRect(7, 8, 16, 62);          // shaft
      ctx.fillStyle = "#ded8ee"; ctx.fillRect(9, 8, 4, 62);           // highlight flute
      ctx.fillStyle = "#a79ec2"; ctx.fillRect(17, 8, 4, 62);          // shadow flute
      ctx.fillStyle = "#e8c766"; ctx.fillRect(3, 0, 24, 9);           // capital
      ctx.fillStyle = "#b9962f"; ctx.fillRect(3, 6, 24, 3);
      ctx.fillStyle = "#e8c766"; ctx.fillRect(2, 70, 26, 8);          // base
      ctx.fillStyle = "#b9962f"; ctx.fillRect(2, 70, 26, 2);
    });
    // Hanging banner (royal purple) with a gold moon-and-star emblem.
    mk("gym-banner", 28, 62, (ctx) => {
      ctx.fillStyle = "#5a2a86"; ctx.fillRect(3, 0, 22, 52);          // cloth
      ctx.fillStyle = "#6d38a0"; ctx.fillRect(3, 0, 22, 4);
      ctx.beginPath(); ctx.moveTo(3, 52); ctx.lineTo(14, 60); ctx.lineTo(25, 52); ctx.closePath();
      ctx.fillStyle = "#5a2a86"; ctx.fill();                          // pointed hem
      ctx.strokeStyle = "#e8c766"; ctx.lineWidth = 2; ctx.strokeRect(4, 1, 20, 50); // gold trim
      ctx.fillStyle = "#e8c766";                                      // crescent
      ctx.beginPath(); ctx.arc(14, 22, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#5a2a86"; ctx.beginPath(); ctx.arc(17, 20, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffe7a0"; ctx.fillRect(9, 34, 2, 2); ctx.fillRect(18, 38, 2, 2); ctx.fillRect(13, 42, 2, 2);
    });
    // Gold brazier with a flickering flame.
    mk("gym-brazier", 26, 42, (ctx) => {
      ctx.fillStyle = "#8a6a24"; ctx.fillRect(11, 26, 4, 12);         // stem
      ctx.fillStyle = "#6a5018"; ctx.fillRect(6, 38, 14, 4);          // foot
      ctx.fillStyle = "#e8c766"; this.roundRect(ctx, 3, 20, 20, 9, 3); ctx.fill();   // bowl
      ctx.fillStyle = "#b9962f"; ctx.fillRect(3, 26, 20, 3);
      ctx.fillStyle = "#ff6a1e"; ctx.beginPath();                     // flame
      ctx.moveTo(13, 2); ctx.quadraticCurveTo(21, 14, 13, 22); ctx.quadraticCurveTo(5, 14, 13, 2); ctx.fill();
      ctx.fillStyle = "#ffd257"; ctx.beginPath();
      ctx.moveTo(13, 8); ctx.quadraticCurveTo(17, 15, 13, 21); ctx.quadraticCurveTo(9, 15, 13, 8); ctx.fill();
    });
    // Large circular gym crest — gold ring around a purple gem with crossed batons.
    mk("gym-crest", 60, 54, (ctx) => {
      ctx.fillStyle = "#e8c766"; ctx.beginPath(); ctx.arc(30, 26, 24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#b9962f"; ctx.beginPath(); ctx.arc(30, 26, 24, 0, Math.PI * 2); ctx.lineWidth = 0;
      ctx.strokeStyle = "#b9962f"; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = "#3a2560"; ctx.beginPath(); ctx.arc(30, 26, 17, 0, Math.PI * 2); ctx.fill();
      // crossed batons
      ctx.strokeStyle = "#e8c766"; ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(20, 16); ctx.lineTo(40, 36); ctx.moveTo(40, 16); ctx.lineTo(20, 36); ctx.stroke();
      // central gem
      ctx.fillStyle = "#9a6ff0"; ctx.beginPath(); ctx.arc(30, 26, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#d8c2ff"; ctx.beginPath(); ctx.arc(28, 24, 2, 0, Math.PI * 2); ctx.fill();
    });
  }

  private placeFarmResearcherNpc(): void {
    this.farmResSprite = this.add.image(
      this.farmResX * this.tileSize + this.tileSize / 2,
      this.farmResY * this.tileSize + this.tileSize / 2,
      this.npcTex("cast-char3-down", "npc-kinoshita")
    ).setDepth(9);
  }

  private triggerFarmResearcherEvent(): void {
    this.showDialog([
      "ようこそ 農園ドームへ。",
      "ここでは にんげんと アルモンが\nあんしんして くらせるように",
      "しょくぶつを そだてているんだ。",
      "しんせんな くうきも たべものも\nこの ドームから 生まれるんだよ。",
    ]);
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

  // ========== PROLOGUE CUTSCENE (wake up at home) ==========
  private setPlayerFacing(dir: Direction): void {
    this.facingDirection = dir;
    const pk = `player-${dir}-0`;
    const ck = `cast-char0-${dir}`;
    if (this.textures.exists(pk)) this.player.setTexture(pk);
    else if (this.textures.exists(ck)) this.player.setTexture(ck);
  }

  /** Floating "!" / "Zzz" emote above the player's head. Returns objects to destroy. */
  private showEmote(kind: "!" | "zzz"): Phaser.GameObjects.GameObject[] {
    const ts = this.tileSize;
    const x = this.gridX * ts + ts / 2;
    const y = this.gridY * ts - 2;
    const label = kind === "!" ? "！" : "Ｚｚｚ";
    const color = kind === "!" ? "#ec4a3a" : "#9fd0ff";
    const t = this.add.text(x, y, label, {
      fontSize: kind === "!" ? "22px" : "18px", color, fontFamily: "'DotGothic16', monospace",
      fontStyle: "bold", stroke: "#ffffff", strokeThickness: 4,
    }).setOrigin(0.5, 1).setDepth(21).setResolution(Math.max(1, this.cameras.main.zoom));
    this.tweens.add({ targets: t, y: y - 5, duration: 420, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    return [t];
  }

  /** Move the player through a fixed tile path (no collision checks), then callback. */
  private scriptedWalk(path: [number, number][], onDone: () => void): void {
    const ts = this.tileSize;
    const step = (i: number) => {
      if (i >= path.length) { onDone(); return; }
      const [tx, ty] = path[i];
      const dir: Direction = tx > this.gridX ? "right" : tx < this.gridX ? "left"
        : ty > this.gridY ? "down" : "up";
      this.setPlayerFacing(dir);
      this.gridX = tx; this.gridY = ty;
      this.isMoving = true;
      this.tweens.add({
        targets: this.player, x: tx * ts + ts / 2, y: ty * ts + ts / 2,
        duration: 210, ease: "Linear",
        onComplete: () => { this.isMoving = false; step(i + 1); },
      });
    };
    step(0);
  }

  private playIntroCutscene(): void {
    this.inCutscene = true;
    const ts = this.tileSize;
    // Start the player in bed (top-left) fast asleep.
    this.gridX = 1; this.gridY = 4;
    this.player.setPosition(1 * ts + ts / 2, 4 * ts + ts / 2);
    this.setPlayerFacing("down");
    let emote = this.showEmote("zzz");

    this.time.delayedCall(1300, () => {
      this.showDialog([
        "「……ん……ぐぅ……」",
        "ちょっと！ まだ 寝てるの！？ 起きなさい！",
        "今日から 月面探査が 始まるんでしょ？\n遅刻しないで 行きなさいね！",
      ], () => {
        emote.forEach(o => o.destroy());
        emote = this.showEmote("!");           // startled
        this.time.delayedCall(650, () => {
          this.showDialog([
            "（しまった…！ もう 集合時間を\nすぎているじゃないか！）",
            "「いけない、行ってきます！」",
          ], () => {
            emote.forEach(o => o.destroy());
            // auto-walk out of the house
            this.scriptedWalk([[2, 4], [2, 5], [2, 6], [3, 6], [4, 6], [4, 7]], () => {
              this.checkWarp();   // (4,7) is the door → warp to クレセントタウン
            });
          });
        });
      });
    });
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
        "あら、こんにちは。ここでの 暮らしにも\nすっかり 慣れちゃったわ。",
        "豆知識よ。月の 重力は 地球の\nおよそ 6ぶんの1 なの。",
        "だから ここでは みんな\nふわっと 軽く 歩けるのよ。",
      ],
      house_3: [
        "クレーターシティは 「静かの海」に\nある 街なんだ。",
        "アポロ11号が 人類で はじめて\n降り立った 場所なんだよ。",
        "月には 空気が ないから、空は\nいつも 真っ暗で 星が よく見える。",
      ],
      house_4: [
        "月の 1日は とても 長くてね、\n昼も 夜も 地球の 2週間ずつ 続くの。",
        "だから 農園ドームの ライトで\n作物に ひかりを あげているのよ。",
        "水も 空気も 自分たちで つくる。\n月で 暮らすって そういうことね。",
      ],
    };
    this.showDialog(lines[this.currentMapKey] ?? lines.house_1);
  }

  // ---- Crater City NW-exit grandmothers (gate to 砂場ルート2) ----
  private placeCraterGrannies(): void {
    // The two face each other (left one looks right, right one looks left) so
    // they read as gossiping neighbours.
    this.granny1Sprite = this.add.image(
      this.granny1X * this.tileSize + this.tileSize / 2,
      this.granny1Y * this.tileSize + this.tileSize / 2,
      this.npcTex("cast-char5-right", "npc-mom")
    ).setDepth(9);
    this.granny2Sprite = this.add.image(
      this.granny2X * this.tileSize + this.tileSize / 2,
      this.granny2Y * this.tileSize + this.tileSize / 2,
      this.npcTex("cast-char5-left", "npc-mom")
    ).setDepth(9);
  }

  private triggerCraterGrannyEvent(): void {
    this.showDialog([
      "おばあさん「あらあら、こんにちは。\nこの さきの 砂の 道は 通れないのよ。」",
      "おばあさん「そうそう、ここで ゆっくり\n宇宙の おしゃべりでも しましょ。」",
      "おばあさん「知ってる？ 太陽の 光が\n地球に とどくまで 約8分 かかるのよ。」",
      "おばあさん「あら すごい。じゃあ わたしから。\n宇宙には 音が ないの。空気が ないからね。」",
      "おばあさん「土星の 輪っかは ほとんどが\n氷の つぶで できているんですって。」",
      "おばあさん「わたしの ばんね。宇宙で いちばん\n大きな 火山は 火星の オリンポス山。\nエベレストの 3倍 くらい あるのよ。」",
      "おばあさん「ふふ、月の うらがわは 地球からは\nぜったいに 見えないの。ふしぎねぇ。」",
      "おばあさん「…さて、あの 隕石さわぎが\nおさまれば、この 道も 通れるように\nなるかもね。」",
    ]);
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
    const boxH = 166;
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
      playSeconds: 0,
    };
  }
}
