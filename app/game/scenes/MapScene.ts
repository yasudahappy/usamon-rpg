import * as Phaser from "phaser";
import { MapData } from "../types";
import { MonsterData, MoveData, MonsterInstance, PlayerState, TrainerData } from "../data/types";
import { loadSettings, saveSettings, GameSettings } from "../data/settings";
import { calculateStats, getExpForLevel, refreshInstanceStats } from "../data/levelSystem";

const MENU_LABELS = ["ずかん", "てもち", "どうぐ", "プレイヤー", "レポート", "せってい", "とじる"];
import { EncounterData, rollEncounter } from "../data/encounterSystem";
import { ensureItemIconTexture } from "../data/itemIcons";
import { ensureNatureGender, genderLabel, genderColor, rollNatureGender, NATURE_MODS, applyNature } from "../data/natureGender";
import { moveMaxPP, ensureInstancePP, restorePP } from "../data/movePP";

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
  // タウルスのどうくつ: たいまつの明かり風オーバーレイ（プレイヤー追従）
  private caveDarkness?: Phaser.GameObjects.Image;

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
  // 配置時に解決した「実際に向く向き」（設定の向きが壁を向く場合は道側へ補正）。
  private trainerFacing: Map<string, Direction> = new Map();
  // Gym-leader gates: leader id -> trainers that must be beaten first.
  private static GYM_LEADER_GATES: Record<string, string[]> = {
    ryuma: ["genki", "kagen"],
    simone: ["rei", "tsurara"],
  };
  // Sealed exits/doors: openings that are not yet passable. Stepping toward one
  // of its tiles shows the messages and blocks passage.
  private static SEALED_EXITS: Record<string, { tiles: { x: number; y: number }[]; messages: string[] }[]> = {
    // NOTE: nectar_town's gym door (15,6) is handled dynamically (ice-melt
    // trial ⑦), see tryMeltGymDoor().
    // frost_route_1's north exit is open (タテアナ村へ). The village itself has
    // no further exit yet — the road to 豊かの海 opens with the gym-3 chapter.
  };
  // Nectar gym door: frozen shut until a fire/metal almon melts it (試練 その1).
  private static NECTAR_GYM_DOOR = { x: 15, y: 6 };
  private static NECTAR_DOOR_FLAG = "nectar_gym_door_melted";
  private static DOOR_MELTERS: Record<string, "fire" | "metal"> = {
    meteko: "fire", meteodon: "fire", roubau: "metal", roubaag: "metal",
  };

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
  // (meteorX,meteorY) is the TOP-LEFT of a METEOR_SIZE x METEOR_SIZE footprint;
  // the cracked-open cave entrance sits at its base.
  private meteorSprite?: Phaser.GameObjects.Image;
  private caveEntranceSprite?: Phaser.GameObjects.Image;
  private meteorX = 29;
  private meteorY = 21;
  private static METEOR_SIZE = 6;
  // Cave entrance sits at the base of the meteor. It lives inside the meteor's
  // 6x6 footprint, so it is explicitly excluded from the meteor's collision/
  // interaction box (see isCollision / checkNpcInteraction) and drawn above it.
  private caveEntranceX = 32;
  private caveEntranceY = 26;
  private lastTrainerDefeated?: string;

  // Capsule field items (heal items etc.) scattered through the meteorite cave
  // and the sandy routes. Picked up by facing the capsule and pressing A.
  private caveCapsuleSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private static CAVE_CAPSULES: { flag: string; mapKey: string; x: number; y: number; item: string; itemName: string }[] = [
    { flag: "cave_capsule_1", mapKey: "crater_cave", x: 10, y: 9, item: "hi_repair_gel", itemName: "ハイリペアジェル" },
    { flag: "cave_capsule_2", mapKey: "crater_cave_b1", x: 10, y: 7, item: "full_repair_gel", itemName: "フルリペアジェル" },
    { flag: "route2_cap_1", mapKey: "sand_route_2", x: 18, y: 2, item: "hi_repair_gel", itemName: "ハイリペアジェル" },
    { flag: "route2_cap_2", mapKey: "sand_route_2", x: 9, y: 8, item: "moon_sand", itemName: "つきのすな" },
    { flag: "route2_cap_3", mapKey: "sand_route_2", x: 2, y: 17, item: "full_repair_gel", itemName: "フルリペアジェル" },
    { flag: "lava_cap_1", mapKey: "lava_tube", x: 4, y: 12, item: "full_repair_gel", itemName: "フルリペアジェル" },
    { flag: "deep_cap_1", mapKey: "lava_tube_deep", x: 2, y: 7, item: "full_repair_gel", itemName: "フルリペアジェル" },
    { flag: "gym3_cap_1", mapKey: "gym_3", x: 2, y: 13, item: "star_capsule", itemName: "スターカプセル" },
    { flag: "taurus_cap_1", mapKey: "taurus_pass", x: 4, y: 14, item: "full_repair_gel", itemName: "フルリペアジェル" },
    { flag: "tcave_cap_1", mapKey: "taurus_cave", x: 17, y: 4, item: "hi_repair_gel", itemName: "ハイリペアジェル" },
    { flag: "tcave_cap_2", mapKey: "taurus_cave_b1", x: 16, y: 14, item: "revive_star", itemName: "リバイブスター" },
  ];

  // 溶岩洞→深部の岩の門（ツキヤマ救出で開通）
  private deepGateRock?: Phaser.GameObjects.Image;
  private deepGateExam?: { x: number; y: number; fn: () => void };

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
  private menuSubScreen: "none" | "party" | "save" | "stub" | "settings" | "restart-confirm" | "bag" | "bag_target" | "zukan" | "zukan_detail" | "party_action" | "mon_detail" = "none";
  // てもちのアクションメニュー／アルモン詳細ビュー
  private partyActionSel = 0;
  private monDetailPage = 0;   // 0=じょうほう, 1=のうりょく, 2=わざ
  private menuSelectedIndex = 0;
  private menuElements: Phaser.GameObjects.GameObject[] = [];
  private menuGpPrevDpad: string | null = null;
  private mKey?: Phaser.Input.Keyboard.Key;
  private escKey?: Phaser.Input.Keyboard.Key;
  // Party reorder state
  private partySelIndex = 0;
  private partyPickIndex = -1;
  private partyGpPrevDpad: string | null = null;
  // Bag (どうぐ) screen state
  private bagSelIndex = 0;
  private bagTargetIndex = 0;
  private bagGpPrevDpad: string | null = null;
  private bagMessage = "";
  // Zukan (ずかん) screen state
  private zukanSelIndex = 0;
  private zukanScrollTop = 0;
  private zukanGpPrevDpad: string | null = null;
  // Settings (せってい) screen state
  private settingsSelIndex = 0;
  private settingsGpPrevDpad: string | null = null;

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
    // Medical Center / Moonbase lab researchers: reset so a stale reference
    // (Phaser reuses the scene instance across restart) can't fire the wrong
    // map's dialog or block tiles in another map.
    this.researcher1Sprite = undefined;
    this.researcher2Sprite = undefined;
    this.labRes1Sprite = undefined;
    this.labRes2Sprite = undefined;
    this.nectarExam = [];
    this.caveDarkness = undefined;
    this.quizAwaiting = null;
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
    if (this.currentMapKey.startsWith("recovery_pod")) {
      this.placeRecoveryPodDecor();
      this.placeNurseNpc();
    }

    // Place Shopkeeper NPC in planet shop
    if (this.currentMapKey.startsWith("planet_shop")) {
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

    // Nectar Town — frozen basin ambience: ice crystals, a playing almon on the
    // pond, falling snow and a cold colour cast. Plus the town's education
    // events (第5章 / ネクタルタウン設計v1 §11-§12).
    if (this.currentMapKey === "nectar_town") {
      this.placeNectarDecor();
      this.startSnowfall();
      this.applyNectarGymDoorState();
      this.placeNectarEvents();
      const pk = this.playerState?.pickups || [];
      if (this.playerState && !pk.includes("nectar_arrival_seen")) {
        this.time.delayedCall(700, () => this.playNectarArrival());
      }
    }

    // Frost route (寒冷地): same snowy ambience as the town.
    if (this.currentMapKey === "frost_route_1") {
      this.startSnowfall();
    }

    // タテアナ村 — 縦孔のふちの村。救助クエスト（第6章 / タテアナ村設計v1）。
    if (this.currentMapKey === "pit_village") {
      this.placePitVillageDecor();
      this.placePitVillageEvents();
      const pk = this.playerState?.pickups || [];
      if (this.playerState && !pk.includes("pit_arrival_seen")) {
        this.time.delayedCall(700, () => this.playPitArrival());
      }
    }

    // 溶岩洞 — 行方不明のツキヤマ研究員（救助対象）＋深部への岩の門。
    if (this.currentMapKey === "lava_tube") {
      this.placeLavaTubeEvents();
      this.placeLavaDeepGate();
    }

    // 溶岩洞・深部 — あつい裂け目の洞窟（豊かの海への抜け道）。
    if (this.currentMapKey === "lava_tube_deep") {
      this.placeCaveCapsules();
      this.placeLavaTubeDeepDecor();
    }

    // リルの谷 — 溶岩が流れた跡の溝をたどる地上ルート。
    if (this.currentMapKey === "rill_route") {
      this.placeRillRouteEvents();
    }

    // ミノリタウン — 豊かの海のほとり。ルナ16号と地熱農園の町。
    if (this.currentMapKey === "minori_town") {
      this.placeMinoriDecor();
      this.placeMinoriTownEvents();
      const pk = this.playerState?.pickups || [];
      if (this.playerState && !pk.includes("minori_arrival_seen")) {
        this.time.delayedCall(700, () => this.playMinoriArrival());
      }
    }

    // タウルスさんどう — ジム4への道（イーゼン再戦・したっぱペア・展望）。
    if (this.currentMapKey === "taurus_pass") {
      this.placeTaurusPassEvents();
      this.placeCaveCapsules();
    }

    // セレネタウン — 鏡が太陽の光をあつめる「光の町」。ジム4はまだ準備中。
    if (this.currentMapKey === "serene_town") {
      this.placeSereneDecor();
      this.placeSereneTownEvents();
      const pk = this.playerState?.pickups || [];
      if (this.playerState && !pk.includes("serene_arrival_seen")) {
        this.time.delayedCall(700, () => this.playSereneArrival());
      }
    }

    // タウルスのどうくつ — 暗闇の2フロア洞窟。地下には ぬしのガンブロス。
    if (this.currentMapKey === "taurus_cave" || this.currentMapKey === "taurus_cave_b1") {
      this.placeCaveCapsules();
      if (this.currentMapKey === "taurus_cave_b1") this.placeTaurusCaveBoss();
      this.placeCaveDarkness();
    }

    // ミノリジム — 溶岩バルブのしかけ（ジム3・炎）。
    if (this.currentMapKey === "gym_3") {
      this.placeGym3Events();
      this.placeCaveCapsules();
    }

    // セレネジム — プリズムで光の橋を通すしかけ（ジム4・光）。
    if (this.currentMapKey === "gym_4") {
      this.placeGym4Events();
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
    // Sandy route 2: capsule field items (heal + moon sand).
    if (this.currentMapKey === "sand_route_2") {
      this.placeCaveCapsules();
    }

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

  // Animated tile base IDs (sand sparkle + farm crops + frost twinkle).
  // 70 = farm crop bed, 90 = frost regolith (ネクタルタウン).
  private static SAND_TILE_IDS = [5, 6, 7, 8, 9, 10, 11, 12, 32, 33, 34, 35, 36, 70, 90, 100, 104, 110];
  // Base tile -> [frame A, frame B] cycled every 800ms (base -> A -> B).
  // Sand sparkle: A=41-48, B=49-56. Farm crop: 70 -> 71/72. Frost: 90 -> 94/95.
  private static SPARKLE_MAP: Record<number, [number, number]> = {
    5: [41, 49], 6: [42, 50], 7: [43, 51], 8: [44, 52],
    9: [45, 53], 10: [46, 54], 11: [47, 55], 12: [48, 56],
    32: [41, 49], 33: [42, 50], 34: [43, 51], 35: [44, 52],
    36: [45, 53], 70: [71, 72], 90: [94, 95],
    100: [107, 108], 104: [105, 106], 110: [111, 112],
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

  /** 設定された向きが壁（か地図外）を向く場合、道側（いちばん開けた方向）へ
   *  向きを補正して返す。道に点在するトレーナーが壁を向くのを防ぐ。 */
  private resolveTrainerFacing(t: TrainerData): Direction {
    const delta: Record<Direction, [number, number]> = {
      up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
    };
    // その向きに何タイル 連続して 歩けるか（＝道の長さ）。
    const openRun = (d: Direction): number => {
      const [sx, sy] = delta[d];
      let n = 0;
      for (let k = 1; k <= 6; k++) {
        if (this.mapData.layers.collision[t.y + sy * k]?.[t.x + sx * k] === 0) n++;
        else break;
      }
      return n;
    };
    const set: Direction = (t.direction as Direction) || "down";
    let best: Direction = set, bestRun = -1;
    for (const d of ["down", "up", "left", "right"] as Direction[]) {
      const r = openRun(d);
      if (r > bestRun) { bestRun = r; best = d; }
    }
    // 設定の向きが 1タイル以内で 壁に ぶつかり、かつ もっと長い道が
    // 別方向に あるなら、その道の方を向く（道で 壁を 向くのを 防ぐ）。
    if (openRun(set) <= 1 && bestRun >= 3) return best;
    return set;
  }

  private placeTrainers(): void {
    this.trainerSprites.clear();
    this.trainerFacing.clear();
    const mapTrainers = this.allTrainers.filter(
      t => t.mapKey === this.currentMapKey
    );

    for (const trainer of mapTrainers) {
      // ライバル・イーゼンは 隕石洞窟の 撃破後、忘れ物を残して 先に
      // 出ていく（eezen_debris）。以降は 洞窟に いないので 配置しない。
      if (trainer.id === "eezen" && trainer.mapKey === "crater_cave_b2" &&
          this.playerState?.pickups?.includes("eezen_debris")) {
        continue;
      }
      const facing = this.resolveTrainerFacing(trainer);
      this.trainerFacing.set(trainer.id, facing);
      // Defeated trainers stay on the map. If a side tile is free they step
      // aside (staying solid) so the path opens; otherwise they remain on their
      // tile and become passable (see isCollision / trainerTile).
      const pos = this.trainerTile(trainer);

      // Use the trainer's hand-drawn NPC sprite (facing the resolved direction);
      // fall back to the old red-tinted marker only if that texture is missing.
      const owKey = (trainer as TrainerData & { overworldSprite?: string }).overworldSprite;
      const dir = facing;
      const castKey = owKey ? `cast-${owKey}-${dir}` : "";
      const useCast = !!castKey && this.textures.exists(castKey);
      const sprite = this.add.image(
        pos.x * this.tileSize + this.tileSize / 2,
        pos.y * this.tileSize + this.tileSize / 2,
        useCast ? castKey : "player-frame-0"
      ).setDepth(9);
      if (!useCast) sprite.setTint(0xff6644);
      this.trainerSprites.set(trainer.id, sprite);
    }
  }

  /** Where a trainer currently stands and whether it's solid.
   *  Live: on its post (solid). Defeated: steps to a free perpendicular side
   *  tile (solid) so the path clears; if both sides are walls it stays put and
   *  becomes passable. */
  private trainerTile(t: TrainerData): { x: number; y: number; solid: boolean } {
    if (!this.playerState?.defeatedTrainers.includes(t.id)) {
      return { x: t.x, y: t.y, solid: true };
    }
    const aside = this.defeatedAside(t);
    return aside ? { x: aside.x, y: aside.y, solid: true } : { x: t.x, y: t.y, solid: false };
  }

  /** A free tile perpendicular to the trainer's facing (the axis the player
   *  walks past on), or null if both perpendicular neighbours are walls. */
  private defeatedAside(t: TrainerData): { x: number; y: number } | null {
    const facing = this.trainerFacing.get(t.id) || t.direction;
    const vertical = facing === "up" || facing === "down";
    const cands = vertical
      ? [{ x: t.x - 1, y: t.y }, { x: t.x + 1, y: t.y }]
      : [{ x: t.x, y: t.y - 1 }, { x: t.x, y: t.y + 1 }];
    for (const c of cands) {
      if (this.mapData.layers.collision[c.y]?.[c.x] === 0) return c;
    }
    return null;
  }

  private checkTrainerSight(): void {
    if (this.startingBattle || this.isWarping || this.trainerApproaching) return;
    const mapTrainers = this.allTrainers.filter(
      t => t.mapKey === this.currentMapKey
    );

    const RANGE = 6;   // all trainers see 6 tiles ahead (blocked by walls)
    for (const trainer of mapTrainers) {
      if (this.playerState?.defeatedTrainers.includes(trainer.id)) continue;
      // Gym leaders battle only when the player talks to them (checkNpcInteraction).
      if (MapScene.GYM_LEADER_GATES[trainer.id]) continue;

      let inSight = false;
      const dx = this.gridX - trainer.x;
      const dy = this.gridY - trainer.y;

      switch (this.trainerFacing.get(trainer.id) || trainer.direction) {
        case "down":  inSight = dx === 0 && dy > 0 && dy <= RANGE; break;
        case "up":    inSight = dx === 0 && dy < 0 && Math.abs(dy) <= RANGE; break;
        case "left":  inSight = dy === 0 && dx < 0 && Math.abs(dx) <= RANGE; break;
        case "right": inSight = dy === 0 && dx > 0 && dx <= RANGE; break;
      }

      // A wall between the trainer and the player blocks the line of sight.
      if (inSight && !this.sightLineClear(trainer)) inSight = false;

      if (inSight) {
        this.beginTrainerApproach(trainer);
        return;
      }
    }
  }

  /** True when no wall tile lies between the trainer and the player (along the
   *  trainer's facing axis). Used so 6-tile sight can't pierce walls. */
  private sightLineClear(trainer: TrainerData): boolean {
    const facing = this.trainerFacing.get(trainer.id) || trainer.direction;
    const stepX = facing === "left" ? -1 : facing === "right" ? 1 : 0;
    const stepY = facing === "up" ? -1 : facing === "down" ? 1 : 0;
    const dist = Math.abs(this.gridX - trainer.x) + Math.abs(this.gridY - trainer.y);
    for (let k = 1; k < dist; k++) {
      const x = trainer.x + stepX * k;
      const y = trainer.y + stepY * k;
      if (this.mapData.layers.collision[y]?.[x] === 1) return false;
    }
    return true;
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

    // Only roll encounters on "wild" ground: desert sand, cave floor or frost.
    const { layers } = this.mapData;
    const tileId = layers.floor[this.gridY]?.[this.gridX];
    // Sand tiles: 5-12, 14-21 (edges), 32-36 (variants). 80 = cave floor.
    // 90 = frost regolith (ice tiles 91 stay encounter-free so slides feel good).
    const encounterTiles = [5,6,7,8,9,10,11,12,14,15,16,17,18,19,20,21,32,33,34,35,36,80,90];
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
        !(x === this.caveEntranceX && y === this.caveEntranceY) &&
        x >= this.meteorX && x < this.meteorX + MapScene.METEOR_SIZE &&
        y >= this.meteorY && y < this.meteorY + MapScene.METEOR_SIZE) return true;
    if (this.labRes1Sprite && x === this.labRes1X && y === this.labRes1Y) return true;
    if (this.labRes2Sprite && x === this.labRes2X && y === this.labRes2Y) return true;
    if (this.nectarExam.some(e => e.x === x && e.y === y)) return true;
    // Uncollected cave capsules block their tile (pick up by facing + A).
    for (const c of MapScene.CAVE_CAPSULES) {
      if (c.mapKey === this.currentMapKey && c.x === x && c.y === y && this.caveCapsuleSprites.has(c.flag)) return true;
    }
    // Trainers block their current tile: live ones on their post, defeated ones
    // on the side tile they stepped to (defeated with no side tile are passable).
    for (const t of this.allTrainers) {
      if (t.mapKey !== this.currentMapKey) continue;
      if (!this.trainerSprites.has(t.id)) continue;
      const pos = this.trainerTile(t);
      if (pos.solid && pos.x === x && pos.y === y) return true;
    }
    return false;
  }

  private tryMove(dir: Direction): void {
    // A spotted-by-trainer approach (incl. mid-ice-slide) freezes the player:
    // otherwise ice would keep sliding them away from the approaching trainer,
    // who then overshoots and the battle never triggers.
    if (this.trainerApproaching || this.startingBattle) return;
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

    // Nectar gym door: frozen until a fire/metal almon melts it (試練 その1 ⑦).
    // Once melted the tile is a normal warp and this branch no longer fires.
    if (this.currentMapKey === "nectar_town" &&
        targetX === MapScene.NECTAR_GYM_DOOR.x && targetY === MapScene.NECTAR_GYM_DOOR.y &&
        !(this.playerState?.pickups || []).includes(MapScene.NECTAR_DOOR_FLAG)) {
      if (!this.dialogActive) this.tryMeltGymDoor();
      return;
    }

    // Sealed exits/doors (not-yet-available passages): show the messages and
    // turn the player back.
    const sealedList = MapScene.SEALED_EXITS[this.currentMapKey];
    const sealed = sealedList?.find(s => s.tiles.some(t => t.x === targetX && t.y === targetY));
    if (sealed) {
      if (!this.dialogActive) this.showDialog(sealed.messages);
      return;
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

        // Nectar Town step-on triggers (overlook / eavesdrop cutscenes)
        this.checkNectarStepTriggers();

        // 溶岩洞: stepping into the final chamber makes the surveying grunts
        // rush the player (wide halls would let sight-lines be side-stepped).
        this.checkLavaTubeAmbush();

        // Ice (tile 91): keep sliding in the same direction until something
        // blocks the way (RSE-style skating — ネクタルタウンの凍った池 etc.).
        if (!this.isWarping && !this.startingBattle) {
          const hereId = this.mapData.layers.floor[this.gridY]?.[this.gridX];
          if (hereId === 91) {
            const d = this.facingDirection;
            const nx = this.gridX + (d === "right" ? 1 : d === "left" ? -1 : 0);
            const ny = this.gridY + (d === "down" ? 1 : d === "up" ? -1 : 0);
            const sealedHere = MapScene.SEALED_EXITS[this.currentMapKey]
              ?.some(s => s.tiles.some(t => t.x === nx && t.y === ny));
            if (!sealedHere && !this.isCollision(nx, ny)) {
              this.tryMove(d);
              return;
            }
          }
        }

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
    // Cave darkness follows the player every frame (even mid-step between tiles).
    if (this.caveDarkness && this.player) {
      this.caveDarkness.setPosition(this.player.x, this.player.y);
    }

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

    // オートレポート（条件が揃った最初のフレームで保存する）
    this.maybeAutoSave();

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

    // --- Moon-quiz answer (Aボタン=はい / Bボタン=いいえ) ---
    if (this.quizAwaiting && (gpA || gpB)) {
      this.resolveQuiz(gpA ? "A" : "B");
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
      if (this.menuSubScreen === "party_action") { this.updatePartyActionMenu(a, b, menu, dpad); return; }
      if (this.menuSubScreen === "mon_detail") { this.updateMonDetail(a, b, menu, dpad); return; }
      if (this.menuSubScreen === "bag" || this.menuSubScreen === "bag_target") { this.updateBagScreen(a, b, menu, dpad); return; }
      if (this.menuSubScreen === "zukan" || this.menuSubScreen === "zukan_detail") { this.updateZukanScreen(a, b, menu, dpad); return; }
      if (this.menuSubScreen === "settings") { this.updateSettingsScreen(a, b, menu, dpad); return; }
      if (b || menu) { this.closeSubScreen(); return; }
      // Sub-screen specific: save confirm
      if (this.menuSubScreen === "save" && a) { this.doSave(); return; }
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
        // いれかえ待ちでないときは、選んだアルモンのアクションメニューを開く。
        this.partyActionSel = 0;
        this.menuSubScreen = "party_action";
        this.drawPartyActionMenu();
      } else {
        if (this.partyPickIndex !== this.partySelIndex && this.playerState) {
          const p = this.playerState.party;
          const tmp = p[this.partyPickIndex];
          p[this.partyPickIndex] = p[this.partySelIndex];
          p[this.partySelIndex] = tmp;
        }
        this.partyPickIndex = -1;
        this.drawPartyScreen();
      }
      return;
    }
  }

  // ---- てもち: アクションメニュー（しょうさい / いれかえ / やめる） ----
  private static PARTY_ACTIONS = ["しょうさい", "いれかえ", "やめる"];

  private drawPartyActionMenu(): void {
    // 下地はパーティ画面をそのまま残し、右下に小さなメニューを重ねる。
    this.drawPartyScreen();
    this.menuSubScreen = "party_action";
    const W = this.scale.width, H = this.scale.height;
    const F = "'DotGothic16', monospace";
    const mw = 150, rowH = 34, pad = 10;
    const mh = pad * 2 + MapScene.PARTY_ACTIONS.length * rowH;
    const mx = W - mw - 12, my = H - mh - 44;
    const box = this.add.graphics().setScrollFactor(0).setDepth(214);
    box.fillStyle(0x0a1628, 0.98); box.fillRoundedRect(this.uiX(mx), this.uiY(my), this.uiS(mw), this.uiS(mh), this.uiS(8));
    box.lineStyle(2, 0x66aaff); box.strokeRoundedRect(this.uiX(mx), this.uiY(my), this.uiS(mw), this.uiS(mh), this.uiS(8));
    this.menuElements.push(box);
    MapScene.PARTY_ACTIONS.forEach((label, i) => {
      const y = my + pad + i * rowH + rowH / 2;
      const on = i === this.partyActionSel;
      if (on) {
        const hl = this.add.graphics().setScrollFactor(0).setDepth(215);
        hl.fillStyle(0x1b3a63, 0.95); hl.fillRoundedRect(this.uiX(mx + 5), this.uiY(y - rowH / 2 + 3), this.uiS(mw - 10), this.uiS(rowH - 6), 5);
        this.menuElements.push(hl);
      }
      const t = this.add.text(this.uiX(mx + 22), this.uiY(y), label, {
        fontSize: `${this.uiS(15)}px`, color: on ? "#ffffff" : "#cddaec", fontFamily: F, stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(216).setOrigin(0, 0.5);
      this.menuElements.push(t);
      if (on) {
        const car = this.add.text(this.uiX(mx + 8), this.uiY(y), "▶", {
          fontSize: `${this.uiS(13)}px`, color: "#8fd0ff", fontFamily: F,
        }).setScrollFactor(0).setDepth(216).setOrigin(0, 0.5);
        this.menuElements.push(car);
      }
    });
    this.applyTextResolution(this.menuElements);
  }

  private updatePartyActionMenu(a: boolean, b: boolean, menu: boolean, dpad: string | null): void {
    const n = MapScene.PARTY_ACTIONS.length;
    const justUp = (dpad === "up" || dpad === "left") && this.partyGpPrevDpad !== dpad;
    const justDown = (dpad === "down" || dpad === "right") && this.partyGpPrevDpad !== dpad;
    this.partyGpPrevDpad = dpad;
    let kbUp = false, kbDown = false, kbEnter = false;
    if (this.input.keyboard && this.cursors) {
      kbUp = Phaser.Input.Keyboard.JustDown(this.cursors.up) || Phaser.Input.Keyboard.JustDown(this.cursors.left);
      kbDown = Phaser.Input.Keyboard.JustDown(this.cursors.down) || Phaser.Input.Keyboard.JustDown(this.cursors.right);
      kbEnter = Phaser.Input.Keyboard.JustDown(this.input.keyboard.addKey("ENTER"));
    }
    if (b || menu) { this.menuSubScreen = "party"; this.drawPartyScreen(); return; }
    if (justUp || kbUp) { this.partyActionSel = (this.partyActionSel - 1 + n) % n; this.drawPartyActionMenu(); return; }
    if (justDown || kbDown) { this.partyActionSel = (this.partyActionSel + 1) % n; this.drawPartyActionMenu(); return; }
    if (a || kbEnter) {
      if (this.partyActionSel === 0) { this.monDetailPage = 0; this.menuSubScreen = "mon_detail"; this.drawMonDetail(); }
      else if (this.partyActionSel === 1) { this.partyPickIndex = this.partySelIndex; this.menuSubScreen = "party"; this.drawPartyScreen(); }
      else { this.menuSubScreen = "party"; this.drawPartyScreen(); }
      return;
    }
  }

  // ---- アルモン詳細ビュー（のうりょく / わざ の2ページ） ----
  private drawMonDetail(): void {
    this.menuSubScreen = "mon_detail";
    this.clearMenuElements();
    const W = this.scale.width, H = this.scale.height;
    const F = "'DotGothic16', monospace";
    const party = this.playerState?.party || [];
    if (party.length === 0) { this.menuSubScreen = "party"; this.drawPartyScreen(); return; }
    if (this.partySelIndex >= party.length) this.partySelIndex = party.length - 1;
    const inst = party[this.partySelIndex];
    ensureNatureGender(inst);
    const all = this.cache.json.get("monsters") as MonsterData[];
    refreshInstanceStats(inst, all);   // せいかく補正込みの能力値にそろえる（冪等）
    const allMoves = (this.cache.json.get("moves") || []) as MoveData[];
    ensureInstancePP(inst, allMoves);
    const data = all.find(m => m.id === inst.dataId);
    const dexNo = Math.max(0, all.findIndex(m => m.id === inst.dataId)) + 1;

    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.98); bg.fillRect(this.uiX(0), this.uiY(0), this.uiS(W), this.uiS(H));
    this.menuElements.push(bg);

    // ヘッダー：No.／タイトル／ページドット
    this.menuElements.push(this.add.text(this.uiX(20), this.uiY(20), `No.${String(dexNo).padStart(3, "0")}`, {
      fontSize: `${this.uiS(13)}px`, color: "#8fb4dc", fontFamily: F, stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(201));
    const pageTitles = ["じょうほう", "のうりょく", "わざ"];
    this.menuElements.push(this.add.text(this.uiX(W / 2), this.uiY(20), pageTitles[this.monDetailPage], {
      fontSize: `${this.uiS(18)}px`, color: "#66aaff", fontFamily: F, fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5));
    for (let p = 0; p < 3; p++) {
      const dot = this.add.graphics().setScrollFactor(0).setDepth(201);
      dot.fillStyle(p === this.monDetailPage ? 0x8fd0ff : 0x33465e, 1);
      dot.fillCircle(this.uiX(W / 2 - 28 + p * 28), this.uiY(46), this.uiS(5));
      this.menuElements.push(dot);
    }

    // 左：スプライト＋名前＋Lv＋タイプ（両ページ共通）
    const spCx = W * 0.26, spCy = 132;
    const key = `monster-${inst.dataId}`;
    if (this.textures.exists(key)) {
      const src = this.textures.get(key).getSourceImage() as { width: number; height: number };
      const img = this.add.image(this.uiX(spCx), this.uiY(spCy), key).setScrollFactor(0).setDepth(201).setOrigin(0.5);
      img.setScale(this.uiS(Math.min(W * 0.34, 120)) / Math.max(src.width, src.height));
      this.menuElements.push(img);
    }
    const nameX = W * 0.48;
    this.menuElements.push(this.add.text(this.uiX(nameX), this.uiY(86), data?.name ?? inst.dataId, {
      fontSize: `${this.uiS(20)}px`, color: "#ffffff", fontFamily: F, fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(201));
    this.menuElements.push(this.add.text(this.uiX(nameX), this.uiY(116), `Lv${inst.level}`, {
      fontSize: `${this.uiS(15)}px`, color: "#d8e6f6", fontFamily: F, stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(201));
    if (data) this.drawTypeBadge(nameX + 30, 150, data.type);

    if (this.monDetailPage === 0) {
      // じょうほう：タイプ・やくわり・ずかんせつめい・しんか・つかまえた
      const { seen, caught } = this.dexSets();
      const lx = W * 0.10, rx = W * 0.90;
      let y = 190;
      const kv = (label: string, val: string, valColor = "#ffffff") => {
        this.menuElements.push(this.add.text(this.uiX(lx), this.uiY(y), label, {
          fontSize: `${this.uiS(13)}px`, color: "#88bcff", fontFamily: F, stroke: "#000000", strokeThickness: 3,
        }).setScrollFactor(0).setDepth(202));
        this.menuElements.push(this.add.text(this.uiX(rx), this.uiY(y), val, {
          fontSize: `${this.uiS(14)}px`, color: valColor, fontFamily: F, fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
        }).setScrollFactor(0).setDepth(202).setOrigin(1, 0));
        y += 25;
      };
      kv("タイプ", data?.type ?? "？");
      kv("せいべつ", genderLabel(inst.gender), genderColor(inst.gender));
      kv("せいかく", inst.nature ?? "―", "#ffe08a");
      kv("やくわり", data?.role ?? "？");
      kv("ずかんばんごう", `No.${String(dexNo).padStart(3, "0")}`);
      kv("つかまえた", caught.has(inst.dataId) ? "○" : "―", caught.has(inst.dataId) ? "#8fe08f" : "#c0c8d0");
      // しんか
      let evoText = "これいじょう しんかしない";
      if (data?.evolution) {
        const to = all.find(x => x.id === data.evolution!.to);
        const toName = to && seen.has(to.id) ? to.name : "？？？";
        evoText = `Lv${data.evolution.level}で ${toName}に しんか`;
      }
      kv("しんか", evoText, "#9fe6c0");
      // ずかんせつめい（説明ボックス）
      y += 6;
      const boxH = 84;
      const box = this.add.graphics().setScrollFactor(0).setDepth(201);
      box.fillStyle(0x061020, 0.95); box.fillRoundedRect(this.uiX(lx - 12), this.uiY(y), this.uiS((rx - lx) + 24), this.uiS(boxH), this.uiS(8));
      box.lineStyle(2, 0x3a5680); box.strokeRoundedRect(this.uiX(lx - 12), this.uiY(y), this.uiS((rx - lx) + 24), this.uiS(boxH), this.uiS(8));
      this.menuElements.push(box);
      this.menuElements.push(this.add.text(this.uiX(lx), this.uiY(y + 12), data?.description ?? "", {
        fontSize: `${this.uiS(13)}px`, color: "#e0ecff", fontFamily: F, stroke: "#000000", strokeThickness: 3,
        wordWrap: { width: this.uiS((rx - lx)) }, lineSpacing: 5,
      }).setScrollFactor(0).setDepth(202));
    } else if (this.monDetailPage === 1) {
      // のうりょく：HP / こうげき / ぼうぎょ / すばやさ ＋ けいけんち＋ゲージ
      const st = inst.stats;
      const mod = inst.nature ? NATURE_MODS[inst.nature] : undefined;
      const rows: [string, string, "attack" | "defense" | "speed" | null][] = [
        ["HP", `${inst.currentHp} / ${inst.maxHp}`, null],
        ["こうげき", `${st.attack}`, "attack"],
        ["ぼうぎょ", `${st.defense}`, "defense"],
        ["すばやさ", `${st.speed}`, "speed"],
      ];
      const boxY = 200, rowH = 30, lx = W * 0.10, rx = W * 0.90;
      const box = this.add.graphics().setScrollFactor(0).setDepth(201);
      box.fillStyle(0x061020, 0.9); box.fillRoundedRect(this.uiX(lx - 12), this.uiY(boxY - 10), this.uiS((rx - lx) + 24), this.uiS(rows.length * rowH + 16), this.uiS(8));
      box.lineStyle(2, 0x3a5680); box.strokeRoundedRect(this.uiX(lx - 12), this.uiY(boxY - 10), this.uiS((rx - lx) + 24), this.uiS(rows.length * rowH + 16), this.uiS(8));
      this.menuElements.push(box);
      rows.forEach(([label, val, key], i) => {
        const y = boxY + i * rowH + 4;
        const isUp = key && mod?.up === key;
        const isDown = key && mod?.down === key;
        const arrow = isUp ? " ↑" : isDown ? " ↓" : "";
        const valColor = isUp ? "#8fe08f" : isDown ? "#ff9aa0" : "#ffffff";
        this.menuElements.push(this.add.text(this.uiX(lx), this.uiY(y), label, {
          fontSize: `${this.uiS(15)}px`, color: label === "HP" ? "#f8a830" : "#bcd0e6", fontFamily: F, fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
        }).setScrollFactor(0).setDepth(202));
        this.menuElements.push(this.add.text(this.uiX(rx), this.uiY(y), val + arrow, {
          fontSize: `${this.uiS(16)}px`, color: valColor, fontFamily: F, fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
        }).setScrollFactor(0).setDepth(202).setOrigin(1, 0));
      });
      // けいけんち＋つぎのレベルまでゲージ
      const expCur = getExpForLevel(inst.level);
      const expNext = getExpForLevel(inst.level + 1);
      const toNext = Math.max(0, expNext - inst.exp);
      const ratio = Phaser.Math.Clamp((inst.exp - expCur) / Math.max(1, expNext - expCur), 0, 1);
      const eY = boxY + rows.length * rowH + 22;
      this.menuElements.push(this.add.text(this.uiX(lx), this.uiY(eY), "けいけんち", {
        fontSize: `${this.uiS(13)}px`, color: "#88bcff", fontFamily: F, stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(202));
      this.menuElements.push(this.add.text(this.uiX(rx), this.uiY(eY), `${inst.exp}`, {
        fontSize: `${this.uiS(14)}px`, color: "#ffffff", fontFamily: F, stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(202).setOrigin(1, 0));
      this.menuElements.push(this.add.text(this.uiX(lx), this.uiY(eY + 24), "つぎのレベルまで", {
        fontSize: `${this.uiS(13)}px`, color: "#88bcff", fontFamily: F, stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(202));
      this.menuElements.push(this.add.text(this.uiX(rx), this.uiY(eY + 24), `${toNext}`, {
        fontSize: `${this.uiS(14)}px`, color: "#ffffff", fontFamily: F, stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(202).setOrigin(1, 0));
      // EXPゲージ
      const gY = eY + 46, gH = 10, gw = (rx - lx);
      const g = this.add.graphics().setScrollFactor(0).setDepth(202);
      g.fillStyle(0x14263c, 1); g.fillRoundedRect(this.uiX(lx), this.uiY(gY), this.uiS(gw), this.uiS(gH), this.uiS(gH / 2));
      const fillW = Math.max(0, Math.floor(gw * ratio));
      if (fillW > 3) { g.fillStyle(0x58a8e8, 1); g.fillRoundedRect(this.uiX(lx), this.uiY(gY), this.uiS(fillW), this.uiS(gH), this.uiS(gH / 2)); }
      this.menuElements.push(g);
    } else {
      // わざ：おぼえているわざ（タイプ＋名前＋いりょく＋せつめい）
      this.menuElements.push(this.add.text(this.uiX(W * 0.10), this.uiY(196), "おぼえている わざ", {
        fontSize: `${this.uiS(13)}px`, color: "#88bcff", fontFamily: F, stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(202));
      const startY = 224, rowH = Math.max(40, Math.floor((H - 60 - startY) / 4));
      const lx = W * 0.10, rx = W * 0.90;
      for (let i = 0; i < 4; i++) {
        const mvId = inst.moves[i];
        const y = startY + i * rowH;
        const box = this.add.graphics().setScrollFactor(0).setDepth(201);
        box.fillStyle(0x061020, 0.85); box.fillRoundedRect(this.uiX(lx - 12), this.uiY(y - 6), this.uiS((rx - lx) + 24), this.uiS(rowH - 8), this.uiS(6));
        box.lineStyle(1, 0x2c4560); box.strokeRoundedRect(this.uiX(lx - 12), this.uiY(y - 6), this.uiS((rx - lx) + 24), this.uiS(rowH - 8), this.uiS(6));
        this.menuElements.push(box);
        if (!mvId) {
          this.menuElements.push(this.add.text(this.uiX(lx), this.uiY(y + 8), "―", {
            fontSize: `${this.uiS(15)}px`, color: "#66788c", fontFamily: F,
          }).setScrollFactor(0).setDepth(202));
          continue;
        }
        const mv = allMoves.find(x => x.id === mvId);
        const nm = mv?.name ?? mvId;
        if (mv) this.drawTypeBadge(lx + 26, y + 12, mv.type);
        this.menuElements.push(this.add.text(this.uiX(lx + 58), this.uiY(y + 4), nm, {
          fontSize: `${this.uiS(15)}px`, color: "#ffffff", fontFamily: F, fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
        }).setScrollFactor(0).setDepth(202));
        const pw = mv ? (mv.isSupport ? "ほじょ" : `いりょく ${mv.power}`) : "";
        this.menuElements.push(this.add.text(this.uiX(rx), this.uiY(y + 4), pw, {
          fontSize: `${this.uiS(12)}px`, color: "#ffd98a", fontFamily: F, stroke: "#000000", strokeThickness: 3,
        }).setScrollFactor(0).setDepth(202).setOrigin(1, 0));
        const curPP = inst.pp ? inst.pp[i] : moveMaxPP(mvId, allMoves);
        this.menuElements.push(this.add.text(this.uiX(rx), this.uiY(y + 22), `PP ${curPP}/${moveMaxPP(mvId, allMoves)}`, {
          fontSize: `${this.uiS(11)}px`, color: "#bcd0e6", fontFamily: F, stroke: "#000000", strokeThickness: 2,
        }).setScrollFactor(0).setDepth(202).setOrigin(1, 0));
        this.menuElements.push(this.add.text(this.uiX(lx + 58), this.uiY(y + 22), mv?.description ?? "", {
          fontSize: `${this.uiS(11)}px`, color: "#c6d6ea", fontFamily: F, stroke: "#000000", strokeThickness: 2,
          wordWrap: { width: this.uiS((rx - lx) - 58) },
        }).setScrollFactor(0).setDepth(202));
      }
    }

    this.menuElements.push(this.add.text(this.uiX(W / 2), this.uiY(H - 22), "Aボタン:きりかえ   ↑↓:べつのアルモン   Bボタンでもどる", {
      fontSize: `${this.uiS(11)}px`, color: "#ffffff", fontFamily: F, stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(202).setOrigin(0.5));
    this.applyTextResolution(this.menuElements);
  }

  private updateMonDetail(a: boolean, b: boolean, menu: boolean, dpad: string | null): void {
    const n = this.playerState?.party.length || 0;
    const justUp = (dpad === "up" || dpad === "left") && this.partyGpPrevDpad !== dpad;
    const justDown = (dpad === "down" || dpad === "right") && this.partyGpPrevDpad !== dpad;
    this.partyGpPrevDpad = dpad;
    let kbUp = false, kbDown = false, kbEnter = false;
    if (this.input.keyboard && this.cursors) {
      kbUp = Phaser.Input.Keyboard.JustDown(this.cursors.up) || Phaser.Input.Keyboard.JustDown(this.cursors.left);
      kbDown = Phaser.Input.Keyboard.JustDown(this.cursors.down) || Phaser.Input.Keyboard.JustDown(this.cursors.right);
      kbEnter = Phaser.Input.Keyboard.JustDown(this.input.keyboard.addKey("ENTER"));
    }
    if (b || menu) { this.menuSubScreen = "party"; this.drawPartyScreen(); return; }
    if ((justUp || kbUp) && n > 0) { this.partySelIndex = (this.partySelIndex - 1 + n) % n; this.drawMonDetail(); return; }
    if ((justDown || kbDown) && n > 0) { this.partySelIndex = (this.partySelIndex + 1) % n; this.drawMonDetail(); return; }
    if (a || kbEnter) { this.monDetailPage = (this.monDetailPage + 1) % 3; this.drawMonDetail(); return; }
  }

  private selectMenuItem(): void {
    switch (this.menuSelectedIndex) {
      case 0: this.showZukanScreen(); break;
      case 1: this.showPartyScreen(); break;
      case 2: this.showBagScreen(); break;
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
        picking ? "いれかえる あいてを えらんで" : "アルモンを えらんで（A：メニュー）", {
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
    const leadFainted = lead.currentHp <= 0;
    if (leadData) {
      const card = this.add.graphics().setScrollFactor(0).setDepth(201);
      // Orange highlight border
      card.lineStyle(3, 0xf8a830);
      card.strokeRoundedRect(this.uiX(leadX - 3), this.uiY(leadY - 3), this.uiS(leadW + 6), this.uiS(leadH + 6), this.uiS(10));
      // Inner panel（ひんし時は赤背景でひと目でわかるように）
      card.fillStyle(leadFainted ? 0xc0443c : 0x4080c0);
      card.fillRoundedRect(this.uiX(leadX), this.uiY(leadY), this.uiS(leadW), this.uiS(leadH), this.uiS(8));
      card.fillStyle(leadFainted ? 0xd86058 : 0x58a0e0, 0.4);
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

      // ひんしバッジ（右上）
      if (leadFainted) {
        this.menuElements.push(
          this.add.text(this.uiX(leadX + leadW - pad), this.uiY(leadY + pad), "ひんし", {
            fontSize: `${this.uiS(Math.round(leadH * 0.05))}px`, color: "#fff0f0", fontFamily: F, fontStyle: "bold", ...STK,
          }).setScrollFactor(0).setDepth(205).setOrigin(1, 0)
        );
      }

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

      const fainted = mon.currentHp <= 0;

      // Row card（ひんし時は赤背景でひと目でわかるように）
      const card = this.add.graphics().setScrollFactor(0).setDepth(201);
      card.fillStyle(fainted ? 0xc85850 : 0x5898d0);
      card.fillRoundedRect(this.uiX(cx), this.uiY(cy), this.uiS(rightW), this.uiS(rightSlotH), this.uiS(5));
      card.fillStyle(fainted ? 0xe07868 : 0x68a8e0, 0.3);
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

      // Row 1: name + Lv (left, auto-shrink) と 現在HP/最大HP（右端）。
      // HP数値を1行目に置くことで、下のHP/EXPバーはカード幅いっぱいの
      // 長いバーにして見やすくする。ひんし時は数値の代わりに「ひんし」。
      const tx = cx + rightIconSize + Math.round(10 * s);
      const row1Y = cy + Math.round(4 * s);
      // 名前＋Lv（1行目・左）。数値と競合しないよう行を独占。長い名前は
      // 実測幅でカードに収まるところまで自動縮小する。
      const nameStr = `${data.name}  Lv${mon.level}`;
      const nameText = this.add.text(this.uiX(tx), this.uiY(row1Y), nameStr, {
        fontSize: `${this.uiS(12 * fsScale)}px`, color: "#ffffff", fontFamily: F, fontStyle: "bold", ...STK2,
      }).setScrollFactor(0).setDepth(204);
      const nameAvailPx = (this.uiX(cx + rightW - 6) - this.uiS(4)) - this.uiX(tx);
      if (nameText.width > nameAvailPx && nameAvailPx > 0) {
        nameText.setFontSize(Math.max(8, Math.floor(this.uiS(12 * fsScale) * nameAvailPx / nameText.width)));
      }
      this.menuElements.push(nameText);

      // 2行目：HPラベル＋カード幅いっぱいの長いHPバー。現在HP/最大HP（または
      // ひんし）はバー右端に重ねて表示し、バーを短くしないで見やすく保つ。
      const row2Y = cy + Math.round(22 * s);
      const rBarH = Math.max(9, Math.round(11 * s));
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
      // 現在HP/最大HP（ひんし時は「ひんし」）をHPバー右端に重ねて表示
      this.menuElements.push(
        this.add.text(this.uiX(hpBarEndX - 4), this.uiY(row2Y + 2 + rBarH / 2),
          fainted ? "ひんし" : `${mon.currentHp}/${mon.maxHp}`, {
          fontSize: fs(9), color: "#ffffff", fontFamily: F, fontStyle: "bold",
          stroke: "#000000", strokeThickness: 3,
        }).setScrollFactor(0).setDepth(204).setOrigin(1, 0.5)
      );
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

  // ---- Zukan (ずかん) Screen ----
  private static ZUKAN_TYPE_COLOR: Record<string, number> = {
    "光": 0xffe066, "影": 0x9b7bd0, "炎": 0xff7a4d, "氷": 0x7fdfff,
    "ガス": 0xa6d96a, "砂": 0xe0c088, "電": 0xffd23f, "金属": 0xb8c0cc,
  };

  /** Union of explicit ずかん records with currently-owned monsters. */
  private dexSets(): { seen: Set<string>; caught: Set<string> } {
    const ps = this.playerState;
    const caught = new Set<string>(ps?.caught || []);
    (ps?.party || []).forEach(m => caught.add(m.dataId));
    (ps?.box || []).forEach(m => caught.add(m.dataId));
    const seen = new Set<string>([...(ps?.seen || []), ...caught]);
    return { seen, caught };
  }

  private showZukanScreen(): void {
    this.zukanSelIndex = 0;
    this.zukanScrollTop = 0;
    this.zukanGpPrevDpad = null;
    this.drawZukanScreen();
  }

  private drawTypeBadge(cx: number, cy: number, type: string): void {
    const F = "'DotGothic16', monospace";
    const col = MapScene.ZUKAN_TYPE_COLOR[type] ?? 0x778899;
    const w = 52, h = 22;
    const g = this.add.graphics().setScrollFactor(0).setDepth(202);
    g.fillStyle(col, 0.9); g.fillRoundedRect(this.uiX(cx - w / 2), this.uiY(cy - h / 2), this.uiS(w), this.uiS(h), 6);
    this.menuElements.push(g);
    const t = this.add.text(this.uiX(cx), this.uiY(cy), type, {
      fontSize: `${this.uiS(12)}px`, color: "#101820", fontFamily: F, fontStyle: "bold",
    }).setScrollFactor(0).setDepth(203).setOrigin(0.5);
    this.menuElements.push(t);
  }

  private drawZukanScreen(): void {
    this.menuSubScreen = "zukan";
    this.clearMenuElements();
    const W = this.scale.width, H = this.scale.height;
    const F = "'DotGothic16', monospace";
    const all = this.cache.json.get("monsters") as MonsterData[];
    const { seen, caught } = this.dexSets();

    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.97); bg.fillRect(this.uiX(0), this.uiY(0), this.uiS(W), this.uiS(H));
    this.menuElements.push(bg);

    const title = this.add.text(this.uiX(W / 2), this.uiY(24), "ずかん", {
      fontSize: `${this.uiS(20)}px`, color: "#66aaff", fontFamily: F, fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    const counts = this.add.text(this.uiX(W / 2), this.uiY(48), `みつけた ${seen.size}   つかまえた ${caught.size} / ${all.length}`, {
      fontSize: `${this.uiS(12)}px`, color: "#c9d8ec", fontFamily: F, stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(title, counts);

    const rowH = 34, listTop = 70;
    const visible = Math.max(4, Math.floor((H - listTop - 44) / rowH));
    if (this.zukanSelIndex < this.zukanScrollTop) this.zukanScrollTop = this.zukanSelIndex;
    if (this.zukanSelIndex >= this.zukanScrollTop + visible) this.zukanScrollTop = this.zukanSelIndex - visible + 1;

    for (let r = 0; r < visible; r++) {
      const idx = this.zukanScrollTop + r;
      if (idx >= all.length) break;
      const m = all[idx];
      const y = listTop + r * rowH;
      const on = idx === this.zukanSelIndex;
      const isSeen = seen.has(m.id);
      const isCaught = caught.has(m.id);
      if (on) {
        const hl = this.add.graphics().setScrollFactor(0).setDepth(201);
        hl.fillStyle(0x1b3a63, 0.9); hl.fillRoundedRect(this.uiX(24), this.uiY(y - 4), this.uiS(W - 48), this.uiS(rowH - 4), 6);
        this.menuElements.push(hl);
      }
      const mark = isCaught ? "●" : (isSeen ? "◦" : "　");
      const num = String(idx + 1).padStart(3, "0");
      const label = `${mark} No.${num}  ${isSeen ? m.name : "？？？？"}`;
      const row = this.add.text(this.uiX(40), this.uiY(y), label, {
        fontSize: `${this.uiS(15)}px`, color: on ? "#ffffff" : (isSeen ? "#ccddee" : "#66788c"), fontFamily: F, stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(202);
      this.menuElements.push(row);
      if (isSeen) this.drawTypeBadge(W - 60, y + 8, m.type);
    }

    // Scroll hints
    if (this.zukanScrollTop > 0) {
      const up = this.add.text(this.uiX(W / 2), this.uiY(listTop - 14), "▲", { fontSize: `${this.uiS(12)}px`, color: "#8fd0ff", fontFamily: F }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
      this.menuElements.push(up);
    }
    if (this.zukanScrollTop + visible < all.length) {
      const dn = this.add.text(this.uiX(W / 2), this.uiY(listTop + visible * rowH - 6), "▼", { fontSize: `${this.uiS(12)}px`, color: "#8fd0ff", fontFamily: F }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
      this.menuElements.push(dn);
    }

    const hint = this.add.text(this.uiX(W / 2), this.uiY(H - 26), "A:くわしく   Bボタンでもどる", {
      fontSize: `${this.uiS(12)}px`, color: "#ffffff", fontFamily: F, stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
    this.menuElements.push(hint);
    this.applyTextResolution(this.menuElements);
  }

  private drawZukanDetail(): void {
    this.menuSubScreen = "zukan_detail";
    this.clearMenuElements();
    const W = this.scale.width, H = this.scale.height;
    const F = "'DotGothic16', monospace";
    const all = this.cache.json.get("monsters") as MonsterData[];
    const m = all[this.zukanSelIndex];
    const { seen } = this.dexSets();
    const isSeen = seen.has(m.id);

    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.98); bg.fillRect(this.uiX(0), this.uiY(0), this.uiS(W), this.uiS(H));
    this.menuElements.push(bg);

    const num = String(this.zukanSelIndex + 1).padStart(3, "0");
    const header = this.add.text(this.uiX(24), this.uiY(24), `No.${num}`, {
      fontSize: `${this.uiS(15)}px`, color: "#8fb4dc", fontFamily: F, stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(201);
    this.menuElements.push(header);

    if (!isSeen) {
      const q = this.add.text(this.uiX(W / 2), this.uiY(H / 2 - 20), "？？？？", {
        fontSize: `${this.uiS(24)}px`, color: "#66788c", fontFamily: F, fontStyle: "bold",
      }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
      const note = this.add.text(this.uiX(W / 2), this.uiY(H / 2 + 16), "まだ みつけていない。", {
        fontSize: `${this.uiS(13)}px`, color: "#8899aa", fontFamily: F,
      }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
      this.menuElements.push(q, note);
    } else {
      const name = this.add.text(this.uiX(W / 2), this.uiY(28), m.name, {
        fontSize: `${this.uiS(22)}px`, color: "#ffffff", fontFamily: F, fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
      this.menuElements.push(name);
      this.drawTypeBadge(W / 2, 58, m.type);

      // Sprite
      const key = `monster-${m.id}`;
      if (this.textures.exists(key)) {
        const src = this.textures.get(key).getSourceImage() as { width: number; height: number };
        const img = this.add.image(this.uiX(W / 2), this.uiY(150), key).setScrollFactor(0).setDepth(201).setOrigin(0.5);
        const target = this.uiS(120);
        img.setScale(target / Math.max(src.width, src.height));
        this.menuElements.push(img);
      }

      const role = this.add.text(this.uiX(W / 2), this.uiY(222), `タイプ: ${m.type}  /  ${m.role}`, {
        fontSize: `${this.uiS(13)}px`, color: "#c9d8ec", fontFamily: F, stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
      this.menuElements.push(role);

      // Description box
      const descY = 248;
      const box = this.add.graphics().setScrollFactor(0).setDepth(201);
      box.fillStyle(0x061020, 0.95); box.fillRoundedRect(this.uiX(24), this.uiY(descY), this.uiS(W - 48), this.uiS(70), 8);
      box.lineStyle(2, 0x3a5680); box.strokeRoundedRect(this.uiX(24), this.uiY(descY), this.uiS(W - 48), this.uiS(70), 8);
      this.menuElements.push(box);
      const desc = this.add.text(this.uiX(38), this.uiY(descY + 12), m.description || "", {
        fontSize: `${this.uiS(13)}px`, color: "#e0ecff", fontFamily: F, stroke: "#000000", strokeThickness: 3,
        wordWrap: { width: this.uiS(W - 76) }, lineSpacing: 4,
      }).setScrollFactor(0).setDepth(202);
      this.menuElements.push(desc);

      // Stats (statsAt50) + evolution hint
      const s = m.statsAt50;
      if (s) {
        const statY = descY + 84;
        const statLine = `Lv50  HP ${s.hp}  こう ${s.attack}  ぼう ${s.defense}  すば ${s.speed}`;
        const st = this.add.text(this.uiX(W / 2), this.uiY(statY), statLine, {
          fontSize: `${this.uiS(12)}px`, color: "#aabbcc", fontFamily: F, stroke: "#000000", strokeThickness: 3,
        }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
        this.menuElements.push(st);
      }
      if (m.evolution) {
        const evoTo = all.find(x => x.id === m.evolution!.to);
        const evo = this.add.text(this.uiX(W / 2), this.uiY(descY + 106),
          `Lv${m.evolution.level}で ${seen.has(m.evolution.to) && evoTo ? evoTo.name : "？？？"}に しんか`, {
          fontSize: `${this.uiS(12)}px`, color: "#88ccaa", fontFamily: F, stroke: "#000000", strokeThickness: 3,
        }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
        this.menuElements.push(evo);
      }
    }

    const hint = this.add.text(this.uiX(W / 2), this.uiY(H - 24), "↑↓:きりかえ   Bボタンでもどる", {
      fontSize: `${this.uiS(12)}px`, color: "#ffffff", fontFamily: F, stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
    this.menuElements.push(hint);
    this.applyTextResolution(this.menuElements);
  }

  private updateZukanScreen(a: boolean, b: boolean, menu: boolean, dpad: string | null): void {
    const all = this.cache.json.get("monsters") as MonsterData[];
    const justUp = dpad === "up" && this.zukanGpPrevDpad !== "up";
    const justDown = dpad === "down" && this.zukanGpPrevDpad !== "down";
    let kbUp = false, kbDown = false;
    if (this.input.keyboard && this.cursors) {
      kbUp = Phaser.Input.Keyboard.JustDown(this.cursors.up);
      kbDown = Phaser.Input.Keyboard.JustDown(this.cursors.down);
    }
    this.zukanGpPrevDpad = dpad;

    if (this.menuSubScreen === "zukan_detail") {
      if (b || menu) { this.drawZukanScreen(); return; }
      if (justUp || kbUp) { this.zukanSelIndex = (this.zukanSelIndex - 1 + all.length) % all.length; this.drawZukanDetail(); return; }
      if (justDown || kbDown) { this.zukanSelIndex = (this.zukanSelIndex + 1) % all.length; this.drawZukanDetail(); return; }
      return;
    }

    // list
    if (b || menu) { this.closeSubScreen(); return; }
    if (justUp || kbUp) { this.zukanSelIndex = (this.zukanSelIndex - 1 + all.length) % all.length; this.drawZukanScreen(); return; }
    if (justDown || kbDown) { this.zukanSelIndex = (this.zukanSelIndex + 1) % all.length; this.drawZukanScreen(); return; }
    if (a) {
      const { seen } = this.dexSets();
      if (seen.has(all[this.zukanSelIndex].id)) this.drawZukanDetail();
    }
  }

  // ---- Bag (どうぐ) Screen ----
  private ownedItems(): { id: string; count: number; name: string; description: string; category?: string }[] {
    const all = (this.cache.json.get("items") as { id: string; name: string; description: string; price: number; category?: string }[]) || [];
    const rank: Record<string, number> = { recovery: 0, capsule: 1 };
    const out: { id: string; count: number; name: string; description: string; category?: string }[] = [];
    for (const it of (this.playerState?.items || [])) {
      if (it.count <= 0) continue;
      const d = all.find(a => a.id === it.id);
      if (!d) continue;
      out.push({ id: it.id, count: it.count, name: d.name, description: d.description, category: d.category });
    }
    out.sort((a, b) => (rank[a.category ?? "z"] ?? 9) - (rank[b.category ?? "z"] ?? 9));
    return out;
  }

  private showBagScreen(): void {
    this.bagSelIndex = 0;
    this.bagTargetIndex = 0;
    this.bagGpPrevDpad = null;
    this.bagMessage = "";
    this.drawBagScreen();
  }

  private drawBagScreen(): void {
    this.menuSubScreen = "bag";
    this.clearMenuElements();
    const W = this.scale.width, H = this.scale.height;
    const F = "'DotGothic16', monospace";

    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.97); bg.fillRect(this.uiX(0), this.uiY(0), this.uiS(W), this.uiS(H));
    this.menuElements.push(bg);

    const title = this.add.text(this.uiX(W / 2), this.uiY(28), "どうぐ", {
      fontSize: `${this.uiS(20)}px`, color: "#66aaff", fontFamily: F, fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(title);

    const items = this.ownedItems();
    if (items.length === 0) {
      const empty = this.add.text(this.uiX(W / 2), this.uiY(H / 2), "なにも もっていない。", {
        fontSize: `${this.uiS(15)}px`, color: "#ccddee", fontFamily: F, stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
      this.menuElements.push(empty);
    } else {
      if (this.bagSelIndex >= items.length) this.bagSelIndex = items.length - 1;
      const listX = 40, listTop = 64, rowH = 30, iconSize = 22;
      items.forEach((it, i) => {
        const y = listTop + i * rowH;
        const on = i === this.bagSelIndex;
        if (on) {
          const hl = this.add.graphics().setScrollFactor(0).setDepth(201);
          hl.fillStyle(0x1b3a63, 0.9); hl.fillRoundedRect(this.uiX(listX - 8), this.uiY(y - 4), this.uiS(W - (listX - 8) * 2), this.uiS(rowH - 4), 6);
          this.menuElements.push(hl);
        }
        // 先頭に▶（選択中）＋アイテムアイコン、その右に名前。
        const caret = this.add.text(this.uiX(listX), this.uiY(y), on ? "▶" : " ", {
          fontSize: `${this.uiS(15)}px`, color: on ? "#ffffff" : "#ccddee", fontFamily: F, stroke: "#000000", strokeThickness: 3,
        }).setScrollFactor(0).setDepth(202);
        const iconX = listX + 20;
        const iconKey = ensureItemIconTexture(this, it.id, it.category);
        const icon = this.add.image(this.uiX(iconX + iconSize / 2), this.uiY(y + 8), iconKey)
          .setScrollFactor(0).setDepth(202).setDisplaySize(this.uiS(iconSize), this.uiS(iconSize));
        this.menuElements.push(caret, icon);
        const name = this.add.text(this.uiX(iconX + iconSize + 6), this.uiY(y), it.name, {
          fontSize: `${this.uiS(15)}px`, color: on ? "#ffffff" : "#ccddee", fontFamily: F, stroke: "#000000", strokeThickness: 3,
        }).setScrollFactor(0).setDepth(202);
        const cnt = this.add.text(this.uiX(W - 52), this.uiY(y), `×${it.count}`, {
          fontSize: `${this.uiS(15)}px`, color: on ? "#ffffff" : "#aabbcc", fontFamily: F, stroke: "#000000", strokeThickness: 3,
        }).setScrollFactor(0).setDepth(202).setOrigin(1, 0);
        this.menuElements.push(name, cnt);
      });

      // Description box for the selected item
      const sel = items[this.bagSelIndex];
      const descY = listTop + items.length * rowH + 16;
      const box = this.add.graphics().setScrollFactor(0).setDepth(201);
      box.fillStyle(0x061020, 0.95); box.fillRoundedRect(this.uiX(28), this.uiY(descY), this.uiS(W - 56), this.uiS(64), 8);
      box.lineStyle(2, 0x3a5680); box.strokeRoundedRect(this.uiX(28), this.uiY(descY), this.uiS(W - 56), this.uiS(64), 8);
      this.menuElements.push(box);
      const desc = this.add.text(this.uiX(40), this.uiY(descY + 12), sel.description, {
        fontSize: `${this.uiS(13)}px`, color: "#d6e4f5", fontFamily: F, stroke: "#000000", strokeThickness: 3,
        wordWrap: { width: this.uiS(W - 80) },
      }).setScrollFactor(0).setDepth(202);
      this.menuElements.push(desc);
    }

    const hint = this.add.text(this.uiX(W / 2), this.uiY(H - 28),
      items.length > 0 ? "A:つかう   Bボタンでもどる" : "Bボタンでもどる", {
      fontSize: `${this.uiS(12)}px`, color: "#ffffff", fontFamily: F, stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
    this.menuElements.push(hint);

    if (this.bagMessage) this.drawBagMessage();
    this.applyTextResolution(this.menuElements);
  }

  private drawBagMessage(): void {
    const W = this.scale.width, H = this.scale.height;
    const F = "'DotGothic16', monospace";
    const box = this.add.graphics().setScrollFactor(0).setDepth(210);
    box.fillStyle(0x000000, 0.6); box.fillRect(this.uiX(0), this.uiY(0), this.uiS(W), this.uiS(H));
    box.fillStyle(0x11326a, 0.98); box.fillRoundedRect(this.uiX(30), this.uiY(H / 2 - 40), this.uiS(W - 60), this.uiS(80), 10);
    box.lineStyle(2, 0x8fd0ff); box.strokeRoundedRect(this.uiX(30), this.uiY(H / 2 - 40), this.uiS(W - 60), this.uiS(80), 10);
    this.menuElements.push(box);
    const t = this.add.text(this.uiX(W / 2), this.uiY(H / 2 - 8), this.bagMessage, {
      fontSize: `${this.uiS(14)}px`, color: "#ffffff", fontFamily: F, stroke: "#000000", strokeThickness: 3,
      align: "center", wordWrap: { width: this.uiS(W - 90) },
    }).setScrollFactor(0).setDepth(211).setOrigin(0.5);
    const ok = this.add.text(this.uiX(W / 2), this.uiY(H / 2 + 22), "A / B でとじる", {
      fontSize: `${this.uiS(11)}px`, color: "#cfe0f5", fontFamily: F, stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(211).setOrigin(0.5);
    this.menuElements.push(t, ok);
  }

  private drawBagTargetScreen(): void {
    this.menuSubScreen = "bag_target";
    this.clearMenuElements();
    const W = this.scale.width, H = this.scale.height;
    const F = "'DotGothic16', monospace";
    const allMonsters = this.cache.json.get("monsters") as MonsterData[];
    const party = this.playerState?.party || [];

    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.97); bg.fillRect(this.uiX(0), this.uiY(0), this.uiS(W), this.uiS(H));
    this.menuElements.push(bg);

    const title = this.add.text(this.uiX(W / 2), this.uiY(28), "だれに つかう？", {
      fontSize: `${this.uiS(18)}px`, color: "#66aaff", fontFamily: F, fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(title);

    const listTop = 64, rowH = 44;
    party.forEach((m, i) => {
      const d = allMonsters.find(md => md.id === m.dataId);
      const y = listTop + i * rowH;
      const on = i === this.bagTargetIndex;
      const fainted = m.currentHp <= 0;
      if (on) {
        const hl = this.add.graphics().setScrollFactor(0).setDepth(201);
        hl.fillStyle(0x1b3a63, 0.9); hl.fillRoundedRect(this.uiX(28), this.uiY(y - 4), this.uiS(W - 56), this.uiS(rowH - 6), 6);
        this.menuElements.push(hl);
      }
      const name = this.add.text(this.uiX(44), this.uiY(y), `${on ? "▶ " : "  "}${d?.name ?? m.dataId}  Lv${m.level}`, {
        fontSize: `${this.uiS(15)}px`, color: on ? "#ffffff" : "#ccddee", fontFamily: F, stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(202);
      const hp = this.add.text(this.uiX(W - 44), this.uiY(y), `HP ${m.currentHp}/${m.maxHp}`, {
        fontSize: `${this.uiS(13)}px`, color: fainted ? "#ff8888" : (on ? "#ffffff" : "#aabbcc"), fontFamily: F, stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(202).setOrigin(1, 0);
      this.menuElements.push(name, hp);
    });

    const hint = this.add.text(this.uiX(W / 2), this.uiY(H - 28), "A:つかう   Bボタンでもどる", {
      fontSize: `${this.uiS(12)}px`, color: "#ffffff", fontFamily: F, stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
    this.menuElements.push(hint);

    if (this.bagMessage) this.drawBagMessage();
    this.applyTextResolution(this.menuElements);
  }

  /** Apply a recovery item to a party member. Returns a result message; ok=false means it wasn't consumed. */
  private applyRecoveryItem(itemId: string, m: MonsterInstance, itemName: string): { ok: boolean; msg: string } {
    const nameOf = (): string => {
      const all = this.cache.json.get("monsters") as MonsterData[];
      return all.find(md => md.id === m.dataId)?.name ?? m.dataId;
    };
    if (itemId === "revive_star") {
      if (m.currentHp > 0) return { ok: false, msg: "ひんしの アルモンにしか\nつかえない！" };
      m.currentHp = Math.max(1, Math.floor(m.maxHp / 2));
      return { ok: true, msg: `${nameOf()}は げんきを とりもどした！` };
    }
    // HP recovery gels
    if (m.currentHp <= 0) return { ok: false, msg: "ひんしの アルモンには\nつかえない！" };
    if (m.currentHp >= m.maxHp) return { ok: false, msg: "HPは まんたんだ！" };
    const amount = itemId === "repair_gel" ? 20 : itemId === "hi_repair_gel" ? 50
      : itemId === "moon_honey" ? 40 : m.maxHp;
    const before = m.currentHp;
    m.currentHp = Math.min(m.maxHp, m.currentHp + amount);
    return { ok: true, msg: `${nameOf()}の HPが ${m.currentHp - before} かいふくした！\n（${itemName}）` };
  }

  private consumeItem(itemId: string): void {
    if (!this.playerState) return;
    const entry = this.playerState.items.find(it => it.id === itemId);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count <= 0) this.playerState.items = this.playerState.items.filter(it => it.count > 0);
  }

  private updateBagScreen(a: boolean, b: boolean, menu: boolean, dpad: string | null): void {
    // A message popup swallows the next input and closes.
    if (this.bagMessage) {
      if (a || b || menu) {
        this.bagMessage = "";
        if (this.menuSubScreen === "bag_target") this.drawBagTargetScreen();
        else this.drawBagScreen();
      }
      this.bagGpPrevDpad = dpad;
      return;
    }

    const justUp = dpad === "up" && this.bagGpPrevDpad !== "up";
    const justDown = dpad === "down" && this.bagGpPrevDpad !== "down";
    let kbUp = false, kbDown = false;
    if (this.input.keyboard && this.cursors) {
      kbUp = Phaser.Input.Keyboard.JustDown(this.cursors.up);
      kbDown = Phaser.Input.Keyboard.JustDown(this.cursors.down);
    }
    this.bagGpPrevDpad = dpad;

    if (this.menuSubScreen === "bag_target") {
      const party = this.playerState?.party || [];
      if (b || menu) { this.drawBagScreen(); return; }
      if (justUp || kbUp) { this.bagTargetIndex = (this.bagTargetIndex - 1 + party.length) % party.length; this.drawBagTargetScreen(); return; }
      if (justDown || kbDown) { this.bagTargetIndex = (this.bagTargetIndex + 1) % party.length; this.drawBagTargetScreen(); return; }
      if (a) {
        const items = this.ownedItems();
        const sel = items[this.bagSelIndex];
        const target = party[this.bagTargetIndex];
        if (sel && target) {
          const res = this.applyRecoveryItem(sel.id, target, sel.name);
          if (res.ok) this.consumeItem(sel.id);
          this.bagMessage = res.msg;
          // If that item ran out, return to the bag list after the message.
          const stillOwned = (this.playerState?.items || []).some(it => it.id === sel.id && it.count > 0);
          if (res.ok && !stillOwned) this.menuSubScreen = "bag";
          if (this.menuSubScreen === "bag_target") this.drawBagTargetScreen(); else this.drawBagScreen();
        }
      }
      return;
    }

    // menuSubScreen === "bag"
    if (b || menu) { this.closeSubScreen(); return; }
    const items = this.ownedItems();
    if (justUp || kbUp) { if (items.length) { this.bagSelIndex = (this.bagSelIndex - 1 + items.length) % items.length; this.drawBagScreen(); } return; }
    if (justDown || kbDown) { if (items.length) { this.bagSelIndex = (this.bagSelIndex + 1) % items.length; this.drawBagScreen(); } return; }
    if (a && items.length) {
      const sel = items[this.bagSelIndex];
      if (sel.category === "recovery") {
        if ((this.playerState?.party.length || 0) === 0) { this.bagMessage = "つかう アルモンが いない！"; this.drawBagScreen(); return; }
        this.bagTargetIndex = 0;
        this.drawBagTargetScreen();
      } else if (sel.category === "capsule") {
        this.bagMessage = "いまは つかえない！\n（バトル中に つかおう）";
        this.drawBagScreen();
      } else {
        this.bagMessage = "たいせつな どうぐの ようだ。";
        this.drawBagScreen();
      }
    }
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

  private writeSaveData(): boolean {
    try {
      localStorage.setItem("usamon-save-data", JSON.stringify({
        playerState: this.playerState,
        mapKey: this.currentMapKey,
        gridX: this.gridX,
        gridY: this.gridY,
        timestamp: Date.now(),
      }));
      return true;
    } catch { return false; }
  }

  // ---- オートレポート: 15分ごとに安全なタイミングで自動セーブ ----
  private static AUTOSAVE_INTERVAL_MS = 15 * 60 * 1000;

  private maybeAutoSave(): void {
    if (!this.playerState) return;
    const now = Date.now();
    // registry はシーン再起動（戦闘・ワープ）をまたいで生きる
    const next = this.registry.get("autosaveNext") as number | undefined;
    if (next === undefined) {
      this.registry.set("autosaveNext", now + MapScene.AUTOSAVE_INTERVAL_MS);
      return;
    }
    if (now < next) return;
    // 会話・カットシーン・メニュー・移動中などは見送り、安全になった次のフレームで保存
    if (this.dialogActive || this.inCutscene || this.isWarping || this.startingBattle ||
        this.trainerApproaching || this.menuOpen || this.shopOpen || this.isMoving ||
        this.quizAwaiting) return;
    if (!this.writeSaveData()) return;
    this.registry.set("autosaveNext", now + MapScene.AUTOSAVE_INTERVAL_MS);
    this.showAutoSaveToast();
  }

  private showAutoSaveToast(): void {
    const t = this.add.text(this.uiX(this.scale.width / 2), this.uiY(62),
      "オートレポートに きろくしました！", {
        fontSize: `${this.uiS(13)}px`, color: "#aef0c8",
        fontFamily: "'DotGothic16', monospace", stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(205).setOrigin(0.5).setAlpha(0);
    this.applyTextResolution([t]);
    this.tweens.add({ targets: t, alpha: 1, duration: 250, yoyo: true, hold: 1700,
      onComplete: () => t.destroy() });
  }

  private doSave(): void {
    this.writeSaveData();
    // 手動レポート直後にオートレポートが重ならないようタイマーを仕切り直す
    this.registry.set("autosaveNext", Date.now() + MapScene.AUTOSAVE_INTERVAL_MS);

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
  // せってい rows: character edits, toggles, and the restart action.
  private settingsRows(): { label: string; kind: "action" | "toggle" | "danger"; value?: boolean }[] {
    const s = loadSettings();
    return [
      { label: "せいべつを かえる", kind: "action" },
      { label: "なまえを かえる", kind: "action" },
      { label: "ひだりきき モード", kind: "toggle", value: s.leftHanded },
      { label: "BGM", kind: "toggle", value: s.bgm },
      { label: "こうかおん", kind: "toggle", value: s.se },
      { label: "さいしょから はじめる", kind: "danger" },
    ];
  }

  private showSettingsScreen(): void {
    this.settingsSelIndex = 0;
    this.settingsGpPrevDpad = null;
    this.drawSettingsScreen();
  }

  private drawSettingsScreen(): void {
    this.menuSubScreen = "settings";
    this.clearMenuElements();
    const W = this.scale.width, H = this.scale.height;
    const F = "'DotGothic16', monospace";

    const bg = this.add.graphics().setScrollFactor(0).setDepth(200);
    bg.fillStyle(0x0a1628, 0.97); bg.fillRect(this.uiX(0), this.uiY(0), this.uiS(W), this.uiS(H));
    this.menuElements.push(bg);

    const title = this.add.text(this.uiX(W / 2), this.uiY(34), "せってい", {
      fontSize: `${this.uiS(20)}px`, color: "#66aaff", fontFamily: F, fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(title);

    const rows = this.settingsRows();
    const rowH = 52, top = 78;
    rows.forEach((row, i) => {
      const y = top + i * rowH;
      const on = i === this.settingsSelIndex;
      const panel = this.add.graphics().setScrollFactor(0).setDepth(201);
      panel.fillStyle(on ? 0x1b3a63 : 0x0d1a33, on ? 0.95 : 0.85);
      panel.fillRoundedRect(this.uiX(28), this.uiY(y), this.uiS(W - 56), this.uiS(rowH - 10), 8);
      panel.lineStyle(on ? 3 : 2, row.kind === "danger" ? 0xaa5566 : (on ? 0x8fd0ff : 0x3a5680));
      panel.strokeRoundedRect(this.uiX(28), this.uiY(y), this.uiS(W - 56), this.uiS(rowH - 10), 8);
      this.menuElements.push(panel);

      const color = row.kind === "danger" ? "#ff9fb0" : "#ffffff";
      const label = this.add.text(this.uiX(48), this.uiY(y + (rowH - 10) / 2), `${on ? "▶ " : "  "}${row.label}`, {
        fontSize: `${this.uiS(16)}px`, color, fontFamily: F, stroke: "#000000", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(202).setOrigin(0, 0.5);
      this.menuElements.push(label);

      if (row.kind === "toggle") {
        const onOff = row.value ? "ON" : "OFF";
        const tg = this.add.text(this.uiX(W - 48), this.uiY(y + (rowH - 10) / 2), onOff, {
          fontSize: `${this.uiS(16)}px`, color: row.value ? "#7fe0a0" : "#889", fontFamily: F, fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
        }).setScrollFactor(0).setDepth(202).setOrigin(1, 0.5);
        this.menuElements.push(tg);
      }

      // Tap support
      const zone = this.add.zone(this.uiX(W / 2), this.uiY(y + (rowH - 10) / 2), this.uiS(W - 56), this.uiS(rowH - 10))
        .setScrollFactor(0).setInteractive().setDepth(203).setOrigin(0.5);
      zone.on("pointerdown", () => { this.settingsSelIndex = i; this.activateSettingsRow(); });
      this.menuElements.push(zone);
    });

    const bgmNote = this.add.text(this.uiX(W / 2), this.uiY(top + rows.length * rowH + 6), "※BGM・こうかおんは じゅんびちゅう", {
      fontSize: `${this.uiS(10)}px`, color: "#66788c", fontFamily: F,
    }).setScrollFactor(0).setDepth(201).setOrigin(0.5);
    this.menuElements.push(bgmNote);

    const hint = this.add.text(this.uiX(W / 2), this.uiY(H - 28), "A:えらぶ/きりかえ   Bボタンでもどる", {
      fontSize: `${this.uiS(12)}px`, color: "#ffffff", fontFamily: F, stroke: "#000000", strokeThickness: 3,
    }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
    this.menuElements.push(hint);
    this.applyTextResolution(this.menuElements);
  }

  private activateSettingsRow(): void {
    const i = this.settingsSelIndex;
    if (i === 0 || i === 1) {
      // Character edit: hand off to SetupScene in settings-mode, then resume here.
      const resume = { mapKey: this.currentMapKey, playerX: this.gridX, playerY: this.gridY, playerState: this.playerState };
      this.closeMenu();
      this.cameras.main.fadeOut(200, 0, 0, 0);
      this.cameras.main.once("camerafadeoutcomplete", () => {
        this.scene.start("SetupScene", { settingsMode: true, startStep: i === 1 ? "name" : "gender", resume });
      });
      return;
    }
    if (i >= 2 && i <= 4) {
      const s: GameSettings = loadSettings();
      if (i === 2) s.leftHanded = !s.leftHanded;
      else if (i === 3) s.bgm = !s.bgm;
      else if (i === 4) s.se = !s.se;
      saveSettings(s);
      this.drawSettingsScreen();
      return;
    }
    if (i === 5) this.showRestartConfirm();
  }

  private updateSettingsScreen(a: boolean, b: boolean, menu: boolean, dpad: string | null): void {
    const rows = this.settingsRows();
    const justUp = dpad === "up" && this.settingsGpPrevDpad !== "up";
    const justDown = dpad === "down" && this.settingsGpPrevDpad !== "down";
    let kbUp = false, kbDown = false;
    if (this.input.keyboard && this.cursors) {
      kbUp = Phaser.Input.Keyboard.JustDown(this.cursors.up);
      kbDown = Phaser.Input.Keyboard.JustDown(this.cursors.down);
    }
    this.settingsGpPrevDpad = dpad;

    if (b || menu) { this.closeSubScreen(); return; }
    if (justUp || kbUp) { this.settingsSelIndex = (this.settingsSelIndex - 1 + rows.length) % rows.length; this.drawSettingsScreen(); return; }
    if (justDown || kbDown) { this.settingsSelIndex = (this.settingsSelIndex + 1) % rows.length; this.drawSettingsScreen(); return; }
    if (a) this.activateSettingsRow();
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

  /** 話しかけられたNPC/トレーナーを、プレイヤーの方へ振り向かせる。
   *  cast-<名前>-<向き> のスプライトのみ対象（看板などは無視）。
   *  タイル座標を渡すと その位置→プレイヤー の向きに、省略時は
   *  プレイヤーの向きの逆（正面から向き合う）にする。 */
  private faceSpriteToPlayer(sprite?: Phaser.GameObjects.Image, at?: { x: number; y: number }): void {
    if (!sprite) return;
    let want: Direction;
    if (at) {
      const dx = this.gridX - at.x, dy = this.gridY - at.y;
      want = Math.abs(dx) >= Math.abs(dy)
        ? (dx >= 0 ? "right" : "left")
        : (dy >= 0 ? "down" : "up");
    } else {
      const opposite: Record<Direction, Direction> =
        { up: "down", down: "up", left: "right", right: "left" };
      want = opposite[this.facingDirection];
    }
    const m = /^cast-(.+)-(up|down|left|right)$/.exec(sprite.texture.key);
    if (!m) return;
    const key = `cast-${m[1]}-${want}`;
    if (this.textures.exists(key)) sprite.setTexture(key);
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
    // Gym leaders battle only when talked to (not by sight). Requires beating
    // the gym's gate trainers first.
    const leader = this.allTrainers.find(t =>
      t.mapKey === this.currentMapKey &&
      MapScene.GYM_LEADER_GATES[t.id] &&
      t.x === fx && t.y === fy &&
      this.trainerSprites.has(t.id) &&
      !this.playerState?.defeatedTrainers.includes(t.id)
    );
    if (leader) {
      this.faceSpriteToPlayer(this.trainerSprites.get(leader.id));
      const gate = MapScene.GYM_LEADER_GATES[leader.id];
      if (gate && !gate.every(id => this.playerState?.defeatedTrainers.includes(id))) {
        this.showDialog([
          "……まだ 早い。",
          "このジムの トレーナー2人を\n倒してから 挑むがいい。",
        ]);
      } else {
        this.startBattle(undefined, undefined, leader);
      }
      return;
    }
    // 通常トレーナー: どの向きから 話しかけても 振り向いて相手をする
    // （視線に入らなくても Aボタンで バトル開始）。
    const talkTrainer = this.allTrainers
      .filter(t =>
        t.mapKey === this.currentMapKey &&
        !MapScene.GYM_LEADER_GATES[t.id] &&
        this.trainerSprites.has(t.id))
      .find(t => { const p = this.trainerTile(t); return p.x === fx && p.y === fy; });
    if (talkTrainer) {
      this.faceSpriteToPlayer(this.trainerSprites.get(talkTrainer.id));
      if (this.playerState?.defeatedTrainers.includes(talkTrainer.id)) {
        this.showDialog([talkTrainer.dialogWin || "いい しょうぶ だったね！"]);
      } else {
        this.startBattle(undefined, undefined, talkTrainer);
      }
      return;
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
        !(fx === this.caveEntranceX && fy === this.caveEntranceY) &&
        fx >= this.meteorX && fx < this.meteorX + MapScene.METEOR_SIZE &&
        fy >= this.meteorY && fy < this.meteorY + MapScene.METEOR_SIZE) {
      this.triggerMeteorEvent();
      return;
    }
    if (this.kinoshitaSprite && fx === this.kinoshitaNpcX && fy === this.kinoshitaNpcY) {
      this.faceSpriteToPlayer(this.kinoshitaSprite);
      this.triggerKinoshitaEvent();
      return;
    }
    if (this.nurseSprite && fx === this.nurseNpcX && fy === this.nurseNpcY) {
      this.faceSpriteToPlayer(this.nurseSprite);
      this.triggerNurseEvent();
      return;
    }
    if (this.shopkeeperSprite && fx === this.shopkeeperNpcX && fy === this.shopkeeperNpcY) {
      this.faceSpriteToPlayer(this.shopkeeperSprite);
      this.triggerShopkeeperEvent();
      return;
    }
    if (this.rivalSprite && fx === this.rivalNpcX && fy === this.rivalNpcY) {
      this.faceSpriteToPlayer(this.rivalSprite);
      this.triggerRivalEvent();
      return;
    }
    if (this.momSprite && fx === this.momNpcX && fy === this.momNpcY) {
      this.faceSpriteToPlayer(this.momSprite);
      this.triggerMomEvent();
      return;
    }
    if (this.researcher1Sprite && fx === this.researcher1NpcX && fy === this.researcher1NpcY) {
      this.faceSpriteToPlayer(this.researcher1Sprite);
      this.triggerResearcher1Event();
      return;
    }
    if (this.researcher2Sprite && fx === this.researcher2NpcX && fy === this.researcher2NpcY) {
      this.faceSpriteToPlayer(this.researcher2Sprite);
      this.triggerResearcher2Event();
      return;
    }
    if (this.residentSprite && fx === this.residentNpcX && fy === this.residentNpcY) {
      this.faceSpriteToPlayer(this.residentSprite);
      this.triggerResidentEvent();
      return;
    }
    const exam = this.nectarExam.find(e => e.x === fx && e.y === fy);
    if (exam) {
      exam.fn();
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
    // 倒したトレーナーは 撃破後に 横へ どく（道をあける）ので、元の
    // 立ち位置を向いても会話できないことがある。となり（自分のタイルを
    // 含む）に いれば Aボタンで 話しかけられるようにする。他の対象より
    // 優先度は低い（フォールバック）。
    const beaten = this.allTrainers
      .filter(t =>
        t.mapKey === this.currentMapKey &&
        !MapScene.GYM_LEADER_GATES[t.id] &&
        this.trainerSprites.has(t.id) &&
        this.playerState?.defeatedTrainers.includes(t.id))
      .find(t => {
        const p = this.trainerTile(t);
        return Math.abs(p.x - this.gridX) + Math.abs(p.y - this.gridY) <= 1;
      });
    if (beaten) {
      this.faceSpriteToPlayer(this.trainerSprites.get(beaten.id), this.trainerTile(beaten));
      this.showDialog([beaten.dialogWin || "いい しょうぶ だったね！"]);
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
    // A big stony meteorite with its bottom third sunk into the ground: the rock
    // is drawn large, and everything below the ground line is clipped away, so only
    // the emerged top ~2/3 shows (reads as a fallen space rock, half-buried).
    const R = s * 0.45;               // rock radius (enlarged)
    const groundLine = s * 0.80;      // ground surface: nothing is drawn below it
    const cy = groundLine - R / 3;    // centre placed so the bottom 1/3 is buried

    // --- soft contact shadow at the ground surface (no soil mound) ---
    ctx.fillStyle = "rgba(16,12,10,0.42)";
    ctx.beginPath(); ctx.ellipse(cx, groundLine, R * 1.0, s * 0.045, 0, 0, Math.PI * 2); ctx.fill();

    // Clip everything that follows to above the ground line (buries the base).
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, s, groundLine); ctx.clip();

    // --- meteorite body: a bumpy stone sphere ---
    const N = 40; const pts: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const rr = R * (0.93 + rnd() * 0.12);     // gentle rocky bumps
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R * 1.15);
    body.addColorStop(0, "#9a9088");
    body.addColorStop(0.45, "#5c5249");
    body.addColorStop(0.8, "#342c26");
    body.addColorStop(1, "#1b1613");
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.fill();

    // clip surface detail to the rock silhouette (intersects the ground clip)
    ctx.save();
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.clip();

    // impact pockmarks: dark floor + a lower-rim highlight for depth
    for (let i = 0; i < 18; i++) {
      const a = rnd() * Math.PI * 2, rr = rnd() * R * 0.82;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.9;
      const cr = 4 + rnd() * 15;
      ctx.fillStyle = "rgba(20,16,13,0.72)";
      ctx.beginPath(); ctx.arc(px, py, cr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(150,138,124,0.4)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px, py + cr * 0.25, cr * 0.85, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    }
    // fine stony speckle
    for (let i = 0; i < 150; i++) {
      const a = rnd() * Math.PI * 2, rr = rnd() * R;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      ctx.fillStyle = rnd() > 0.5 ? "rgba(162,150,136,0.22)" : "rgba(14,11,9,0.32)";
      ctx.fillRect(px, py, 2, 2);
    }
    // metallic sheen (upper-left)
    const sheen = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.45, 2, cx - R * 0.4, cy - R * 0.45, R * 0.8);
    sheen.addColorStop(0, "rgba(210,200,186,0.5)");
    sheen.addColorStop(1, "rgba(210,200,186,0)");
    ctx.fillStyle = sheen; ctx.fillRect(0, 0, s, s);
    ctx.restore();

    // upper-left rim light on the silhouette
    ctx.strokeStyle = "rgba(200,188,170,0.7)"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = Math.round(N * 0.5); i <= Math.round(N * 0.9); i++) {
      const p = pts[i % N]; if (i === Math.round(N * 0.5)) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();

    ctx.restore(); // end ground-line clip

    // --- faint residual heat where the rock enters the ground ---
    const glow = ctx.createLinearGradient(0, groundLine - s * 0.05, 0, groundLine + s * 0.02);
    glow.addColorStop(0, "rgba(255,120,50,0)");
    glow.addColorStop(0.55, "rgba(255,120,50,0.22)");
    glow.addColorStop(1, "rgba(255,120,50,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.ellipse(cx, groundLine - s * 0.01, R * 0.82, s * 0.04, 0, 0, Math.PI * 2); ctx.fill();

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
    // Drop the rock's artwork one tile lower than its collision box so it sits
    // deeper on screen. Collision / entrance / warp stay put (the tiles below are
    // walls, so the entrance must remain reachable from (caveEntranceX, +1)).
    const visualDropY = ts;
    this.meteorSprite = this.add.image(
      (this.meteorX + n / 2) * ts,
      (this.meteorY + n / 2) * ts + visualDropY,
      "meteor-rock"
    ).setDepth(9).setDisplaySize(ts * n, ts * n);
    // Cracked-open cave entrance at the meteor's base. Depth 9.5 keeps the hole
    // visible above the meteor (depth 9) but below the player (depth 10).
    this.caveEntranceSprite = this.add.image(
      this.caveEntranceX * ts + ts / 2,
      this.caveEntranceY * ts + ts / 2,
      "cave-entrance"
    ).setDepth(9.5).setDisplaySize(ts, ts);
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
    const pickups = this.playerState.pickups = this.playerState.pickups || [];
    if (pickups.includes("eezen_debris")) return;
    this.inCutscene = true;
    const ts = this.tileSize;

    // 忘れ物（デブリのはへん）を渡して、カットシーンを閉じる。
    const grant = () => {
      pickups.push("eezen_debris");
      const existing = this.playerState!.items.find(i => i.id === "debris_fragment");
      if (existing) existing.count++;
      else this.playerState!.items.push({ id: "debris_fragment", count: 1 });
      this.showDialog([
        "イーゼンが 落としていった\nかけらが 落ちている……。",
        "「デブリのはへん」を てにいれた！",
        "隕石とともに 落ちてきた 金属片だ。\nリサイクルショップで お金に なるらしい…。",
      ], () => { this.inCutscene = false; });
    };

    const spr = this.trainerSprites.get("eezen");
    if (!spr) { grant(); return; }

    // イーゼンが 捨てゼリフ → 出口へ 歩いて 先に 出ていく → 忘れ物のきらめき
    this.showDialog([
      "イーゼン「ぼくの まけだ…！ えぇ、みとめるよ。」",
      "イーゼン「先に 行かせて もらう。\n……ぼくは まだ 強く なる。大変 恐縮です。」",
    ], () => {
      spr.setPosition(7 * ts + ts / 2, 7 * ts + ts / 2);
      const path: [number, number][] = [[7, 6], [7, 5], [7, 4], [7, 3], [7, 2], [6, 2], [5, 2], [4, 2], [3, 2], [2, 2]];
      const walk = (i: number) => {
        if (i >= path.length) {
          // 出口で フェードアウト → スプライトを消して 通行可に
          this.tweens.add({
            targets: spr, alpha: 0, duration: 300,
            onComplete: () => {
              spr.destroy();
              this.trainerSprites.delete("eezen");
              const gx = 7 * ts + ts / 2, gy = 7 * ts + ts / 2;
              const glint = this.add.circle(gx, gy, 4, 0xffe08a, 0.9).setDepth(8);
              this.tweens.add({
                targets: glint, scale: 1.7, alpha: 0.25, yoyo: true, repeat: 2, duration: 300,
                onComplete: () => { glint.destroy(); grant(); },
              });
            },
          });
          return;
        }
        const [tx, ty] = path[i];
        const px = spr.x / ts - 0.5, py = spr.y / ts - 0.5;
        const dir: Direction = tx > px ? "right" : tx < px ? "left" : ty > py ? "down" : "up";
        const key = `cast-eezen-${dir}`;
        if (this.textures.exists(key)) spr.setTexture(key);
        this.tweens.add({
          targets: spr, x: tx * ts + ts / 2, y: ty * ts + ts / 2,
          duration: 200, ease: "Linear", onComplete: () => walk(i + 1),
        });
      };
      walk(0);
    });
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
        "エモ「なんだ…！？ 今の 揺れは…！」",
        "エモ「街の はずれに 何かが\n落ちたようだ。」",
        "エモ「きみ、様子を 見てきて\nくれ ないか。」",
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
    // Duvet drawn OVER the sleeping player during the prologue so the hero
    // looks tucked in (only head/pillow shows). Removed on wake-up.
    mk("home-bed-cover", 40, 40, (ctx) => {
      ctx.fillStyle = "#5f8ad0"; this.roundRect(ctx, 3, 6, 34, 32, 5); ctx.fill();         // blanket body
      ctx.fillStyle = "#7aa4e4"; this.roundRect(ctx, 3, 6, 34, 8, 5); ctx.fill();          // turned-down fold
      ctx.strokeStyle = "#3a5a90"; ctx.lineWidth = 2; this.roundRect(ctx, 3, 6, 34, 32, 5); ctx.stroke();
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
      this.npcTex("cast-mom2-down", "npc-mom")
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

    // (3) Leader's dais glow (around the central device where エモ stands).
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
    // Start the player in bed (top-left) fast asleep, tucked under the duvet
    // (the cover sits above the player so only the head/pillow shows).
    this.gridX = 1; this.gridY = 4;
    this.player.setPosition(1 * ts + ts / 2, 4 * ts + ts / 2);
    this.setPlayerFacing("down");
    const bedCover = this.add.image(1 * ts + ts / 2, Math.round(5.0 * ts), "home-bed-cover").setDepth(12);
    let emote = this.showEmote("zzz");

    this.time.delayedCall(1300, () => {
      this.showDialog([
        "「……ん……ぐぅ……」",
        "ちょっと！ まだ 寝てるの！？ 起きなさい！",
        "今日から 月面探査が 始まるんでしょ？\n遅刻しないで 行きなさいね！",
      ], () => {
        emote.forEach(o => o.destroy());
        bedCover.destroy();                    // throw off the covers on waking
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
      // ネクタルタウン (1人1テーマの教育会話: ネクタルタウン設計v1 §11-2)
      house_5: "cast-char6-down", house_6: "cast-char3-down", house_7: "cast-char5-down",
      // タテアナ村
      house_8: "cast-char7-down",
      // ミノリタウン
      house_9: "cast-char6-down",
      // セレネタウン
      house_10: "cast-char5-down", house_11: "cast-char4-down",
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
      // ---- ネクタルタウン (テーマ別・設計書 §11-2) ----
      house_5: [
        "昔の 人はな、月の 黒い ところを\n『海』と 呼んだんじゃ。",
        "じゃが ほんとうは 水じゃない。\n大むかしの 溶岩が 固まった\n平らな 大地なんじゃよ。",
        "この 神酒の海も そのひとつ。\nとびきり 古い 海なんじゃ。",
      ],
      house_6: [
        "月には 空気が ないから、日なたは\nやけるほど あつく、日かげは\nこおりつくほど 寒い。",
        "だから この町の ジムは\n氷の アルモン使いなのさ。",
        "なめてかかると こおるぞ〜。",
      ],
      house_7: [
        "氷の ジムは 手ごわいよ。",
        "ほのおや、はがねの ような\nアルモンが 心づよいね。",
        "…そういえば ジムの とびら、\n分厚い 氷で とざされて いたねえ。\nあれも 試練の うちなんだって。",
      ],
      // タテアナ村（縦孔の暮らしの教育テーマ）
      house_8: [
        "ようこそ タテアナむらへ。",
        "この 村はね、あなの 中の\n安定した 温度を つかって\n食べものを 保存しているの。",
        "月では 昼と 夜の 温度差が\n300ど ちかく ある。でも あなの\n中は いつも おだやか なのよ。",
      ],
      // ミノリタウン（豊かの海＝ルナ16号の教育テーマ）
      house_9: [
        "ようこそ ミノリタウンへ。",
        "むかし ルナ16号という 探査機が\nこの 豊かの海に おりて、月の 土を\nはじめて 無人で 地球へ とどけたの。",
        "うちの 農園の 野菜も いつか\n地球に とどけたい ものだわ。",
      ],
      // セレネタウン（光の暮らしの教育テーマ）
      house_10: [
        "この 町の じまんは 鏡の タワーさ。",
        "月の 夜は 2週間も つづくだろう？\nだから 昼の うちに 光を あつめて\n熱と 電気に かえて たくわえるんだ。",
        "夜でも 街灯が ともる 町は\n月では めずらしいんだよ。",
      ],
      // セレネタウン（セレネ＝かぐや(SELENE)の教育テーマ）
      house_11: [
        "『セレネ』って いい ひびきでしょ？\nギリシャ神話の 月の 女神の 名前よ。",
        "日本の 月探査機 かぐや の 英語名も\n『SELENE（セレーネ）』。2007年に 月を\nまわって 地形を くわしく 調べたの。",
        "かぐやが うつした 『地球の出』の 映像、\nいつか ぜひ 見てみてね。",
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
      // Remember this pod: blacking out respawns at the last pod used.
      if (this.playerState) this.playerState.lastRecoveryMap = this.currentMapKey;
      this.showDialog([
        "おまちどうさま！\nアルモンたちは すっかり\n元気になりましたよ！",
        "またいつでも いらしてくださいね！",
      ]);
    });
  }

  private healParty(): void {
    if (!this.playerState) return;
    const allMonsters = this.cache.json.get("monsters") as MonsterData[];
    const allMoves = (this.cache.json.get("moves") || []) as MoveData[];
    for (const mon of this.playerState.party) {
      const data = allMonsters.find(m => m.id === mon.dataId);
      if (data) {
        const stats = applyNature(calculateStats(data, mon.level), mon.nature);
        mon.currentHp = stats.hp;
        mon.maxHp = stats.hp;
      }
      restorePP(mon, allMoves);   // PPも全回復
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
    this.dialogMessages = this.paginateDialog(messages);
    this.dialogIndex = 0;
    this.dialogCallback = onComplete;
    this.drawDialogMessage();
  }

  private measureCtx?: CanvasRenderingContext2D;
  /** 文字単位で折り返す（日本語はスペースが無く Phaser の 標準ラップが
   *  効かないため）。既存の改行は尊重しつつ、幅を超える手前で改行する。 */
  private wrapCJK(text: string, maxWidthPx: number, fontPx: number): string[] {
    if (!this.measureCtx) this.measureCtx = document.createElement("canvas").getContext("2d")!;
    const ctx = this.measureCtx;
    ctx.font = `${fontPx}px 'DotGothic16', monospace`;
    const out: string[] = [];
    for (const rawLine of text.split("\n")) {
      let line = "";
      for (const ch of Array.from(rawLine)) {
        if (line && ctx.measureText(line + ch).width > maxWidthPx) { out.push(line); line = ch; }
        else line += ch;
      }
      out.push(line);
    }
    return out;
  }

  /** メッセージ箱に収まる行数を超える文章は、収まる行数ごとの複数ページに
   *  分割する（Aボタン/タップで送る）。横も縦もはみ出すのを防ぐ。 */
  private paginateDialog(messages: string[]): string[] {
    const W = this.scale.width;
    const margin = 20;
    const maxLines = 3;   // 166pxの箱にフォント24px+行間8pxで収まる行数
    const maxW = this.uiS(W - margin * 2 - 52);
    const fontPx = this.uiS(24);
    const out: string[] = [];
    for (const msg of messages) {
      const lines = this.wrapCJK(msg, maxW, fontPx);
      for (let i = 0; i < lines.length; i += maxLines) {
        out.push(lines.slice(i, i + maxLines).join("\n"));
      }
    }
    return out.length ? out : messages;
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
      // Close BEFORE invoking the callback: a chained callback that opens the
      // next dialog re-sets dialogActive itself, and a non-chaining callback
      // must not leave a phantom "open" dialog (it used to eat one extra A).
      this.dialogActive = false;
      if (cb) cb();
      return;
    }
    this.drawDialogMessage();
  }

  private clearDialogElements(): void {
    this.dialogElements.forEach(el => el.destroy());
    this.dialogElements = [];
  }

  // ---- Default starter ----
  // ---- Nectar Town ambience (frozen basin) ----
  private genIceCrystalTexture(): void {
    if (this.textures.exists("ice-crystal")) return;
    const s = 48;
    const c = document.createElement("canvas"); c.width = s; c.height = s;
    const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
    // soft ground shadow
    ctx.fillStyle = "rgba(40,60,90,0.25)";
    ctx.beginPath(); ctx.ellipse(s / 2, s - 6, s * 0.38, 5, 0, 0, Math.PI * 2); ctx.fill();
    // cluster of translucent shards (tall centre + two leaning sides)
    const shard = (bx: number, tipX: number, tipY: number, w: number) => {
      const grd = ctx.createLinearGradient(bx, s - 8, tipX, tipY);
      grd.addColorStop(0, "rgba(140,190,235,0.95)");
      grd.addColorStop(0.6, "rgba(190,225,250,0.9)");
      grd.addColorStop(1, "rgba(240,250,255,0.95)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(bx - w, s - 8); ctx.lineTo(tipX, tipY); ctx.lineTo(bx + w, s - 8);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bx, s - 9); ctx.lineTo(tipX, tipY + 2); ctx.stroke();
    };
    shard(24, 24, 4, 7);
    shard(13, 8, 16, 5);
    shard(35, 41, 14, 5);
    // glint
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(22, 10, 2, 2); ctx.fillRect(23, 8, 1, 6); ctx.fillRect(20, 11, 6, 1);
    this.textures.addCanvas("ice-crystal", c);
  }

  private placeNectarDecor(): void {
    const ts = this.tileSize;
    this.genIceCrystalTexture();
    // Ice crystal clusters on blocked rocks/rim tiles (decor only, no collision change)
    for (const [x, y] of [[9, 8], [19, 18], [4, 17], [26, 24], [3, 4], [28, 3]] as [number, number][]) {
      this.add.image(x * ts + ts / 2, y * ts + ts / 2 - 6, "ice-crystal")
        .setDepth(6).setDisplaySize(ts * 1.3, ts * 1.3);
    }
    // An almon skating happily across the frozen pond (⑯ 点景).
    if (this.textures.exists("monster-mochichi")) {
      const skater = this.add.image(13 * ts, 14.4 * ts, "monster-mochichi").setDepth(7);
      const h = skater.height || 32;
      skater.setScale((ts * 0.9) / h);
      this.tweens.add({
        targets: skater, x: 19 * ts, duration: 2800, yoyo: true, repeat: -1,
        ease: "Sine.inOut",
        onYoyo: () => skater.setFlipX(true),
        onRepeat: () => skater.setFlipX(false),
      });
      this.tweens.add({
        targets: skater, angle: { from: -6, to: 6 }, duration: 700, yoyo: true, repeat: -1,
        ease: "Sine.inOut",
      });
    }
    // Cold colour cast over the whole basin (subtle; below dialogs/UI).
    this.add.rectangle(0, 0, this.mapData.width * ts, this.mapData.height * ts, 0x9fc8ff, 0.07)
      .setOrigin(0).setDepth(26);
  }

  /**
   * Keep the nectar gym door's walkability/warp in sync with the melt flag.
   * mapData comes from the (session-persistent) JSON cache, so this must be
   * idempotent in BOTH directions — a new game must re-freeze the door.
   */
  private applyNectarGymDoorState(): void {
    const { x, y } = MapScene.NECTAR_GYM_DOOR;
    const melted = (this.playerState?.pickups || []).includes(MapScene.NECTAR_DOOR_FLAG);
    const warps = this.mapData.warps || (this.mapData.warps = []);
    const idx = warps.findIndex(w => w.x === x && w.y === y);
    if (melted) {
      this.mapData.layers.collision[y][x] = 0;
      if (idx < 0) warps.push({ x, y, targetMap: "gym_2", targetX: 10, targetY: 24 });
    } else {
      this.mapData.layers.collision[y][x] = 1;
      if (idx >= 0) warps.splice(idx, 1);
    }
  }

  /** 試練 その1 (⑦): melt the frozen gym door with a fire/metal party member. */
  private tryMeltGymDoor(): void {
    const party = this.playerState?.party || [];
    const melter = party.find(m => MapScene.DOOR_MELTERS[m.dataId]);
    if (!melter) {
      this.showDialog([
        "とびらが 分厚い こおりで\nとざされている…。",
        "はりがみが ある。",
        "『試練 その1。この とびらを\nとかして みせよ。\n——ネクタルジム リーダー コジマ』",
        "（ほのおか はがねの アルモンが\nいれば とかせるかも…）",
      ]);
      return;
    }
    const kind = MapScene.DOOR_MELTERS[melter.dataId];
    const allMonsters = this.cache.json.get("monsters") as MonsterData[];
    const name = allMonsters.find(m => m.id === melter.dataId)?.name || "アルモン";
    const actionLine = kind === "fire"
      ? `${name}が ほのおを ふきつけた！`
      : `${name}が 体当たりで 氷を くだいた！`;
    this.inCutscene = true;
    this.showDialog([
      "とびらが 分厚い こおりで\nとざされている…。",
      "（手持ちの アルモンが 反応している…！）",
      actionLine,
      "こおりが パリンと われて、\nジムの とびらが ひらいた！",
    ], () => {
      this.inCutscene = false;
      if (this.playerState) {
        this.playerState.pickups = this.playerState.pickups || [];
        if (!this.playerState.pickups.includes(MapScene.NECTAR_DOOR_FLAG)) {
          this.playerState.pickups.push(MapScene.NECTAR_DOOR_FLAG);
        }
      }
      this.applyNectarGymDoorState();
      // a small white flash at the doorway to sell the crack
      const ts = this.tileSize;
      const flash = this.add.circle(
        MapScene.NECTAR_GYM_DOOR.x * ts + ts / 2,
        MapScene.NECTAR_GYM_DOOR.y * ts + ts / 2,
        6, 0xffffff
      ).setDepth(20);
      this.tweens.add({ targets: flash, scale: 5, alpha: 0, duration: 420, ease: "Cubic.out",
        onComplete: () => flash.destroy() });
    });
  }

  // ---- Nectar Town education events (第5章 / 設計書 §11-§12) ----
  // Examinable props/NPCs: face the tile and press A.
  private nectarExam: { x: number; y: number; fn: () => void }[] = [];
  private quizAwaiting: { correct: "A" | "B"; explain: string[] } | null = null;
  private quizIdx = 0;

  private genNectarEventTextures(): void {
    const mk = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
      if (this.textures.exists(key)) return;
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      draw(ctx);
      this.textures.addCanvas(key, c);
    };
    // Old telescope on a tripod (③)
    mk("nectar-telescope", 32, 40, (ctx) => {
      ctx.strokeStyle = "#5a4a38"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(16, 26); ctx.lineTo(8, 38); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(16, 26); ctx.lineTo(24, 38); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(16, 26); ctx.lineTo(16, 38); ctx.stroke();
      ctx.save(); ctx.translate(16, 22); ctx.rotate(-0.6);
      const grd = ctx.createLinearGradient(-14, 0, 14, 0);
      grd.addColorStop(0, "#caa64c"); grd.addColorStop(0.5, "#e8cc80"); grd.addColorStop(1, "#a8853c");
      ctx.fillStyle = grd; ctx.fillRect(-14, -4, 28, 8);
      ctx.fillStyle = "#3a3a4a"; ctx.fillRect(12, -5, 4, 10);
      ctx.restore();
    });
    // Rock sample display case (④)
    mk("nectar-sample", 32, 32, (ctx) => {
      ctx.fillStyle = "#8fa3b8"; ctx.fillRect(4, 18, 24, 12);
      ctx.fillStyle = "#b8c8d8"; ctx.fillRect(4, 18, 24, 3);
      ctx.fillStyle = "rgba(180,220,250,0.45)"; ctx.fillRect(6, 2, 20, 16);
      ctx.strokeStyle = "#dceaf6"; ctx.lineWidth = 1; ctx.strokeRect(6.5, 2.5, 19, 15);
      ctx.fillStyle = "#7a6a58";
      ctx.beginPath(); ctx.moveTo(12, 16); ctx.lineTo(16, 7); ctx.lineTo(21, 12); ctx.lineTo(19, 16);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#9a8a74"; ctx.fillRect(14, 10, 3, 2);
    });
    // Snowdrift mound (⑪)
    mk("nectar-drift", 36, 26, (ctx) => {
      ctx.fillStyle = "#eef6fd";
      ctx.beginPath(); ctx.ellipse(18, 18, 16, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(11, 13, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(24, 12, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.fillRect(8, 9, 5, 2); ctx.fillRect(21, 8, 4, 2);
      ctx.fillStyle = "rgba(150,175,200,0.5)";
      ctx.beginPath(); ctx.ellipse(18, 22, 14, 3, 0, 0, Math.PI * 2); ctx.fill();
    });
    // Blue signpost (看板)
    mk("nectar-sign", 26, 32, (ctx) => {
      ctx.fillStyle = "#6a5844"; ctx.fillRect(11, 14, 4, 16);
      ctx.fillStyle = "#2c4a6e"; ctx.fillRect(1, 2, 24, 14);
      ctx.fillStyle = "#4a6a90"; ctx.fillRect(1, 2, 24, 2);
      ctx.strokeStyle = "#9fc0e0"; ctx.lineWidth = 1; ctx.strokeRect(2.5, 3.5, 21, 11);
      ctx.fillStyle = "#cfe2f4";
      ctx.fillRect(5, 6, 16, 1); ctx.fillRect(5, 9, 12, 1); ctx.fillRect(5, 12, 14, 1);
    });
    // Shadowy figure (⑬ ヴォイス)
    mk("voice-shadow", 26, 34, (ctx) => {
      ctx.fillStyle = "#20222e";
      ctx.beginPath(); ctx.arc(13, 9, 7, 0, Math.PI * 2); ctx.fill();      // hood
      ctx.beginPath(); ctx.moveTo(4, 32); ctx.quadraticCurveTo(13, 8, 22, 32); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#12141c";
      ctx.beginPath(); ctx.ellipse(13, 10, 4.5, 5, 0, 0, Math.PI * 2); ctx.fill(); // face void
      ctx.fillStyle = "#7ad0ff"; ctx.fillRect(10, 9, 2, 2); ctx.fillRect(15, 9, 2, 2); // cold eyes
    });
    // Rising Earth (②)
    mk("earth-sprite", 44, 44, (ctx) => {
      const g = ctx.createRadialGradient(17, 15, 4, 22, 22, 22);
      g.addColorStop(0, "#9fd8ff"); g.addColorStop(0.55, "#3a7ad0"); g.addColorStop(1, "#1c3c78");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(22, 22, 20, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";                             // clouds/continents
      ctx.beginPath(); ctx.ellipse(15, 15, 7, 4, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(28, 26, 6, 3, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(120,220,140,0.55)";
      ctx.beginPath(); ctx.ellipse(24, 14, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(190,230,255,0.8)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(22, 22, 20.5, 0, Math.PI * 2); ctx.stroke();
    });
  }

  private awardNectarItem(flag: string, itemId: string, itemName: string, foundLines: string[]): boolean {
    const pk = this.playerState?.pickups || [];
    if (!this.playerState || pk.includes(flag)) return false;
    this.playerState.pickups = pk;
    pk.push(flag);
    const it = this.playerState.items.find(i => i.id === itemId);
    if (it) it.count++;
    else this.playerState.items.push({ id: itemId, count: 1 });
    this.showDialog([...foundLines, `「${itemName}」を てにいれた！`]);
    return true;
  }

  private placeNectarEvents(): void {
    this.genNectarEventTextures();
    const ts = this.tileSize;
    const put = (key: string, x: number, y: number, fn: () => void, dy = 0) => {
      this.add.image(x * ts + ts / 2, y * ts + ts / 2 + dy, key).setDepth(8);
      this.nectarExam.push({ x, y, fn });
    };

    // ③ 昔の望遠鏡 (repeatable)
    put("nectar-telescope", 20, 7, () => this.showDialog([
      "ふるい 望遠鏡を のぞいてみた…。",
      "暗い 大地が 見わたせる。むかしの\n天文学者は 望遠鏡ごしの この 黒い\n場所を 『海』と 呼んだんだ。",
      "ほんとうは 水の ない、溶岩の\n平原だと わかったのは ずっと あと。",
    ]));

    // ④ 神酒代の地層サンプル (first time: どうぐ)
    put("nectar-sample", 27, 6, () => {
      const given = this.awardNectarItem("nectar_sample_seen", "hi_repair_gel", "ハイリペアジェル", [
        "こおりづけの 岩サンプルだ。",
        "『約39おく年前の 神酒の海の 岩。\n月の 時代区分 神酒代(ネクタリアン)の\n名前の もとに なった 場所の 石』",
        "ケースの 下に なにか ある…。",
      ]);
      if (!given) this.showDialog([
        "こおりづけの 岩サンプルだ。",
        "『約39おく年前の 神酒の海の 岩。\n月の 時代区分 神酒代(ネクタリアン)の\n名前の もとに なった 場所の 石』",
      ]);
    });

    // 研究者 (展望への誘導・会話のみ)
    put(this.npcTex("cast-char2-down", "npc-kinoshita"), 26, 6, () => this.showDialog([
      "やあ、旅の人。ここは 神酒の海の\n研究ステーションだよ。",
      "この 高台は 神酒の海を 見わたす\nいちばんの 場所なんだ。\nすこし 西に 立ってみて ごらん。",
    ]));

    // ⑮ 月クイズの子ども
    put(this.npcTex("cast-char8-down", "npc-mom"), 19, 19, () => this.triggerQuizKid());

    // ⑪ 雪だまりの隠しどうぐ ×2
    put("nectar-drift", 4, 6, () => {
      const given = this.awardNectarItem("nectar_hidden_1", "star_capsule", "スターカプセル", [
        "雪だまりを ほってみた…。\nなにか かたい ものが ある！",
      ]);
      if (!given) this.showDialog(["雪だまりだ。\nもう なにも うまっていない。"]);
    }, 4);
    put("nectar-drift", 27, 17, () => {
      const given = this.awardNectarItem("nectar_hidden_2", "repair_gel", "リペアジェル", [
        "雪だまりを ほってみた…。\nつめたっ！ でも なにか ある！",
      ]);
      if (!given) this.showDialog(["雪だまりだ。\nもう なにも うまっていない。"]);
    }, 4);

    // 看板 ×2
    put("nectar-sign", 14, 27, () => this.showDialog([
      "『ネクタルタウン』",
      "神酒の海の ほとりの 開拓地。\nようこそ！",
    ]), -4);
    put("nectar-sign", 13, 7, () => this.showDialog([
      "『ネクタルジム』\nリーダー：コジマ（氷）",
      "極低温の こおりを あやつる。\n——とびらの 氷を とかせた者だけ\n挑戦を ゆるされる。",
    ]), -4);
  }

  /** 到着カットシーン (脚本24): 寒さを「体感」させる。1回きり。 */
  private playNectarArrival(): void {
    if (!this.playerState) return;
    this.playerState.pickups = this.playerState.pickups || [];
    if (this.playerState.pickups.includes("nectar_arrival_seen")) return;
    this.playerState.pickups.push("nectar_arrival_seen");
    this.inCutscene = true;
    const emote = this.showEmote("!");
    // a little shiver
    this.tweens.add({ targets: this.player, x: this.player.x + 2, duration: 60,
      yoyo: true, repeat: 7, ease: "Linear" });
    this.time.delayedCall(800, () => {
      emote.forEach(o => o.destroy());
      this.showDialog([
        "（さむっ…！ さっきまで\n砂漠だったのに…）",
        "「ようこそ ネクタルタウンへ。\nここは 神酒の海の ほとり——月で\nいちばん 古い 記憶が ねむる 町さ。」",
      ], () => { this.inCutscene = false; });
    });
  }

  // ========== タテアナ村 / 溶岩洞（第6章 P2: 救助クエスト） ==========

  private hasPitFlag(flag: string): boolean {
    return (this.playerState?.pickups || []).includes(flag);
  }
  private setPitFlag(flag: string): void {
    if (!this.playerState) return;
    this.playerState.pickups = this.playerState.pickups || [];
    if (!this.playerState.pickups.includes(flag)) this.playerState.pickups.push(flag);
  }
  private clearPitFlag(flag: string): void {
    const pk = this.playerState?.pickups;
    if (!pk) return;
    const idx = pk.indexOf(flag);
    if (idx >= 0) pk.splice(idx, 1);
  }

  /** タテアナ村の点景 —「縦孔と生きる村」の個性づけ。
   *  縦孔から光の粒が立ちのぼり、ホタルナが舞い、プリボがレンガを印刷する。 */
  private placePitVillageDecor(): void {
    const ts = this.tileSize;
    const pitX = 16.5 * ts, pitY = 8.5 * ts;

    // --- 玄武岩の柱クラスタ（ゲンブーの教育ネタと連動する景観） ---
    if (!this.textures.exists("basalt-column")) {
      const s = 48;
      const c = document.createElement("canvas"); c.width = s; c.height = s;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "rgba(20,16,22,0.3)";
      ctx.beginPath(); ctx.ellipse(s / 2, s - 5, s * 0.4, 4, 0, 0, Math.PI * 2); ctx.fill();
      const col = (bx: number, h: number, w: number) => {
        ctx.fillStyle = "#3d3540"; ctx.fillRect(bx - w / 2, s - 6 - h, w, h);
        ctx.fillStyle = "#574c5c"; ctx.fillRect(bx - w / 2, s - 6 - h, 2, h);      // rim light
        ctx.fillStyle = "#2a2430"; ctx.fillRect(bx + w / 2 - 2, s - 6 - h, 2, h);  // shade
        ctx.fillStyle = "#6a5f70"; ctx.beginPath();                                // hex top
        ctx.moveTo(bx - w / 2, s - 6 - h); ctx.lineTo(bx - w / 4, s - 9 - h);
        ctx.lineTo(bx + w / 4, s - 9 - h); ctx.lineTo(bx + w / 2, s - 6 - h);
        ctx.closePath(); ctx.fill();
      };
      col(12, 22, 10); col(24, 32, 12); col(35, 16, 9);
      this.textures.addCanvas("basalt-column", c);
    }
    for (const [x, y] of [[14.2, 6.1], [19.2, 10.6], [13.7, 7.2]] as [number, number][]) {
      this.add.image(x * ts, y * ts, "basalt-column").setDepth(7).setDisplaySize(ts * 1.4, ts * 1.4);
    }

    // --- ホタルナのランタン灯（夜どおし村を照らす） ---
    if (!this.textures.exists("pit-lantern")) {
      const c = document.createElement("canvas"); c.width = 20; c.height = 44;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#5a4020"; ctx.fillRect(9, 10, 3, 32);
      ctx.fillStyle = "#8a6636"; ctx.fillRect(9, 10, 1, 32);
      ctx.fillStyle = "#3a3a44"; ctx.fillRect(5, 4, 11, 10);
      ctx.fillStyle = "#ffdf8a"; ctx.fillRect(7, 6, 7, 6);
      ctx.fillStyle = "#fff4c8"; ctx.fillRect(9, 7, 3, 4);
      this.textures.addCanvas("pit-lantern", c);
    }
    for (const [x, y] of [[10.5, 20.2], [13.6, 12.4], [2.6, 6.3]] as [number, number][]) {
      const lamp = this.add.image(x * ts, y * ts, "pit-lantern").setDepth(8).setScale(1.2);
      const glow = this.add.circle(x * ts + 1, y * ts - 12, 9, 0xffd070, 0.28).setDepth(8);
      this.tweens.add({ targets: glow, alpha: 0.12, scale: 1.25, duration: 900 + Math.random() * 500,
        yoyo: true, repeat: -1, ease: "Sine.inOut" });
      void lamp;
    }

    // --- プリボの工事コーナー（レンガを印刷中） ---
    if (!this.textures.exists("brick-pile")) {
      const c = document.createElement("canvas"); c.width = 34; c.height = 22;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      const brick = (x: number, y: number) => {
        ctx.fillStyle = "#c9a95d"; ctx.fillRect(x, y, 10, 6);
        ctx.fillStyle = "#e8cf8a"; ctx.fillRect(x, y, 10, 2);
        ctx.strokeStyle = "#8a7440"; ctx.strokeRect(x + 0.5, y + 0.5, 9, 5);
      };
      brick(2, 14); brick(13, 14); brick(24, 14); brick(7, 8); brick(18, 8); brick(12, 2);
      this.textures.addCanvas("brick-pile", c);
    }
    this.add.image(18.4 * ts, 16.6 * ts, "brick-pile").setDepth(7).setScale(1.3);
    if (this.textures.exists("monster-pribo")) {
      const worker = this.add.image(19.6 * ts, 16.4 * ts, "monster-pribo").setDepth(8);
      worker.setScale((ts * 1.0) / (worker.height || 100));
      this.tweens.add({ targets: worker, y: "-=3", duration: 620, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    }

    // --- 縦孔の上を舞うホタルナの群れ ---
    if (this.textures.exists("monster-hotaruna")) {
      for (let i = 0; i < 3; i++) {
        const fly = this.add.image(pitX, pitY - 8, "monster-hotaruna").setDepth(27);
        fly.setScale((ts * 0.55) / (fly.height || 100)).setAlpha(0.9);
        const rx = 34 + i * 16, ry = 18 + i * 8, dur = 2600 + i * 700;
        this.tweens.add({ targets: fly, x: { from: pitX - rx, to: pitX + rx }, duration: dur,
          yoyo: true, repeat: -1, ease: "Sine.inOut", delay: i * 400,
          onYoyo: () => fly.setFlipX(true), onRepeat: () => fly.setFlipX(false) });
        this.tweens.add({ targets: fly, y: { from: pitY - 10 - ry, to: pitY + ry * 0.4 }, duration: dur * 0.6,
          yoyo: true, repeat: -1, ease: "Sine.inOut", delay: i * 250 });
      }
    }

    // --- 縦孔から立ちのぼる光の粒 ---
    if (!this.textures.exists("pit-spark")) {
      const c = document.createElement("canvas"); c.width = 6; c.height = 6;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "rgba(255,214,130,0.95)"; ctx.fillRect(2, 2, 2, 2);
      ctx.fillStyle = "rgba(255,214,130,0.4)";
      ctx.fillRect(1, 2, 1, 2); ctx.fillRect(4, 2, 1, 2); ctx.fillRect(2, 1, 2, 1); ctx.fillRect(2, 4, 2, 1);
      this.textures.addCanvas("pit-spark", c);
    }
    for (let i = 0; i < 12; i++) {
      const sx = () => (14.3 + Math.random() * 4.4) * ts;
      const sy = () => (7.0 + Math.random() * 3.0) * ts;
      const spark = this.add.image(sx(), sy(), "pit-spark")
        .setDepth(27).setAlpha(0).setScale(0.8 + Math.random() * 0.8);
      this.tweens.add({
        targets: spark, y: `-=${60 + Math.random() * 90}`, alpha: { from: 0.85, to: 0 },
        duration: 2600 + Math.random() * 2400, repeat: -1, ease: "Sine.out", delay: Math.random() * 2500,
        onRepeat: () => { spark.x = sx(); spark.y = sy(); },
      });
    }

    // --- 夕暮れの暖色トーン（ネクタルの寒色キャストの対） ---
    this.add.rectangle(0, 0, this.mapData.width * ts, this.mapData.height * ts, 0xffa860, 0.06)
      .setOrigin(0).setDepth(26);
  }

  private placePitVillageEvents(): void {
    this.genNectarEventTextures(); // 看板テクスチャを流用
    const ts = this.tileSize;
    const put = (key: string, x: number, y: number, fn: () => void, dy = 0) => {
      this.add.image(x * ts + ts / 2, y * ts + ts / 2 + dy, key).setDepth(8);
      this.nectarExam.push({ x, y, fn });
    };

    // 看板①（村の入口）
    put("nectar-sign", 10, 19, () => this.showDialog([
      "『タテアナむら』",
      "巨大な 縦孔（たてあな）の ふちに\nひらかれた 村。",
    ]), -4);

    // 看板②（縦孔のふち・教育①）
    put("nectar-sign", 16, 11, () => this.showDialog([
      "『月の縦孔』",
      "日本の 探査機 かぐや が 見つけた\n大きな あな。",
      "下には 溶岩が 流れた あとの\nトンネル——溶岩洞（ようがんどう）が\n広がっている。",
    ]), -4);

    // 村長（縦孔のふち）— 救助クエストの起点
    put(this.npcTex("cast-elder-down", "npc-kinoshita"), 12, 8, () => {
      if (!this.hasPitFlag("pit_rescue_started")) {
        this.showDialog([
          "村長「たいへんじゃ！ 研究員の\nツキヤマくんが、あなの 調査に\n降りたきり もどらんのじゃ…！」",
          "村長「ロープは 縦孔の 西がわに\nかけてある。すまんが ようすを\n見てきて くれんか。たのむ！」",
        ], () => this.setPitFlag("pit_rescue_started"));
      } else if (!this.hasPitFlag("pit_rescue_cleared")) {
        this.showDialog([
          "村長「ツキヤマくんを たのむ！\nロープは わしの すぐ 東がわじゃ。」",
        ]);
      } else if (!this.hasPitFlag("pit_reward_given")) {
        this.showDialog([
          "村長「おお…！ ツキヤマくんが\nぶじに もどって きたぞ！」",
          "村長「ほんとうに ありがとう。\nこれは ほんの お礼じゃ。」",
          "★ スターカプセルを 2つ もらった！",
        ], () => {
          this.setPitFlag("pit_reward_given");
          if (this.playerState) {
            const e = this.playerState.items.find(i => i.id === "star_capsule");
            if (e) e.count += 2;
            else this.playerState.items.push({ id: "star_capsule", count: 2 });
          }
        });
      } else {
        this.showDialog([
          "村長「この 村は 縦孔と ともに\n生きて きたんじゃ。あなの 下は\nふしぎと おだやかでな。」",
        ]);
      }
    });

    // 広場の住人（縦孔の暮らしの小ネタ）
    put(this.npcTex("cast-colonist_e-down", "npc-mom"), 10, 15, () => this.showDialog([
      "この 村の じまんは なんといっても\nあの 縦孔（たてあな）さ。",
      "むかしの 人は 月に あなが あるなんて\n思っても みなかった。かぐや が\n見つけて くれたのさ。",
    ]));

    // ツキヤマ（救助後は村で調査を続ける・教育の再話＋ヴォイスの布石）
    if (this.hasPitFlag("pit_rescue_cleared")) {
      put(this.npcTex("cast-colonist_m-down", "npc-kinoshita"), 8, 13, () => this.showDialog([
        "ツキヤマ「やあ、命の恩人！ あれから\nあなの データを まとめて いるんだ。」",
        "ツキヤマ「溶岩洞は 温度が 安定して、\n放射線も ふせげる。3Dプリンタと\nレゴリスが あれば 月の 家も 作れる。\n夢が あるだろう？」",
        "ツキヤマ「…そうそう。あなの 奥で\n黒ずくめの 2人組を 見かけたんだ。\nただの 調査隊じゃ なさそうだった。\n気を つけて。」",
      ]));
    }
  }

  /** 到着カットシーン（1回きり）: 村のざわつき→村長への誘導。 */
  private playPitArrival(): void {
    if (!this.playerState) return;
    if (this.hasPitFlag("pit_arrival_seen")) return;
    this.setPitFlag("pit_arrival_seen");
    this.inCutscene = true;
    const emote = this.showEmote("!");
    this.time.delayedCall(800, () => {
      emote.forEach(o => o.destroy());
      this.showDialog([
        "（なんだか 村が ざわついている…）",
        "住人「村長が こまって いるんだ。\n村の おく、縦孔の ふちに いるよ。」",
      ], () => { this.inCutscene = false; });
    });
  }

  /** 溶岩洞の広間(x>=12, y>=13)に踏み込むと、未撃破の団員が順に駆け寄って
   *  強制バトル。広いホールでは視線式だけだと横を すり抜けられるための保険。 */
  private checkLavaTubeAmbush(): void {
    if (this.currentMapKey !== "lava_tube") return;
    if (this.dialogActive || this.inCutscene || this.trainerApproaching ||
        this.startingBattle || this.isWarping) return;
    if (this.gridX < 12 || this.gridY < 13) return;
    for (const id of ["voice_grunt_a", "voice_grunt_b"]) {
      if (this.playerState?.defeatedTrainers.includes(id)) continue;
      const trainer = this.allTrainers.find(t => t.id === id && t.mapKey === "lava_tube");
      if (trainer) { this.beginTrainerApproach(trainer); return; }
    }
  }

  private placeLavaTubeEvents(): void {
    if (this.hasPitFlag("pit_rescue_cleared")) return;
    const ts = this.tileSize;
    const tx = 20, ty = 16;
    const img = this.add.image(
      tx * ts + ts / 2, ty * ts + ts / 2,
      this.npcTex("cast-colonist_m-left", "npc-kinoshita")
    ).setDepth(9);
    const exam = {
      x: tx, y: ty, fn: () => {
        this.showDialog([
          "ツキヤマ「きみは…！ 村の 人に\nたのまれて 来て くれたのか！」",
          "ツキヤマ「調査に むちゅうに なって、\n足を くじいて しまってね…。\nありがとう、もう だいじょうぶ。」",
          "ツキヤマ「しかし 見たかい。この 洞窟、\n外より ずっと あたたかくて\n温度が ほとんど 変わらないんだ。」",
          "ツキヤマ「昼は 110ど、夜は マイナス\n170どの 月面でも、溶岩洞の 中は\n岩が まもって くれる。放射線も\n隕石も とどかない。」",
          "ツキヤマ「未来の 月の 家は、\nこういう 場所に 作られるかも\nしれないよ。」",
          "ツキヤマ「材料なら 足もとに いくらでも\nある。月の砂（レゴリス）を 3Dプリンタに\n入れて、家の 部品を その場で\n印刷するのさ。」",
          "ツキヤマ「それと——東の 奥を ふさいでいた\n岩は、アルモンに たのんで どかしておいた。\nあの 先の 深部を ぬければ 豊かの海だ。」",
          "ツキヤマ「さあ、先に 村へ もどるよ。\nきみも 気を つけて！」",
        ], () => {
          this.setPitFlag("pit_rescue_cleared");
          this.removeLavaDeepGate();
          // 彼は先にロープで帰る（すっと消える）
          const idx = this.nectarExam.indexOf(exam);
          if (idx >= 0) this.nectarExam.splice(idx, 1);
          this.tweens.add({ targets: img, alpha: 0, duration: 600, onComplete: () => img.destroy() });
        });
      },
    };
    this.nectarExam.push(exam);
  }

  // ========== ジム3・豊かの海編（設計書: ジム3・豊かの海編v1） ==========

  /** 溶岩洞→深部の通路（東奥）。ツキヤマ救出前は岩でふさがっている。 */
  private placeLavaDeepGate(): void {
    this.deepGateRock = undefined;
    this.deepGateExam = undefined;
    if (this.hasPitFlag("pit_rescue_cleared")) return;
    const ts = this.tileSize;
    if (!this.textures.exists("deep-gate-rock")) {
      const c = document.createElement("canvas"); c.width = 36; c.height = 36;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.ellipse(18, 31, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
      for (const [bx, by, br, col] of [[13, 20, 11, "#4a3f50"], [24, 22, 9, "#3d3442"], [19, 12, 8, "#574c5c"]] as [number, number, number, string][]) {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#6a5f70"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(bx, by, br, Math.PI * 1.05, Math.PI * 1.7); ctx.stroke();
      }
      this.textures.addCanvas("deep-gate-rock", c);
    }
    this.deepGateRock = this.add.image(22 * ts + ts / 2, 16 * ts + ts / 2, "deep-gate-rock")
      .setDepth(8).setDisplaySize(ts * 1.05, ts * 1.05);
    const exam = {
      x: 22, y: 16, fn: () => this.showDialog([
        "大きな 岩が 通路を ふさいでいる。\n岩の すきまから あたたかい 風が\nふいてくる…。",
        "（くずれそうで あぶない。\nいまは 通れそうに ない）",
      ]),
    };
    this.deepGateExam = exam;
    this.nectarExam.push(exam);
  }

  /** 救出イベント直後に岩をどかす（同一シーン内での開通）。 */
  private removeLavaDeepGate(): void {
    if (this.deepGateExam) {
      const idx = this.nectarExam.indexOf(this.deepGateExam);
      if (idx >= 0) this.nectarExam.splice(idx, 1);
      this.deepGateExam = undefined;
    }
    if (this.deepGateRock) {
      const rock = this.deepGateRock;
      this.deepGateRock = undefined;
      this.cameras.main.shake(280, 0.004);
      this.tweens.add({ targets: rock, alpha: 0, scale: 0.6, duration: 500, onComplete: () => rock.destroy() });
    }
  }

  /** 深部の点景 — 裂け目の熱・立ちのぼる火の粉・暖色トーン。 */
  private placeLavaTubeDeepDecor(): void {
    const ts = this.tileSize;
    if (!this.textures.exists("ember-spark")) {
      const c = document.createElement("canvas"); c.width = 6; c.height = 6;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "rgba(255,150,60,0.95)"; ctx.fillRect(2, 2, 2, 2);
      ctx.fillStyle = "rgba(255,110,40,0.45)";
      ctx.fillRect(1, 2, 1, 2); ctx.fillRect(4, 2, 1, 2); ctx.fillRect(2, 1, 2, 1); ctx.fillRect(2, 4, 2, 1);
      this.textures.addCanvas("ember-spark", c);
    }
    // fissure hotspots (must match the tile-100 cells in lava_tube_deep.json)
    const spots: [number, number][] = [[17.5, 8.5], [16.5, 10], [19, 7.5], [17.5, 12], [3, 8.5], [6, 7]];
    for (const [hx, hy] of spots) {
      const glow = this.add.circle(hx * ts, hy * ts, ts * 0.7, 0xff7830, 0.16).setDepth(6);
      this.tweens.add({ targets: glow, alpha: 0.07, scale: 1.25, duration: 1000 + Math.random() * 600,
        yoyo: true, repeat: -1, ease: "Sine.inOut" });
    }
    for (let i = 0; i < 10; i++) {
      const src = spots[i % spots.length];
      const sx = () => (src[0] + (Math.random() - 0.5) * 2) * ts;
      const sy = () => (src[1] + (Math.random() - 0.5)) * ts;
      const spark = this.add.image(sx(), sy(), "ember-spark")
        .setDepth(27).setAlpha(0).setScale(0.8 + Math.random() * 0.9);
      this.tweens.add({
        targets: spark, y: `-=${40 + Math.random() * 70}`, alpha: { from: 0.9, to: 0 },
        duration: 2000 + Math.random() * 2000, repeat: -1, ease: "Sine.out", delay: Math.random() * 2200,
        onRepeat: () => { spark.x = sx(); spark.y = sy(); },
      });
    }
    this.add.rectangle(0, 0, this.mapData.width * ts, this.mapData.height * ts, 0xff8040, 0.08)
      .setOrigin(0).setDepth(26);
  }

  /** リルの谷 — 看板2枚（教育: リル＝溶岩が流れた跡の溝）。 */
  private placeRillRouteEvents(): void {
    this.genNectarEventTextures();
    const ts = this.tileSize;
    const put = (key: string, x: number, y: number, fn: () => void, dy = 0) => {
      this.add.image(x * ts + ts / 2, y * ts + ts / 2 + dy, key).setDepth(8);
      this.nectarExam.push({ x, y, fn });
    };
    put("nectar-sign", 11, 21, () => this.showDialog([
      "『リルのたに』",
      "リル とは 月の 溝（みぞ）のこと。",
      "大むかしに 溶岩が 川のように 流れ、\nその あとが 谷に なって のこった。",
    ]), -4);
    put("nectar-sign", 11, 3, () => this.showDialog([
      "↑ この先 ミノリタウン",
      "豊かの海（Fecunditatis）の ほとり。\n地熱農園と ルナ16号の 町。",
    ]), -4);
  }

  /** ミノリタウン — 看板・ルナ16号きねんひ・農園主・市場・ヴォイス団員（会話のみ）。 */
  private placeMinoriTownEvents(): void {
    this.genNectarEventTextures();
    const ts = this.tileSize;
    const put = (key: string, x: number, y: number, fn: () => void, dy = 0) => {
      this.add.image(x * ts + ts / 2, y * ts + ts / 2 + dy, key).setDepth(8);
      this.nectarExam.push({ x, y, fn });
    };

    // 町の看板（南門のそば）
    put("nectar-sign", 27, 42, () => this.showDialog([
      "『ミノリタウン』",
      "豊かの海の ほとり。\n地熱農園の めぐみと ともに 生きる町。",
    ]), -4);

    // ジムの看板（ジム前の広場）
    put("nectar-sign", 21, 8, () => this.showDialog([
      "『ミノリジム』\nリーダー：イシイ＆シオリ",
      "「2人で ひとつ！ ダブルバトルで\nむかえうつ！」",
      "※ジムの マグマは バルブで\nながれを きりかえられる らしい。",
    ]), -4);

    // 農園の看板（段々畑の入口）
    put("nectar-sign", 12, 17, () => this.showDialog([
      "『ミノリ地熱農園』",
      "地下の 熱で 土を あたため、\nライトの 光で そだてる 段々畑。",
      "収かくした 野菜は となりの\n市場どおりで 売られる。",
    ]), -4);

    // ルナ16号きねんひ（広場の中央・教育の柱）
    if (!this.textures.exists("luna16-monument")) {
      const c = document.createElement("canvas"); c.width = 40; c.height = 52;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      // pedestal
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(20, 48, 16, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8a8272"; ctx.fillRect(8, 40, 24, 8);
      ctx.fillStyle = "#a89f8c"; ctx.fillRect(8, 40, 24, 3);
      // descent stage: 4 legs + tank body + antenna dish
      ctx.strokeStyle = "#6e6658"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(12, 40); ctx.lineTo(16, 30); ctx.moveTo(28, 40); ctx.lineTo(24, 30); ctx.stroke();
      ctx.fillStyle = "#b8b0a0";
      ctx.beginPath(); ctx.arc(20, 26, 9, 0, Math.PI * 2); ctx.fill();   // spherical tank
      ctx.fillStyle = "#d8d2c4";
      ctx.beginPath(); ctx.arc(17, 23, 3.5, 0, Math.PI * 2); ctx.fill(); // highlight
      ctx.fillStyle = "#7a7264"; ctx.fillRect(17, 10, 6, 8);             // return-capsule stem
      ctx.fillStyle = "#e8e2d4";
      ctx.beginPath(); ctx.arc(20, 8, 5, 0, Math.PI * 2); ctx.fill();    // return capsule
      ctx.strokeStyle = "#5e574c"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(20, 26, 9, 0, Math.PI * 2); ctx.stroke();
      this.textures.addCanvas("luna16-monument", c);
    }
    // きねんひ本体は広場中央に大きめ表示
    const mon = this.add.image(26 * ts + ts / 2, 22 * ts + ts / 2 - 8, "luna16-monument").setDepth(8);
    mon.setScale(1.5);
    this.nectarExam.push({
      x: 26, y: 22, fn: () => this.showDialog([
        "『ルナ16号 きねんひ』",
        "1970年、ソれんの 探査機 ルナ16号が\nここ 豊かの海に 着陸した。",
        "世界で はじめて 無人で 月の 土を\n地球へ 持ち帰る ことに 成功——\nその量、101グラム。",
        "おかえり用の カプセルは 地球へ。\n着陸だいは いまも 月面に のこっている。",
      ]),
    });

    // 農園主（地熱×温室の教育・段々畑のそば）
    put(this.npcTex("cast-char2-down", "npc-kinoshita"), 14, 18, () => this.showDialog([
      "農園主「この 段々畑はね、地下の\nあったかい 熱と ライトの 光で\n野菜を そだてて いるんだ。」",
      "農園主「月の砂 レゴリスは そのままじゃ\n作物に きびしい。水と 栄養を まぜて\n土に 作りかえて いるのさ。」",
      "農園主「『豊かの海』の 名前に まけない\n実りを つくる。それが この町の ゆめさ。」",
    ]));

    // 市場の屋台（3けん・調べると売り子の口上）
    put("minori-stall", 34, 19, () => this.showDialog([
      "「とれたて 地熱トマト だよ〜！\nひえた 夜の 月でも あまく そだつのさ！」",
    ]), -6);
    put("minori-stall", 38, 19, () => this.showDialog([
      "「レゴリスがま で じっくり やいた\nいしやきいも〜。ホカホカ だよ〜。」",
    ]), -6);
    put("minori-stall", 42, 19, () => this.showDialog([
      "「農園はちみつ の ムーンハニー。\n…はちは ドームの 中に いるんだよ。」",
    ]), -6);

    // 市場の買いもの客（教育：月の昼夜と作物）
    put(this.npcTex("cast-char8-down", "npc-mom"), 38, 22, () => this.showDialog([
      "月の 昼と 夜は それぞれ\n地球の 2週間も つづくの。",
      "おひさまだけじゃ 野菜は そだたない。\nだから この町は 地熱と ライトの\n二本立て なのよ。かしこいでしょ？",
    ]));

    // 広場の子ども（ルナ16号あこがれ）
    put(this.npcTex("cast-char5-down", "npc-mom"), 23, 20, () => this.showDialog([
      "ぼくね、ルナ16号 みたいな\nロボット探査機を つくるのが ゆめ！",
      "人が いなくても 月の 土を\nもって帰れるん だよ？ すごくない？",
    ]));

    // ヴォイス団員（会話のみ・追跡型の情報断片 / ヴォイス編v2 §3）
    put(this.npcTex("cast-voice_grunt3-down", "npc-kinoshita"), 45, 22, () => this.showDialog([
      "……チッ。豊かの海にも\n水の 手がかりは なし、か。",
      "ん？ なんだよ ガキ。おれたちは\nただの 調査員…… そう、\nヴォイスの ちょうさいん さまだ。",
      "おぼえて おけ。『水を 制する ものが\n月を 制する』。ボスたちは もう\n南極の 秘密に 手を かけてるのさ。",
    ]));

    // 太陽光ファームの看板（門の外・教育＋南極伏線）
    put("nectar-sign", 41, 33, () => this.showDialog([
      "『ミノリ太陽光ファーム』",
      "月の 昼は 2週間 つづく。\nその間 パネルは 発電し ほうだい！",
      "でも 夜も 2週間 つづく…。\nためた 電気と 地熱プラントの\n二本立てで 町を まもっている。",
      "※南極には 『ほぼ 一日じゅう 日の当たる 峰』が あるらしい。発電の 聖地だ。",
    ]), -4);

    // 太陽光ファームの整備員（レゴリスの静電気の教育＋初回はデブリのかけら）
    put(this.npcTex("cast-char3-down", "npc-kinoshita"), 40, 38, () => {
      const given = this.awardNectarItem("minori_solar_gift", "debris_fragment", "デブリのはへん", [
        "整備員「パネルの そうじが 毎日\n大しごとさ。月の ちり——レゴリスは\n静電気で ペタペタ くっつくんだ。」",
        "整備員「こないだは 小さな デブリが\nパネルの わくに コツンと あたってな。\nひろった かけら、きみに やるよ。」",
        "整備員「リサイクルショップで\nいい 値が つくらしいぜ。」",
      ]);
      if (!given) this.showDialog([
        "整備員「ちりが つもると 発電が\nガクンと おちる。だから ほうきロボと\n二人三きゃくで ピカピカに してる。」",
        "整備員「かけらは 役に立ったかい？」",
      ]);
    });

    // 地熱プラントの作業員（夜の2週間の心臓）
    put(this.npcTex("cast-char7-down", "npc-kinoshita"), 27, 36, () => this.showDialog([
      "作業員「ここは 地熱プラント。地下の\n熱で タービンを 回して、電気と\nおんすいを 作ってるんだ。」",
      "作業員「太陽が しずむ 夜の 2週間は、\nここが 町の 心ぞうに なる。\n畑の 土も ここの 熱で ぬくぬくさ。」",
    ]));

    // 温室の看板（ミツバチ＝ムーンハニーの種明かし）
    put("nectar-sign", 9, 34, () => this.showDialog([
      "『ミノリ温室』",
      "デリケートな 野菜と くだものは\nガラスの 中で そだてる。",
      "市場の 『ムーンハニー』の ミツバチも\nこの 温室に すんでいる。",
    ]), -4);

    // 温室前のミツバチ係（左下の施設イベント：初回ムーンハニー×2）
    put(this.npcTex("cast-char4-down", "npc-mom"), 5, 37, () => {
      if (!this.hasPitFlag("minori_honey_gift")) {
        this.setPitFlag("minori_honey_gift");
        if (this.playerState) {
          const it = this.playerState.items.find(i => i.id === "moon_honey");
          if (it) it.count += 2;
          else this.playerState.items.push({ id: "moon_honey", count: 2 });
        }
        this.showDialog([
          "ミツバチ係「この 温室の ハチは\n月そだち。地球の ハチより ゆっくり\n飛ぶのが かわいいのよ。」",
          "ミツバチ係「今日は はちみつが\nとれたての とれたて。おすそわけ！」",
          "「ムーンハニー」を 2つ てにいれた！",
          "ミツバチ係「アルモンの HPが 40\nかいふくするわ。どうぐ から つかってね。」",
        ]);
      } else {
        this.showDialog([
          "ミツバチ係「ハチも 野菜も 人も、\nみんな 温室の おかげで 元気元気。」",
        ]);
      }
    });

    // 東門の警備員 — フェカンドバッジ（ジム3制覇）までタウルス山道は通行止め
    if (!this.playerState?.defeatedTrainers.includes("ishii_shiori")) {
      put(this.npcTex("cast-astronaut-left", "npc-kinoshita"), 50, 20, () => this.showDialog([
        "警備員「この先は タウルスさんどう。\n晴れの海へ つづく 山道だが、\n野生アルモンが 強くてな。」",
        "警備員「ミノリジムの 『フェカンドバッジ』を\n持った トレーナーしか 通せない きまりだ。」",
      ]));
    } else {
      put(this.npcTex("cast-astronaut-down", "npc-kinoshita"), 50, 19, () => this.showDialog([
        "警備員「おっ、フェカンドバッジ！\nイシイ＆シオリの 2人を やぶったのか。\nたいしたもんだ、通って いいぞ。」",
        "警備員「山道には 黒ずくめの 連中が\nうろついてる って 話だ。気を つけてな。」",
      ]));
    }

    // 東門の看板
    put("nectar-sign", 47, 19, () => this.showDialog([
      "→ タウルスさんどう",
      "晴れの海（うみ）方面。\nつづら折りの 山道に つき 注意。",
    ]), -4);

    // 北東のリル研究者（右上の施設イベント：初回スターカプセル）
    put(this.npcTex("cast-char9-down", "npc-kinoshita"), 38, 7, () => {
      const given = this.awardNectarItem("minori_rille_gift", "star_capsule", "スターカプセル", [
        "研究者「この 大きな 溝が リルだ。\n大むかしの 溶岩の 通り道——\n地下トンネルの 天井が 落ちて\nできた と 考えられている。」",
        "研究者「タテアナ村の 縦孔も、こういう\nトンネルに あいた 天まどなのさ。\n月は ぜんぶ つながっている！」",
        "研究者「調査を 手つだって くれた\nお礼だ。もって いきなさい。」",
      ]);
      if (!given) this.showDialog([
        "研究者「リルの 全長は 数百キロに\nなる ものも ある。月は ほんとうに\nスケールが でかいなあ。」",
      ]);
    });
  }

  /** ミノリタウンの点景 — 蒸気の噴気孔・パイプ・市場・広場・アルモンの暮らし。 */
  private placeMinoriDecor(): void {
    const ts = this.tileSize;

    // --- 屋台テクスチャ（しましま日よけ＋野菜の木箱） ---
    if (!this.textures.exists("minori-stall")) {
      const c = document.createElement("canvas"); c.width = 44; c.height = 40;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(22, 36, 18, 4, 0, 0, Math.PI * 2); ctx.fill();
      // counter + legs
      ctx.fillStyle = "#8a6636"; ctx.fillRect(6, 22, 32, 10);
      ctx.fillStyle = "#a07d45"; ctx.fillRect(6, 22, 32, 3);
      ctx.fillStyle = "#5a4020"; ctx.fillRect(7, 32, 4, 6); ctx.fillRect(33, 32, 4, 6);
      // awning (terracotta / cream stripes)
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 === 0 ? "#d86038" : "#f2e8d0";
        ctx.fillRect(2 + i * 7, 6, 7, 8);
      }
      ctx.fillStyle = "#b84c28"; ctx.fillRect(2, 12, 40, 2);
      ctx.fillStyle = "#5a4020"; ctx.fillRect(3, 6, 2, 20); ctx.fillRect(39, 6, 2, 20);
      // produce crate
      ctx.fillStyle = "#c9a95d"; ctx.fillRect(12, 16, 20, 8);
      ctx.fillStyle = "#e05838"; ctx.beginPath(); ctx.arc(16, 19, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e8a030"; ctx.beginPath(); ctx.arc(22, 18, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#68a848"; ctx.beginPath(); ctx.arc(28, 19, 3, 0, Math.PI * 2); ctx.fill();
      this.textures.addCanvas("minori-stall", c);
    }

    // --- 噴気孔（岩の口＋のぼる蒸気） ---
    if (!this.textures.exists("minori-vent")) {
      const c = document.createElement("canvas"); c.width = 30; c.height = 22;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(15, 18, 12, 3.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8a8272";
      ctx.beginPath(); ctx.ellipse(15, 13, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#a89f8c";
      ctx.beginPath(); ctx.ellipse(15, 11, 10, 5.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#2e2822";
      ctx.beginPath(); ctx.ellipse(15, 11, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
      this.textures.addCanvas("minori-vent", c);
    }
    if (!this.textures.exists("steam-puff")) {
      const c = document.createElement("canvas"); c.width = 16; c.height = 16;
      const ctx = c.getContext("2d")!;
      const grd = ctx.createRadialGradient(8, 8, 1, 8, 8, 8);
      grd.addColorStop(0, "rgba(255,255,255,0.85)"); grd.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(8, 8, 8, 0, Math.PI * 2); ctx.fill();
      this.textures.addCanvas("steam-puff", c);
    }
    const vents: [number, number][] = [[19.5, 32.5], [13.8, 33.8], [12.5, 37.5], [18.5, 39.8], [30.5, 34.2]];
    for (const [vx, vy] of vents) {
      this.add.image(vx * ts, vy * ts, "minori-vent").setDepth(7).setScale(1.15);
      for (let i = 0; i < 2; i++) {
        const puff = this.add.image(vx * ts, vy * ts - 6, "steam-puff")
          .setDepth(27).setAlpha(0).setScale(0.7);
        this.tweens.add({
          targets: puff, y: vy * ts - 6 - 34 - Math.random() * 18,
          alpha: { from: 0.75, to: 0 }, scale: { from: 0.7, to: 1.6 },
          duration: 1900 + Math.random() * 900, repeat: -1, ease: "Sine.out",
          delay: i * 1000 + Math.random() * 600,
          onRepeat: () => { puff.y = vy * ts - 6; puff.x = (vx + (Math.random() - 0.5) * 0.3) * ts; },
        });
      }
    }

    // --- 地熱パイプ（噴気孔の熱を畑へ送る） ---
    if (!this.textures.exists("geo-pipe-v")) {
      const c = document.createElement("canvas"); c.width = 10; c.height = 96;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#707888"; ctx.fillRect(2, 0, 6, 96);
      ctx.fillStyle = "#8a92a4"; ctx.fillRect(2, 0, 2, 96);
      ctx.fillStyle = "#565e6e";
      for (let y = 10; y < 96; y += 22) ctx.fillRect(0, y, 10, 4);
      this.textures.addCanvas("geo-pipe-v", c);
    }
    this.add.image(13.8 * ts, 32 * ts - 42, "geo-pipe-v").setDepth(6);   // 噴気孔→畑B
    if (!this.textures.exists("geo-pipe-h")) {
      const c = document.createElement("canvas"); c.width = 96; c.height = 10;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#707888"; ctx.fillRect(0, 2, 96, 6);
      ctx.fillStyle = "#8a92a4"; ctx.fillRect(0, 2, 96, 2);
      ctx.fillStyle = "#565e6e";
      for (let x = 10; x < 96; x += 22) ctx.fillRect(x, 0, 4, 10);
      this.textures.addCanvas("geo-pipe-h", c);
    }
    this.add.image(10.6 * ts, 36.9 * ts, "geo-pipe-h").setDepth(6);      // 噴気孔→温室

    // --- 地熱プラントの煙突から立ちのぼる大きめの蒸気 ---
    for (let i = 0; i < 3; i++) {
      const puff = this.add.image(32.7 * ts, 36.6 * ts, "steam-puff")
        .setDepth(27).setAlpha(0).setScale(1.1);
      this.tweens.add({
        targets: puff, y: 36.6 * ts - 52 - Math.random() * 22,
        alpha: { from: 0.8, to: 0 }, scale: { from: 1.1, to: 2.4 },
        duration: 2300 + Math.random() * 800, repeat: -1, ease: "Sine.out",
        delay: i * 800,
        onRepeat: () => { puff.y = 36.6 * ts; puff.x = (32.7 + (Math.random() - 0.5) * 0.25) * ts; },
      });
    }

    // --- 太陽光パネルのきらめき ---
    if (!this.textures.exists("pit-spark")) {
      const c = document.createElement("canvas"); c.width = 6; c.height = 6;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "rgba(255,255,255,0.95)"; ctx.fillRect(2, 2, 2, 2);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillRect(1, 2, 1, 2); ctx.fillRect(4, 2, 1, 2); ctx.fillRect(2, 1, 2, 1); ctx.fillRect(2, 4, 2, 1);
      this.textures.addCanvas("pit-spark", c);
    }
    for (const [gx, gy] of [[41.4, 35.7], [45.6, 36.4], [42.6, 39.7], [46.4, 40.6]] as [number, number][]) {
      const glint = this.add.image(gx * ts, gy * ts, "pit-spark").setDepth(27).setAlpha(0).setScale(1.6);
      this.tweens.add({ targets: glint, alpha: { from: 0, to: 0.95 }, duration: 700 + Math.random() * 500,
        yoyo: true, repeat: -1, repeatDelay: 1400 + Math.random() * 1600, ease: "Sine.inOut" });
    }

    // --- 広場のランタン＆ベンチ＆旗 ---
    if (!this.textures.exists("pit-lantern")) {
      const c = document.createElement("canvas"); c.width = 20; c.height = 44;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#5a4020"; ctx.fillRect(9, 10, 3, 32);
      ctx.fillStyle = "#8a6636"; ctx.fillRect(9, 10, 1, 32);
      ctx.fillStyle = "#3a3a44"; ctx.fillRect(5, 4, 11, 10);
      ctx.fillStyle = "#ffdf8a"; ctx.fillRect(7, 6, 7, 6);
      ctx.fillStyle = "#fff4c8"; ctx.fillRect(9, 7, 3, 4);
      this.textures.addCanvas("pit-lantern", c);
    }
    for (const [x, y] of [[20.5, 17.6], [31.5, 17.6], [20.5, 26.5], [31.5, 26.5]] as [number, number][]) {
      this.add.image(x * ts, y * ts, "pit-lantern").setDepth(8).setScale(1.2);
      const glow = this.add.circle(x * ts + 1, y * ts - 12, 9, 0xffd070, 0.26).setDepth(8);
      this.tweens.add({ targets: glow, alpha: 0.1, scale: 1.3, duration: 950 + Math.random() * 500,
        yoyo: true, repeat: -1, ease: "Sine.inOut" });
    }
    if (!this.textures.exists("minori-bench")) {
      const c = document.createElement("canvas"); c.width = 30; c.height = 14;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#5a4020"; ctx.fillRect(3, 8, 3, 6); ctx.fillRect(24, 8, 3, 6);
      ctx.fillStyle = "#8a6636"; ctx.fillRect(1, 4, 28, 5);
      ctx.fillStyle = "#a07d45"; ctx.fillRect(1, 4, 28, 2);
      this.textures.addCanvas("minori-bench", c);
    }
    this.add.image(23 * ts, 25.4 * ts, "minori-bench").setDepth(7).setScale(1.2);
    this.add.image(29.5 * ts, 25.4 * ts, "minori-bench").setDepth(7).setScale(1.2);
    if (!this.textures.exists("minori-flag")) {
      const c = document.createElement("canvas"); c.width = 24; c.height = 46;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#8a92a4"; ctx.fillRect(3, 2, 2, 44);
      ctx.fillStyle = "#e05838";
      ctx.beginPath(); ctx.moveTo(5, 4); ctx.lineTo(22, 8); ctx.lineTo(5, 13); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#f2e8d0";
      ctx.beginPath(); ctx.arc(10, 8.5, 2, 0, Math.PI * 2); ctx.fill();
      this.textures.addCanvas("minori-flag", c);
    }
    this.add.image(24.5 * ts, 21.2 * ts, "minori-flag").setDepth(8);
    this.add.image(27.5 * ts, 21.2 * ts, "minori-flag").setDepth(8);

    // --- アルモンの暮らし ---
    // 噴気孔で ひなたぼっこ ならぬ「湯気ぼっこ」するメテコ
    if (this.textures.exists("monster-meteko")) {
      const m = this.add.image(13.6 * ts, 36.9 * ts, "monster-meteko").setDepth(8);
      m.setScale((ts * 0.95) / (m.height || 100));
      this.tweens.add({ targets: m, y: "-=3", duration: 700, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    }
    // リルの溝のふちで甲羅干しするゲンブー
    if (this.textures.exists("monster-genbu")) {
      const g = this.add.image(41.5 * ts, 7.6 * ts, "monster-genbu").setDepth(8);
      g.setScale((ts * 1.0) / (g.height || 100));
      this.tweens.add({ targets: g, y: "-=2", duration: 1150, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    }
    // 畑のそばでレンガを積むプリボ
    if (this.textures.exists("monster-pribo")) {
      const p = this.add.image(16.6 * ts, 10.4 * ts, "monster-pribo").setDepth(8);
      p.setScale((ts * 0.9) / (p.height || 100));
      this.tweens.add({ targets: p, y: "-=3", duration: 620, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    }
    // 広場の上を舞うホタルナ
    if (this.textures.exists("monster-hotaruna")) {
      for (let i = 0; i < 2; i++) {
        const fly = this.add.image(26 * ts, 20 * ts, "monster-hotaruna").setDepth(27);
        fly.setScale((ts * 0.5) / (fly.height || 100)).setAlpha(0.9);
        const rx = 60 + i * 26, dur = 3000 + i * 800;
        this.tweens.add({ targets: fly, x: { from: 26 * ts - rx, to: 26 * ts + rx }, duration: dur,
          yoyo: true, repeat: -1, ease: "Sine.inOut", delay: i * 500,
          onYoyo: () => fly.setFlipX(true), onRepeat: () => fly.setFlipX(false) });
        this.tweens.add({ targets: fly, y: { from: 19 * ts, to: 22.5 * ts }, duration: dur * 0.62,
          yoyo: true, repeat: -1, ease: "Sine.inOut", delay: i * 300 });
      }
    }

    // --- 実りの暖色トーン ---
    this.add.rectangle(0, 0, this.mapData.width * ts, this.mapData.height * ts, 0xffb070, 0.05)
      .setOrigin(0).setDepth(26);
  }

  /** タウルスさんどう — 看板・展望スポット・岩くずれ・調査員救出（ジム4への道v1）。 */
  private placeTaurusPassEvents(): void {
    this.genNectarEventTextures();
    const ts = this.tileSize;
    const put = (key: string, x: number, y: number, fn: () => void, dy = 0) => {
      this.add.image(x * ts + ts / 2, y * ts + ts / 2 + dy, key).setDepth(8);
      this.nectarExam.push({ x, y, fn });
    };

    // 入口の看板（教育: タウルス山地）
    put("nectar-sign", 2, 19, () => this.showDialog([
      "『タウルスさんどう』",
      "晴れの海の 南の ふちに つらなる\n本物の 山地。月の 山は 隕石の\n衝突で もり上がった 地形だ。",
    ]), -4);

    // 展望スポット（教育: アポロ17号・最後の有人月面着陸）
    put("nectar-sign", 21, 8, () => this.showDialog([
      "『展望スポット』",
      "見わたす かぎりの 晴れの海——。",
      "むこうの 谷は タウルス・リットロウ渓谷。\n1972年、アポロ17号が 降りた 場所だ。",
      "人類が 最後に 月を 歩いてから、\nもう 50年い上。……つぎに 歩くのは、\nあなたかも しれない。",
    ]), -4);

    // 北端の岩くずれ → 復旧かんりょう！ 作業員がセレネタウンへの道をあけた
    put(this.npcTex("cast-char3-down", "npc-kinoshita"), 13, 2, () => this.showDialog([
      "作業員「岩くずれの 復旧、かんりょう！\nこの先が セレネタウン——\n光の ジムの 町だ。」",
      "作業員「町の 鏡の タワーが 太陽の 光を\nあつめて いるのさ。きらきら\nまぶしいから 気をつけてな！」",
    ]));

    // 調査員（したっぱペアに絡まれている → 撃破後に救出・お礼）
    const rescued = this.playerState?.defeatedTrainers.includes("voice_pair_taurus");
    put(this.npcTex("cast-char8-down", "npc-kinoshita"), 11, 2, () => {
      if (!rescued) {
        this.showDialog([
          "調査員「た、たすけて…！ この 2人組、\nわたしの 『水しらべの データ』を\nよこせって…！」",
        ]);
        return;
      }
      const given = this.awardNectarItem("taurus_rescue_gift", "star_capsule", "スターカプセル", [
        "調査員「たすかった…！ ありがとう！」",
        "調査員「あいつら『参謀キヨハラ』の 部下だと\n名のっていた。晴れの海の 先の 『水』を\nかぎまわって いるらしい…。」",
        "調査員「あなたのような 人が いれば 心強い。\nこれ、お礼に うけとって！」",
      ]);
      if (!given) this.showDialog([
        "調査員「データは ぶじだった。\n『キヨハラ』…… その名前、\nおぼえておいた ほうが いい。」",
      ]);
    });

    // したっぱペアの相方（バトルは1エントリで2人ぶん）
    if (!rescued) {
      this.add.image(10 * ts + ts / 2, 2 * ts + ts / 2, this.npcTex("cast-voice_grunt4-down", "npc-kinoshita")).setDepth(9);
      this.nectarExam.push({
        x: 10, y: 2, fn: () => this.showDialog([
          "「あ？ おれたちに 用なら\n相棒に 声を かけな。2たい2だ」",
        ]),
      });
    }
  }

  // ---- セレネタウン: 光の町のイベント・演出 ----

  /** セレネタウン初回到着のひとこと。 */
  private playSereneArrival(): void {
    if (this.hasPitFlag("serene_arrival_seen")) return;
    this.setPitFlag("serene_arrival_seen");
    this.inCutscene = true;
    this.showDialog([
      "（岩くずれの むこうに ひらけた 町——\nかがみの タワーが きらきら 光ってる）",
      "ここが セレネタウン。\n太陽の 光を あつめる 『光の町』だ！",
    ], () => { this.inCutscene = false; });
  }

  private placeSereneTownEvents(): void {
    this.genNectarEventTextures();
    const ts = this.tileSize;
    const put = (key: string, x: number, y: number, fn: () => void, dy = 0) => {
      this.add.image(x * ts + ts / 2, y * ts + ts / 2 + dy, key).setDepth(8);
      this.nectarExam.push({ x, y, fn });
    };

    // 南門の町名看板
    put("nectar-sign", 20, 35, () => this.showDialog([
      "『セレネタウン』",
      "かがみで 太陽の光を あつめる 光の町。\n夜が 2週間 つづく 月でも、この町は\nいつも あかるい。",
    ]), -4);

    // 海岸の看板（教育: 晴れの海）
    put("nectar-sign", 18, 5, () => this.showDialog([
      "『晴れの海』",
      "月の 北東に ひろがる 大きな 海。\nもちろん 水は なくて、大むかしの\n溶岩が かたまった 平原だ。",
      "南東の ふちには アポロ17号が おりた\nタウルス・リットロウ渓谷が ある。",
    ]), -4);

    // ルノホート2号きねんひ（広場の中央・教育）
    if (!this.textures.exists("serene-lunokhod")) {
      const c = document.createElement("canvas"); c.width = 44; c.height = 40;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.ellipse(22, 36, 18, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8f9aab"; ctx.fillRect(6, 28, 32, 6);           // pedestal
      ctx.fillStyle = "#b8c2d2"; ctx.fillRect(6, 28, 32, 2);
      // tub-shaped rover body with lid
      ctx.fillStyle = "#c9a94e"; ctx.fillRect(10, 14, 24, 9);
      ctx.fillStyle = "#e8d290"; ctx.fillRect(10, 14, 24, 3);
      ctx.fillStyle = "#7a6a34"; ctx.fillRect(10, 21, 24, 2);
      // lid (solar panel) open
      ctx.fillStyle = "#3a4a6e"; ctx.fillRect(12, 8, 20, 5);
      ctx.strokeStyle = "#7890c0"; ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(14 + i * 5, 8); ctx.lineTo(14 + i * 5, 13); ctx.stroke(); }
      // 8 wheels
      ctx.fillStyle = "#3c3630";
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(13 + i * 6, 26, 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = "#5c564e";
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(13 + i * 6, 26, 1.2, 0, Math.PI * 2); ctx.fill(); }
      // antenna
      ctx.strokeStyle = "#d8e0ec"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(32, 14); ctx.lineTo(38, 4); ctx.stroke();
      this.textures.addCanvas("serene-lunokhod", c);
    }
    this.add.image(21 * ts + ts / 2, 17 * ts + ts / 2 - 6, "serene-lunokhod").setDepth(8).setScale(1.5);
    this.nectarExam.push({ x: 21, y: 17, fn: () => this.showDialog([
      "『ルノホート2号 きねんひ』",
      "1973年、ソれんの 無人ローバー\n『ルノホート2号』が この 晴れの海の\nふちに おりたった。",
      "リモコンそうさで 月面を 39km も 走破！\nその 記録は 40年ちかく やぶられなかった。",
      "せなかの レーザー反射器は、いまも\n地球からの 実験に つかわれているんだ。",
    ]) });

    // 天文台の博士（教育＋スターカプセル）
    put(this.npcTex("cast-char6-down", "npc-kinoshita"), 35, 13, () => {
      const given = this.awardNectarItem("serene_obs_gift", "star_capsule", "スターカプセル", [
        "博士「ようこそ 天文台へ！ 月はね、\n空気が ないから 星が またたかないんだ。\n望遠鏡には 最高の 場所なのさ。」",
        "博士「昼でも 空は まっくら。太陽と 星が\nいっしょに 見えるんだよ。」",
        "博士「観測の きねんに これを あげよう！」",
      ]);
      if (!given) this.showDialog([
        "博士「今夜も 地球の ひかりが きれいだ。\n月から 見る 地球は、満ち欠けが\n地球から 見る 月と 逆に なるんだよ。」",
      ]);
    });

    // ミラーヤードの技師（教育＋ハイリペアジェル）
    put(this.npcTex("cast-char8-down", "npc-kinoshita"), 7, 22, () => {
      const given = this.awardNectarItem("serene_mirror_gift", "hi_repair_gel", "ハイリペアジェル", [
        "技師「この 鏡の タワーは ヘリオスタット。\n太陽を おいかけて、光を まんなかの\n『集熱塔』の 1点に あつめるんだ。」",
        "技師「あつまった 光は 熱と 電気になる。\n月の 夜は 2週間も つづくから、\n昼の あいだに ためて おくのさ。」",
        "技師「見学 ありがとう。これ、つかって！」",
      ]);
      if (!given) this.showDialog([
        "技師「鏡は いつも ピカピカに みがく。\nレゴリスの ほこりが てきなのさ。」",
      ]);
    });

    // プリズムの泉（広場西・にじの教育）
    if (!this.textures.exists("serene-prism")) {
      const c = document.createElement("canvas"); c.width = 36; c.height = 36;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(18, 32, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#9aa4b8"; ctx.beginPath(); ctx.ellipse(18, 28, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c2ccdf"; ctx.beginPath(); ctx.ellipse(18, 26, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#7f8aa0"; ctx.fillRect(15, 16, 6, 10);
      // crystal prism
      ctx.fillStyle = "#dff2ff";
      ctx.beginPath(); ctx.moveTo(18, 2); ctx.lineTo(26, 16); ctx.lineTo(10, 16); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.moveTo(18, 2); ctx.lineTo(21, 16); ctx.lineTo(15, 16); ctx.closePath(); ctx.fill();
      this.textures.addCanvas("serene-prism", c);
    }
    put("serene-prism", 17, 20, () => this.showDialog([
      "『プリズムの泉』",
      "プリズムに 光を とおすと、白い光が\n7色に わかれて にじが できる。",
      "にじは 『光の 中に かくれていた 色』\nなんだよ。",
    ]), -6);

    // 月の日時計（広場北東・とてもゆっくり動くかげ）
    if (!this.textures.exists("serene-sundial")) {
      const c = document.createElement("canvas"); c.width = 40; c.height = 34;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(20, 30, 16, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#cfd6e2"; ctx.beginPath(); ctx.ellipse(20, 24, 17, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e8edf3"; ctx.beginPath(); ctx.ellipse(20, 22, 17, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#8a94a8"; ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(20, 22);
        ctx.lineTo(20 + Math.cos(a) * 15, 22 + Math.sin(a) * 6.5); ctx.stroke();
      }
      // gnomon + its long shadow
      ctx.fillStyle = "rgba(40,44,60,0.4)"; ctx.fillRect(21, 22, 13, 2);
      ctx.fillStyle = "#5a6478";
      ctx.beginPath(); ctx.moveTo(20, 8); ctx.lineTo(23, 22); ctx.lineTo(17, 22); ctx.closePath(); ctx.fill();
      this.textures.addCanvas("serene-sundial", c);
    }
    put("serene-sundial", 26, 16, () => this.showDialog([
      "『月の日時計』",
      "月の 1日は 地球の 約29.5日ぶん。\nかげは 目に 見えないほど ゆっくり\nうごいて、1しゅう するのに 1か月！",
      "この 日時計は 『月づき』を はかる\nカレンダー なんだ。",
    ]), -4);

    // 地球見デッキ（桟橋の望遠鏡）
    if (!this.textures.exists("serene-scope")) {
      const c = document.createElement("canvas"); c.width = 30; c.height = 34;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(15, 31, 11, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#5a6478"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(15, 18); ctx.lineTo(8, 30); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(15, 18); ctx.lineTo(22, 30); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(15, 18); ctx.lineTo(15, 29); ctx.stroke();
      // tube pointing up-left at the Earth
      ctx.save(); ctx.translate(15, 16); ctx.rotate(-0.7);
      ctx.fillStyle = "#3a4a6e"; ctx.fillRect(-3, -12, 7, 16);
      ctx.fillStyle = "#7890c0"; ctx.fillRect(-3, -12, 2, 16);
      ctx.restore();
      // little Earth
      ctx.fillStyle = "#4d8fd6"; ctx.beginPath(); ctx.arc(5, 5, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#63c78a"; ctx.fillRect(3, 3, 3, 2); ctx.fillRect(6, 6, 2, 2);
      this.textures.addCanvas("serene-scope", c);
    }
    put("serene-scope", 30, 5, () => this.showDialog([
      "『地球見デッキ』の 望遠鏡を のぞいた…。",
      "まんまるに ちかい 地球が\n青く うかんで いる！",
      "月から 見る 地球は、地球から 見る 月と\n満ち欠けが 逆に なる。月が 新月のとき、\n地球は まんまるに かがやくんだ。",
    ]), -4);

    // ビーコン塔の守り（桟橋）
    put(this.npcTex("cast-char7-down", "npc-kinoshita"), 39, 6, () => this.showDialog([
      "とうもり「この 灯台は 『セレネの灯』。\n晴れの海を わたる ローバーたちの\n道しるべさ。」",
      "とうもり「セレネは ギリシャ神話の\n月の 女神の 名前なんだよ。」",
    ]));

    // ヴォイス団のしたっぱ（海岸西・伏線）
    put(this.npcTex("cast-voice_grunt2-down", "npc-kinoshita"), 6, 6, () => this.showDialog([
      "「……この町の 『あつめた光』、\n参謀キヨハラさまの 計画に\nつかえそうだと 思わないか？」",
      "「おっと、ひとりごとだ。\n気に しないでくれ。」",
    ]));

    // 広場のこども
    put(this.npcTex("cast-char2-down", "npc-kinoshita"), 24, 20, () => this.showDialog([
      "こども「かがみで ひかりを あつめると\nあったかいんだよ！ でも ジムの リーダーは\nもっと まぶしい らしいよ！」",
    ]));

    // 光ジムの扉（準備中・ジム4は次のフェーズ）
    this.nectarExam.push({ x: 7, y: 13, fn: () => this.showDialog([
      "とびらに はりがみが ある。",
      "『光のジム 【セレネジム】は\nただいま かいそうちゅう。\nかいかんを たのしみに まっててね！』",
    ]) });
  }

  /** 光の町の演出: 街灯・ビーコンの明かり・海辺のホタルナ。 */
  private placeSereneDecor(): void {
    const ts = this.tileSize;

    // 街灯（あたたかい光のランプポスト）
    if (!this.textures.exists("serene-lamp")) {
      const c = document.createElement("canvas"); c.width = 16; c.height = 40;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(8, 37, 6, 2.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#5a6478"; ctx.fillRect(7, 12, 3, 24);
      ctx.fillStyle = "#78829a"; ctx.fillRect(7, 12, 1, 24);
      ctx.fillStyle = "#39415a"; ctx.fillRect(4, 4, 9, 9);
      ctx.fillStyle = "#ffe9a8"; ctx.fillRect(5, 5, 7, 7);
      ctx.fillStyle = "#fff7d8"; ctx.fillRect(6, 6, 3, 3);
      this.textures.addCanvas("serene-lamp", c);
    }
    const lampAt = (x: number, y: number) => {
      this.add.image(x * ts + ts / 2, y * ts + ts / 2 - 4, "serene-lamp").setDepth(8);
      const glow = this.add.circle(x * ts + ts / 2, y * ts + ts / 2 - 12, 11, 0xffe9a8, 0.22).setDepth(7);
      this.tweens.add({ targets: glow, alpha: { from: 0.32, to: 0.16 }, scale: { from: 1, to: 1.25 },
        duration: 1400 + (x % 3) * 300, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    };
    for (const [lx, ly] of [[20, 10], [23, 12], [20, 25], [23, 30], [15, 16], [28, 20], [12, 28], [32, 28]] as [number, number][]) {
      lampAt(lx, ly);
    }

    // ビーコン塔のあかり（ゆっくり明滅）
    const bx = 39 * ts, by = 1.4 * ts;
    const beam = this.add.circle(bx, by, 18, 0xfff2b0, 0.3).setDepth(7);
    this.tweens.add({ targets: beam, alpha: { from: 0.45, to: 0.1 }, scale: { from: 1, to: 1.7 },
      duration: 1600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

    // 海辺の ホタルナ（ひかりの アルモンが 波うちぎわで あそぶ）
    for (const [hx, hy, d] of [[12, 4, 0], [30, 3, 700]] as [number, number, number][]) {
      if (!this.textures.exists("monster-hotaruna")) break;
      const m = this.add.image(hx * ts + ts / 2, hy * ts + ts / 2, "monster-hotaruna").setDepth(8);
      m.setScale(28 / Math.max(m.width, m.height));
      const g = this.add.circle(hx * ts + ts / 2, hy * ts + ts / 2, 10, 0xbfe8ff, 0.25).setDepth(7);
      this.tweens.add({ targets: [m, g], y: `-=5`, duration: 1200, yoyo: true, repeat: -1,
        delay: d, ease: "Sine.easeInOut" });
      this.tweens.add({ targets: g, alpha: { from: 0.35, to: 0.12 }, duration: 900, yoyo: true,
        repeat: -1, delay: d, ease: "Sine.easeInOut" });
    }

    // ヘリオスタットの光ビーム: 四隅の鏡 → 中央の集熱塔へ 光が あつまる
    // （ヤード: 鏡(4,18)(10,18)(4,21)(10,21) 2x3 / 集熱塔(7,18) 2x4）
    const orbX = 8 * ts, orbY = 18 * ts + 14;
    for (const [mx, my] of [[4, 18], [10, 18], [4, 21], [10, 21]] as [number, number][]) {
      const sx = (mx + 1) * ts, sy2 = my * ts + 16;
      const beam = this.add.line(0, 0, sx, sy2, orbX, orbY, 0xffe9a8, 0.5)
        .setOrigin(0, 0).setLineWidth(1.6).setDepth(9).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: beam, alpha: { from: 0.55, to: 0.15 },
        duration: 1000 + (mx + my) % 3 * 250, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
    // 集熱塔のオーブのまぶしさ
    const orbGlow = this.add.circle(orbX, orbY, 14, 0xfff2b0, 0.35).setDepth(9)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: orbGlow, alpha: { from: 0.45, to: 0.15 }, scale: { from: 1, to: 1.5 },
      duration: 1300, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

    // 桟橋のガーランド電飾（街灯のあいだに 光の つらなり）
    const garland = (x0: number, x1: number, y: number) => {
      const px0 = x0 * ts + ts / 2, px1 = x1 * ts + ts / 2, py = y * ts - 6;
      const n = Math.max(6, Math.floor((x1 - x0) * 2.2));
      const cols = [0xfff2b0, 0xbfe8ff, 0xffd7a8];
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const gx = px0 + (px1 - px0) * t;
        const gy = py + Math.sin(t * Math.PI) * 10;   // sagging string
        const dot = this.add.circle(gx, gy, 2, cols[i % 3], 0.9).setDepth(8);
        this.tweens.add({ targets: dot, alpha: { from: 0.95, to: 0.3 },
          duration: 600 + (i % 4) * 220, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      }
    };
    lampAt(9, 6); lampAt(15, 6); lampAt(26, 6); lampAt(31, 6);
    garland(9, 15, 6);
    garland(26, 31, 6);

    // プリズムの泉: にじ色の光の つぶが わきあがる
    const fx0 = 17 * ts + ts / 2, fy0 = 20 * ts + 2;
    const rainbow = [0xff6b6b, 0xffb26b, 0xfff26b, 0x7be07b, 0x6bc7ff, 0x9b8bff];
    this.time.addEvent({
      delay: 180, loop: true, callback: () => {
        const i = Math.floor(Math.random() * rainbow.length);
        const p = this.add.circle(fx0 + (Math.random() * 20 - 10), fy0 - Math.random() * 6, 3, rainbow[i], 1)
          .setDepth(9);
        this.tweens.add({ targets: p, y: fy0 - 26 - Math.random() * 10, alpha: 0, scale: 0.5,
          duration: 1300, ease: "Sine.easeOut", onComplete: () => p.destroy() });
      },
    });
    // にじのアーチ（泉の上にうっすら）
    for (let i = 0; i < rainbow.length; i++) {
      const arc = this.add.graphics().setDepth(8);
      arc.lineStyle(2, rainbow[i], 0.65);
      arc.beginPath();
      arc.arc(fx0, fy0 - 4, 22 - i * 2.4, Math.PI, Math.PI * 2);
      arc.strokePath();
      this.tweens.add({ targets: arc, alpha: { from: 0.55, to: 0.2 },
        duration: 1500 + i * 120, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }

    // 町ぜんたいに ほんのり 明るい光のトーン
    this.add.rectangle(0, 0, this.mapData.width * ts, this.mapData.height * ts, 0xfff3c8, 0.045)
      .setOrigin(0, 0).setDepth(40);
  }

  // ---- タウルスのどうくつ: 暗闇＋ぬし ----

  /**
   * たいまつの明かり風の視界オーバーレイ。プレイヤーを中心に半径1.5タイル
   * ほどが明るく、そこから外は暗く沈む（updateで毎フレーム追従）。
   * カメラzoom2.5で見える範囲は約172×252ワールドpxなので、512pxの
   * 1枚絵をプレイヤー中心に置けば画面全体を必ず覆える。
   */
  private placeCaveDarkness(): void {
    if (!this.textures.exists("cave-darkness")) {
      const c = document.createElement("canvas"); c.width = 512; c.height = 512;
      const ctx = c.getContext("2d")!;
      const g = ctx.createRadialGradient(256, 256, 46, 256, 256, 126);
      g.addColorStop(0, "rgba(6,4,12,0)");
      g.addColorStop(0.55, "rgba(6,4,12,0.55)");
      g.addColorStop(1, "rgba(6,4,12,0.88)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 512);
      this.textures.addCanvas("cave-darkness", c);
    }
    this.caveDarkness = this.add.image(this.player.x, this.player.y, "cave-darkness")
      .setDepth(60);
  }

  /** 地下フロアの最奥、ぬしのガンブロス（レベル33・1回きりの野生ボス）。 */
  private placeTaurusCaveBoss(): void {
    if (this.hasPitFlag("taurus_boss_done")) return;
    const ts = this.tileSize;
    const bx = 16, by = 4;
    if (!this.textures.exists("taurus-boss-rock")) {
      const c = document.createElement("canvas"); c.width = 44; c.height = 44;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath(); ctx.ellipse(22, 38, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
      for (const [rx, ry, rr, col] of [[15, 26, 13, "#5a5348"], [30, 28, 11, "#4a443c"], [22, 15, 12, "#6e6658"]] as [number, number, number, string][]) {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(rx, ry, rr, 0, Math.PI * 2); ctx.fill();
      }
      // ひび割れから赤い光（ぬしの気配）
      ctx.strokeStyle = "#ff5a30"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(18, 10); ctx.lineTo(22, 18); ctx.lineTo(19, 24); ctx.stroke();
      ctx.fillStyle = "#ff8850";
      ctx.fillRect(26, 20, 3, 3); ctx.fillRect(12, 30, 3, 2);
      this.textures.addCanvas("taurus-boss-rock", c);
    }
    const rock = this.add.image(bx * ts + ts / 2, by * ts + ts / 2 - 4, "taurus-boss-rock").setDepth(8);
    this.tweens.add({
      targets: rock, alpha: { from: 1, to: 0.86 },
      duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
    });
    this.nectarExam.push({
      x: bx, y: by, fn: () => {
        this.showDialog([
          "岩の おくで なにかが 光っている……。",
          "ゴゴゴゴ……！！",
          "どうくつの ぬし ガンブロスが\nすがたを あらわした！",
        ], () => {
          // 1回きり: 勝っても 負けても にげても ぬしは いなくなる。
          this.setPitFlag("taurus_boss_done");
          this.startBattle("ganburos", 33);
        });
      },
    });
  }

  /** ミノリタウン初回到着のひとこと。 */
  private playMinoriArrival(): void {
    if (this.hasPitFlag("minori_arrival_seen")) return;
    this.setPitFlag("minori_arrival_seen");
    this.inCutscene = true;
    this.showDialog([
      "（あたたかい 風…。リルの谷を ぬけて\nついに 豊かの海へ 出たんだ）",
      "ここが ミノリタウン——\n地熱農園と ルナ16号の 町。",
    ], () => { this.inCutscene = false; });
  }

  // ---- ミノリジム（ジム3・炎）: 溶岩バルブのしかけ ----
  // チャンネル1(y17)はバルブ1、チャンネル2(y11)はバルブ2で冷える。
  // 西の「たからばし」(x3)は バルブが片方だけONのとき(XOR)だけ冷える。
  private static GYM3_SEGS: { cells: [number, number][]; cool: (v1: boolean, v2: boolean) => boolean }[] = [
    { cells: [[9, 17], [10, 17]], cool: (v1) => v1 },
    { cells: [[5, 11], [6, 11]], cool: (_v1, v2) => v2 },
    { cells: [[3, 13], [3, 14]], cool: (v1, v2) => v1 !== v2 },
  ];
  private gym3SegSprites: Map<string, Phaser.GameObjects.Image> = new Map();

  // ---- セレネジム（ジム4・光）: プリズムで「光の橋」を通すしかけ ----
  // ジム3と同じセグメント方式。prism1=南チャンネル / prism2=北チャンネル /
  // 西の宝への橋はXOR（片方だけON）。両方ONでリーダーへ到達。
  private static GYM4_SEGS: { cells: [number, number][]; lit: (p1: boolean, p2: boolean) => boolean }[] = [
    { cells: [[9, 17], [10, 17]], lit: (p1) => p1 },
    { cells: [[5, 11], [6, 11]], lit: (_p1, p2) => p2 },
    { cells: [[3, 13], [3, 14]], lit: (p1, p2) => p1 !== p2 },
  ];
  private gym4SegSprites: Map<string, Phaser.GameObjects.Image> = new Map();

  /** プリズム状態(pickups)を床/衝突に反映。氷ジム扉と同じく両方向に冪等。 */
  private applyGym4LightState(): void {
    const p1 = this.hasPitFlag("prism_1");
    const p2 = this.hasPitFlag("prism_2");
    for (const seg of MapScene.GYM4_SEGS) {
      const on = seg.lit(p1, p2);
      for (const [x, y] of seg.cells) {
        this.mapData.layers.floor[y][x] = on ? 121 : 122;
        this.mapData.layers.collision[y][x] = on ? 0 : 1;
        const spr = this.gym4SegSprites.get(`${x},${y}`);
        if (spr) spr.setTexture(on ? "tile-121" : "tile-122");
      }
    }
  }

  private placeGym4Events(): void {
    this.genNectarEventTextures();
    const ts = this.tileSize;
    this.gym4SegSprites.clear();

    for (const seg of MapScene.GYM4_SEGS) {
      for (const [x, y] of seg.cells) {
        const spr = this.add.image(x * ts + ts / 2, y * ts + ts / 2, "tile-122").setDepth(1);
        this.gym4SegSprites.set(`${x},${y}`, spr);
      }
    }
    this.applyGym4LightState();

    // プリズム装置（クリスタル＋台座）
    if (!this.textures.exists("gym4-prism")) {
      const c = document.createElement("canvas"); c.width = 30; c.height = 36;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(15, 33, 11, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#5a6478"; ctx.fillRect(11, 24, 8, 9);            // 台座
      ctx.fillStyle = "#8a94a8"; ctx.fillRect(11, 24, 8, 2);
      // 三角プリズム
      ctx.fillStyle = "#dff2ff";
      ctx.beginPath(); ctx.moveTo(15, 4); ctx.lineTo(24, 24); ctx.lineTo(6, 24); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.moveTo(15, 4); ctx.lineTo(18, 24); ctx.lineTo(12, 24); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#9ec7e0"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(15, 4); ctx.lineTo(24, 24); ctx.lineTo(6, 24); ctx.closePath(); ctx.stroke();
      this.textures.addCanvas("gym4-prism", c);
    }
    const prism = (x: number, y: number, flag: string, label: string) => {
      const img = this.add.image(x * ts + ts / 2, y * ts + ts / 2 - 4, "gym4-prism").setDepth(8);
      const glow = this.add.circle(x * ts + ts / 2, y * ts + ts / 2 - 10, 12, 0xbfe8ff, 0.25).setDepth(8);
      this.tweens.add({ targets: glow, alpha: { from: 0.3, to: 0.1 }, scale: { from: 1, to: 1.4 },
        duration: 1200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      void img;
      this.nectarExam.push({
        x, y, fn: () => {
          if (this.hasPitFlag(flag)) this.clearPitFlag(flag);
          else this.setPitFlag(flag);
          this.applyGym4LightState();
          this.cameras.main.flash(160, 220, 240, 255);
          const on = this.hasPitFlag(flag);
          this.showDialog([
            `${label}を まわした！\n光の むきが かわり、どこかの 橋が\n${on ? "ひかった" : "きえた"}！（${on ? "ON" : "OFF"}）`,
          ]);
        },
      });
    };
    prism(4, 20, "prism_1", "プリズム1");
    prism(15, 14, "prism_2", "プリズム2");

    // 看板（しかけの説明）
    this.nectarExam.push({ x: 11, y: 22, fn: () => this.showDialog([
      "『プリズムを まわして 光の 橋を\nつくり、おくの リーダーを めざせ。』",
      "白い光は プリズムで まがる。\n2つの プリズムを うまく あわせよう。",
    ]) });

    // 星のきらめき（床の演出）
    for (let i = 0; i < 14; i++) {
      const gx = (2 + Math.random() * 16) * ts, gy = (2 + Math.random() * 22) * ts;
      const st = this.add.circle(gx, gy, 1.5, 0xdfeaff, 0.9).setDepth(2);
      this.tweens.add({ targets: st, alpha: { from: 0.9, to: 0.15 }, duration: 800 + Math.random() * 1200,
        yoyo: true, repeat: -1, delay: Math.random() * 1500, ease: "Sine.easeInOut" });
    }
    // ひんやり青い光のトーン
    this.add.rectangle(0, 0, this.mapData.width * ts, this.mapData.height * ts, 0x6088ff, 0.05)
      .setOrigin(0).setDepth(26);
  }

  /**
   * バルブ状態(pickupsフラグ)を床タイル/衝突に反映する。mapDataはセッション
   * キャッシュ共有なので、氷ジム扉と同じく両方向に冪等であること。
   */
  private applyGym3LavaState(): void {
    const v1 = this.hasPitFlag("gym3_valve_1");
    const v2 = this.hasPitFlag("gym3_valve_2");
    for (const seg of MapScene.GYM3_SEGS) {
      const cool = seg.cool(v1, v2);
      for (const [x, y] of seg.cells) {
        this.mapData.layers.floor[y][x] = cool ? 101 : 100;
        this.mapData.layers.collision[y][x] = cool ? 0 : 1;
        const spr = this.gym3SegSprites.get(`${x},${y}`);
        if (spr) spr.setTexture(cool ? "tile-101" : "tile-100");
      }
    }
  }

  private placeGym3Events(): void {
    this.genNectarEventTextures();
    const ts = this.tileSize;
    this.gym3SegSprites.clear();

    // 切り替えセルのオーバーレイ（drawMapの上に載せ、状態でテクスチャを差し替える）
    for (const seg of MapScene.GYM3_SEGS) {
      for (const [x, y] of seg.cells) {
        const spr = this.add.image(x * ts + ts / 2, y * ts + ts / 2, "tile-100").setDepth(1);
        this.gym3SegSprites.set(`${x},${y}`, spr);
      }
    }
    this.applyGym3LavaState();

    // バルブのテクスチャ（パイプ＋赤いハンドル）
    if (!this.textures.exists("gym3-valve")) {
      const c = document.createElement("canvas"); c.width = 30; c.height = 34;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(15, 30, 11, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#707888"; ctx.fillRect(12, 14, 6, 18);          // pipe
      ctx.fillStyle = "#8a92a4"; ctx.fillRect(12, 14, 2, 18);
      ctx.strokeStyle = "#c83a30"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(15, 10, 7, 0, Math.PI * 2); ctx.stroke(); // wheel
      ctx.strokeStyle = "#e85a4a"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(15, 3); ctx.lineTo(15, 17); ctx.moveTo(8, 10); ctx.lineTo(22, 10); ctx.stroke();
      this.textures.addCanvas("gym3-valve", c);
    }
    const valve = (x: number, y: number, flag: string, label: string) => {
      this.add.image(x * ts + ts / 2, y * ts + ts / 2 - 4, "gym3-valve").setDepth(8);
      this.nectarExam.push({
        x, y, fn: () => {
          if (this.hasPitFlag(flag)) this.clearPitFlag(flag);
          else this.setPitFlag(flag);
          this.cameras.main.shake(200, 0.003);
          this.applyGym3LavaState();
          const on = this.hasPitFlag(flag);
          this.showDialog([
            `${label}を まわした！ ……ゴゴゴ。\nどこかで マグマの ながれる 音が\nかわった！（${on ? "ON" : "OFF"}）`,
          ]);
        },
      });
    };
    valve(4, 20, "gym3_valve_1", "バルブ1");
    valve(15, 14, "gym3_valve_2", "バルブ2");

    // ---- メラメラ演出: かがり火・火の粉・熱気 ----
    // かがり火（石の火鉢＋ゆらめく炎）
    if (!this.textures.exists("gym3-brazier")) {
      const c = document.createElement("canvas"); c.width = 26; c.height = 22;
      const ctx2 = c.getContext("2d")!; ctx2.imageSmoothingEnabled = false;
      ctx2.fillStyle = "rgba(0,0,0,0.35)";
      ctx2.beginPath(); ctx2.ellipse(13, 19, 10, 3, 0, 0, Math.PI * 2); ctx2.fill();
      ctx2.fillStyle = "#3a3136"; ctx2.fillRect(5, 10, 16, 8);
      ctx2.fillStyle = "#554a50"; ctx2.fillRect(5, 10, 16, 3);
      ctx2.fillStyle = "#2a2226"; ctx2.fillRect(3, 16, 20, 3);
      this.textures.addCanvas("gym3-brazier", c);
    }
    if (!this.textures.exists("gym3-flame")) {
      const c = document.createElement("canvas"); c.width = 18; c.height = 24;
      const ctx2 = c.getContext("2d")!; ctx2.imageSmoothingEnabled = false;
      const flame = (cx: number, base: number, w: number, h: number, col: string) => {
        ctx2.fillStyle = col;
        ctx2.beginPath();
        ctx2.moveTo(cx - w / 2, base);
        ctx2.quadraticCurveTo(cx - w / 2, base - h * 0.55, cx, base - h);
        ctx2.quadraticCurveTo(cx + w / 2, base - h * 0.55, cx + w / 2, base);
        ctx2.closePath(); ctx2.fill();
      };
      flame(9, 23, 15, 22, "#e0501e");
      flame(9, 23, 10, 16, "#f59a2a");
      flame(9, 23, 5, 10, "#ffe08a");
      this.textures.addCanvas("gym3-flame", c);
    }
    const braziers: [number, number][] = [[7, 23.4], [12, 23.4], [7, 4.3], [12, 4.3], [1.6, 8.6], [17.4, 8.6], [1.6, 19.6], [17.4, 19.6]];
    for (const [bx, by] of braziers) {
      this.add.image(bx * ts + ts / 2, by * ts, "gym3-brazier").setDepth(8).setScale(1.25);
      const fl = this.add.image(bx * ts + ts / 2, by * ts - 12, "gym3-flame").setOrigin(0.5, 1).setDepth(8).setScale(1.15);
      this.tweens.add({ targets: fl, scaleY: 1.35, scaleX: 1.02, duration: 260 + Math.random() * 160,
        yoyo: true, repeat: -1, ease: "Sine.inOut" });
      const glow = this.add.circle(bx * ts + ts / 2, by * ts - 12, 15, 0xffa040, 0.22).setDepth(8);
      this.tweens.add({ targets: glow, alpha: 0.08, scale: 1.4, duration: 480 + Math.random() * 260,
        yoyo: true, repeat: -1, ease: "Sine.inOut" });
    }

    // マグマ川の上を立ちのぼる火の粉
    if (!this.textures.exists("ember-spark")) {
      const c = document.createElement("canvas"); c.width = 6; c.height = 6;
      const ctx2 = c.getContext("2d")!;
      ctx2.fillStyle = "rgba(255,150,60,0.95)"; ctx2.fillRect(2, 2, 2, 2);
      ctx2.fillStyle = "rgba(255,110,40,0.45)";
      ctx2.fillRect(1, 2, 1, 2); ctx2.fillRect(4, 2, 1, 2); ctx2.fillRect(2, 1, 2, 1); ctx2.fillRect(2, 4, 2, 1);
      this.textures.addCanvas("ember-spark", c);
    }
    const emberRows = [17, 11];
    for (let i = 0; i < 16; i++) {
      const row = emberRows[i % emberRows.length];
      const sx = () => (1.5 + Math.random() * 16) * ts;
      const sy2 = () => (row + 0.2 + Math.random() * 0.6) * ts;
      const spark = this.add.image(sx(), sy2(), "ember-spark")
        .setDepth(27).setAlpha(0).setScale(0.8 + Math.random() * 0.9);
      this.tweens.add({
        targets: spark, y: `-=${34 + Math.random() * 60}`, alpha: { from: 0.9, to: 0 },
        duration: 1700 + Math.random() * 1600, repeat: -1, ease: "Sine.out", delay: Math.random() * 1800,
        onRepeat: () => { spark.x = sx(); spark.y = sy2(); },
      });
    }
    // マグマ川と溶岩だまりの上の熱気の明滅
    for (const [gx, gy] of [[4, 17], [9.5, 17], [15, 17], [4, 11], [10, 11], [16, 11],
                            [4, 2.5], [15, 2.5], [1.5, 1], [17.5, 1]] as [number, number][]) {
      const glow = this.add.circle(gx * ts + ts / 2, gy * ts + ts / 2, ts * 0.85, 0xff6a20, 0.10).setDepth(26);
      this.tweens.add({ targets: glow, alpha: 0.03, scale: 1.3, duration: 900 + Math.random() * 700,
        yoyo: true, repeat: -1, ease: "Sine.inOut", delay: Math.random() * 600 });
    }
    // 全体の熱気トーン
    this.add.rectangle(0, 0, this.mapData.width * ts, this.mapData.height * ts, 0xff7030, 0.06)
      .setOrigin(0).setDepth(26);

    // 入口の説明看板
    this.nectarExam.push({
      x: 11, y: 22, fn: () => this.showDialog([
        "『ミノリジム 心得』",
        "一、リーダー戦は 2たい2の\nダブルバトル なり。アルモンを\n2体 そろえて いどむべし。",
        "一、バルブで マグマの ながれを\nきりかえるべし。",
        "一、バルブが かたほうだけ ONのとき、\n西の たからばしが ひえる との うわさ。",
      ]),
    });
    this.add.image(11 * ts + ts / 2, 22 * ts + ts / 2 - 4, "nectar-sign").setDepth(8);

    // シオリ（イシイの相方・リーダーコンビ）
    this.add.image(10 * ts + ts / 2, 2 * ts + ts / 2, this.npcTex("cast-shiori-down", "npc-mom")).setDepth(9);
    this.nectarExam.push({
      x: 10, y: 2, fn: () => this.showDialog([
        "シオリ「しょうぶなら となりの\nイシイに 声を かけてね！\n2人 いっしょに おあいて するわ！」",
      ]),
    });
  }

  /** Step-on triggers: ①②展望+地球の出 / ⑬ヴォイスの影 */
  private checkNectarStepTriggers(): void {
    if (this.currentMapKey !== "nectar_town" || this.inCutscene || this.dialogActive ||
        this.isWarping || this.startingBattle) return;
    const pk = this.playerState?.pickups || [];
    if (this.gridY === 6 && (this.gridX === 24 || this.gridX === 25) &&
        !pk.includes("nectar_altai_seen")) {
      this.playAltaiCutscene();
    } else if (this.gridY === 15 && (this.gridX === 26 || this.gridX === 27) &&
        !pk.includes("nectar_voice_seen")) {
      this.playVoiceCutscene();
    }
  }

  /** ①アルタイの崖 展望 → ②地球の出 (連結カットシーン・1回きり)。 */
  private playAltaiCutscene(): void {
    if (!this.playerState) return;
    this.playerState.pickups = this.playerState.pickups || [];
    this.playerState.pickups.push("nectar_altai_seen");
    this.inCutscene = true;
    const ts = this.tileSize;
    const cam = this.cameras.main;
    this.showDialog([
      "研究者「よく来たね。ここが 神酒の海を\n見わたす いちばんの 場所さ。」",
      "研究者「目の前の 大きな がけ——\nアルタイの崖は、大むかし 巨大な\n衝突で 盆地が できた ときの ふち なんだ。」",
      "研究者「その 衝突が 月の 『神酒代』の\nはじまり。ここは 月の 歴史の\nページの 1つ なんだよ。」",
    ], () => {
      // pan to the cliff / NE sky and let the Earth rise
      cam.stopFollow();
      cam.pan(26 * ts, 3 * ts, 900, "Sine.easeInOut");
      this.time.delayedCall(1000, () => {
        const earth = this.add.image(27.5 * ts, 3.4 * ts, "earth-sprite")
          .setDepth(8).setAlpha(0).setScale(1.2);
        this.tweens.add({ targets: earth, y: 1.6 * ts, alpha: 1, duration: 1900, ease: "Sine.out" });
        this.time.delayedCall(2100, () => {
          this.showDialog([
            "研究者「……ちょうど いい時間だ。\n東の 空を ごらん。」",
            "あおく かがやく 地球が\nのぼってきた…！",
            "研究者「月は いつも 同じ顔を 地球に\n向けている。だから ここからは、地球は\nいつも あの あたりに 見えるんだ。」",
            "研究者「記念に これを。」",
            "「スターカプセル」を てにいれた！",
          ], () => {
            if (this.playerState) {
              const it = this.playerState.items.find(i => i.id === "star_capsule");
              if (it) it.count++;
              else this.playerState.items.push({ id: "star_capsule", count: 1 });
            }
            cam.pan(this.player.x, this.player.y, 700, "Sine.easeInOut");
            this.time.delayedCall(750, () => {
              cam.startFollow(this.player, true, 0.15, 0.15);
              this.inCutscene = false;
            });
          });
        });
      });
    });
  }

  /** ⑬ヴォイスの影: 立ち聞きカットシーン (戦闘なし・1回きり)。 */
  private playVoiceCutscene(): void {
    if (!this.playerState) return;
    this.playerState.pickups = this.playerState.pickups || [];
    this.playerState.pickups.push("nectar_voice_seen");
    this.inCutscene = true;
    const ts = this.tileSize;
    const s1 = this.add.image(26 * ts + ts / 2, 14 * ts + ts / 2, "voice-shadow").setDepth(9);
    const s2 = this.add.image(27 * ts + ts / 2, 14 * ts + ts / 2 - 4, "voice-shadow").setDepth(9).setFlipX(true);
    const emote = this.showEmote("!");
    this.time.delayedCall(700, () => {
      emote.forEach(o => o.destroy());
      this.showDialog([
        "黒ずくめA「……南極の 永久影。氷、\nつまり 水さえ 押さえれば、月は\nわれらの ものだ。」",
        "黒ずくめB「おい、だれか 来たぞ。\n……行くぞ。」",
      ], () => {
        this.tweens.add({ targets: [s1, s2], y: "-=96", alpha: 0, duration: 900, ease: "Sine.in",
          onComplete: () => { s1.destroy(); s2.destroy(); } });
        this.time.delayedCall(1000, () => {
          this.showDialog(["（いまの…なんだ？）"], () => { this.inCutscene = false; });
        });
      });
    });
  }

  /** ⑮ 月クイズの子ども: ○×クイズ (正解1回目に つきのすな)。 */
  private static QUIZZES: { q: string; correct: "A" | "B"; explain: string[] }[] = [
    {
      q: "だい1もん！\n月の 『海』には 水が ある？",
      correct: "B",
      explain: ["せいかいは 『ない』！", "月の 海は 大むかしの 溶岩が\n固まった 平らな 大地なんだ。"],
    },
    {
      q: "だい2もん！\n月で 日かげが すごーく 寒いのは\n空気が ないから？",
      correct: "A",
      explain: ["せいかい！ 空気が ないと 熱を\nはこべない から、日なたと 日かげで\n100ど以上も 差が つくんだ。"],
    },
    {
      q: "だい3もん！\n神酒の海は 月で いちばん\n新しい 海である？",
      correct: "B",
      explain: ["せいかいは 『ちがう』！", "神酒の海は とびきり 古い 海。\n時代区分 『神酒代』の 名前の\nもとに なったんだよ。"],
    },
  ];

  private triggerQuizKid(): void {
    const quiz = MapScene.QUIZZES[this.quizIdx % MapScene.QUIZZES.length];
    this.quizIdx++;
    this.showDialog([
      "月クイズの 時間だよ〜！",
      quiz.q,
      "Aボタン＝はい ／ Bボタン＝いいえ",
    ], () => {
      this.quizAwaiting = { correct: quiz.correct, explain: quiz.explain };
    });
  }

  private resolveQuiz(answer: "A" | "B"): void {
    const quiz = this.quizAwaiting;
    this.quizAwaiting = null;
    if (!quiz) return;
    if (answer === quiz.correct) {
      const pk = this.playerState?.pickups || [];
      if (this.playerState && !pk.includes("nectar_quiz_reward")) {
        this.playerState.pickups = pk;
        pk.push("nectar_quiz_reward");
        const it = this.playerState.items.find(i => i.id === "moon_sand");
        if (it) it.count++;
        else this.playerState.items.push({ id: "moon_sand", count: 1 });
        this.showDialog([...quiz.explain, "ごほうびに 『つきのすな』を\nあげちゃう！"]);
      } else {
        this.showDialog([...quiz.explain, "また ちょうせん してね！"]);
      }
    } else {
      this.showDialog(["ぶっぶー！ ざんねん！", ...quiz.explain, "また ちょうせん してね！"]);
    }
  }

  private startSnowfall(): void {
    if (!this.textures.exists("snowflake")) {
      const c = document.createElement("canvas"); c.width = 6; c.height = 6;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "rgba(255,255,255,0.95)"; ctx.fillRect(2, 2, 2, 2);
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.fillRect(1, 2, 1, 2); ctx.fillRect(4, 2, 1, 2); ctx.fillRect(2, 1, 2, 1); ctx.fillRect(2, 4, 2, 1);
      this.textures.addCanvas("snowflake", c);
    }
    const mapW = this.mapData.width * this.tileSize;
    const mapH = this.mapData.height * this.tileSize;
    for (let i = 0; i < 70; i++) {
      const flake = this.add.image(Math.random() * mapW, Math.random() * mapH, "snowflake")
        .setDepth(27)
        .setAlpha(0.35 + Math.random() * 0.5)
        .setScale(0.7 + Math.random() * 0.9);
      this.tweens.add({
        targets: flake, y: `+=${140 + Math.random() * 160}`,
        duration: 3800 + Math.random() * 3600, repeat: -1, ease: "Linear",
        onRepeat: () => { flake.x = Math.random() * mapW; flake.y = Math.random() * mapH * 0.9; },
      });
      this.tweens.add({
        targets: flake, x: `+=${(Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 14)}`,
        duration: 1200 + Math.random() * 1400, yoyo: true, repeat: -1, ease: "Sine.inOut",
      });
    }
  }

  private createDefaultPlayerState(): PlayerState {
    const allMonsters = this.cache.json.get("monsters") as MonsterData[];
    const usamon = allMonsters.find(m => m.id === "usamon")!;
    const allMoves = (this.cache.json.get("moves") || []) as MoveData[];
    const ng = rollNatureGender();
    const stats = applyNature(calculateStats(usamon, 5), ng.nature);
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
      pp: moves.map(id => moveMaxPP(id, allMoves)),
      ...ng,
    };
    return {
      party: [instance],
      box: [],
      items: [{ id: "moon_capsule", count: 5 }],
      money: 1000,
      defeatedTrainers: [],
      playSeconds: 0,
      seen: ["usamon"],
      caught: ["usamon"],
    };
  }
}
