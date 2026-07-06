import * as Phaser from "phaser";
import { BattleMonster, BattleMove } from "../battle/types";
import { calculateDamage } from "../battle/damage";
import { TypeChart } from "../types";
import {
  MonsterData,
  MoveData,
  MonsterInstance,
  PlayerState,
  TrainerData,
} from "../data/types";
import { attemptCapture } from "../data/encounterSystem";
import {
  getExpReward,
  getExpForLevel,
  getNewMoveAtLevel,
  applyLevelUp,
  checkEvolution,
  applyEvolution,
  calculateStats,
} from "../data/levelSystem";

type BattlePhase =
  | "intro"
  | "command"
  | "move_select"
  | "executing"
  | "victory"
  | "defeat"
  | "exp_gain"
  | "learn_move"
  | "evolution";

interface CommandSlot {
  label: string;
  x: number;
  y: number;
  bg: Phaser.GameObjects.Graphics;
  text: Phaser.GameObjects.Text;
  zone: Phaser.GameObjects.Zone;
}

export class BattleScene extends Phaser.Scene {
  // Data
  private allMonsters: MonsterData[] = [];
  private allMoves: MoveData[] = [];
  private typeChart!: TypeChart;

  // Player monster instance (persisted across battles)
  private playerInstance!: MonsterInstance;
  private enemyInstance!: MonsterInstance;

  // Battle-runtime wrappers
  private playerMon!: BattleMonster;
  private enemyMon!: BattleMonster;

  // Graphics
  private playerSprite!: Phaser.GameObjects.Image;
  private enemySprite!: Phaser.GameObjects.Image;
  private playerHpBar!: Phaser.GameObjects.Graphics;
  private enemyHpBar!: Phaser.GameObjects.Graphics;
  private playerExpBar!: Phaser.GameObjects.Graphics;
  private playerHpText!: Phaser.GameObjects.Text;
  private enemyHpText!: Phaser.GameObjects.Text;
  private playerNameText!: Phaser.GameObjects.Text;
  private enemyNameText!: Phaser.GameObjects.Text;
  private playerLvText!: Phaser.GameObjects.Text;
  private enemyLvText!: Phaser.GameObjects.Text;

  // UI
  private msgText!: Phaser.GameObjects.Text;
  private msgBg!: Phaser.GameObjects.Graphics;
  private commandSlots: CommandSlot[] = [];
  private moveSlots: CommandSlot[] = [];
  private selectedCommand = 0;
  private selectedMove = 0;

  // State
  private phase: BattlePhase = "intro";
  private messageQueue: { text: string; callback?: () => void }[] = [];
  private isShowingMessage = false;
  private waitingForInput = false;

  // Keys
  private cursorKeys!: Phaser.Types.Input.Keyboard.CursorKeys;
  private enterKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private bKey!: Phaser.Input.Keyboard.Key;
  private escKey!: Phaser.Input.Keyboard.Key;

  // Gamepad tracking for edge detection
  private gpPrevDpad: string | null = null;

  // Vertical scale factor (base 480)
  private sy = 1;

  // Return data
  private returnMapKey = "moonbase";
  private returnPlayerX = 0;
  private returnPlayerY = 0;

  // Evolution
  private evolutionCancelled = false;
  private pendingEvolution: { evolvesTo: string; newData: MonsterData } | null = null;

  // Move learning
  private pendingMoveId: string | null = null;

  // Player state (party, items, money)
  private playerState!: PlayerState;

  // Battle mode
  private isWild = true;
  private trainerData: TrainerData | null = null;
  private trainerPartyIndex = 0;
  private fleeAttempts = 0;

  constructor() {
    super({ key: "BattleScene" });
  }

  init(data: {
    mapKey?: string;
    playerX?: number;
    playerY?: number;
    playerState?: PlayerState;
    playerInstance?: MonsterInstance; // legacy compat
    enemyDataId?: string;
    enemyLevel?: number;
    isWild?: boolean;
    trainerData?: TrainerData;
  }): void {
    this.returnMapKey = data.mapKey || "moonbase";
    this.returnPlayerX = data.playerX || 0;
    this.returnPlayerY = data.playerY || 0;
    this.phase = "intro";
    this.messageQueue = [];
    this.isShowingMessage = false;
    this.waitingForInput = false;
    this.selectedCommand = 0;
    this.selectedMove = 0;
    this.commandSlots = [];
    this.moveSlots = [];
    this.evolutionCancelled = false;
    this.pendingEvolution = null;
    this.pendingMoveId = null;
    this.isWild = data.isWild !== false;
    this.trainerData = data.trainerData || null;
    this.trainerPartyIndex = 0;

    // Load JSON data
    this.allMonsters = this.cache.json.get("monsters") as MonsterData[];
    this.allMoves = this.cache.json.get("moves") as MoveData[];
    this.typeChart = this.cache.json.get("types") as TypeChart;

    // Player state
    if (data.playerState) {
      this.playerState = data.playerState;
    } else {
      // Default state
      const defaultInstance = data.playerInstance || this.createDefaultPlayer();
      this.playerState = {
        party: [defaultInstance],
        box: [],
        items: [{ id: "moon_capsule", count: 5 }],
        money: 1000,
        defeatedTrainers: [],
      };
    }

    // Player instance is first alive party member
    this.playerInstance = this.playerState.party.find(m => m.currentHp > 0) || this.playerState.party[0];

    // Enemy instance
    if (this.trainerData) {
      const firstEnemy = this.trainerData.party[0];
      this.enemyInstance = this.createInstance(firstEnemy.id, firstEnemy.level);
    } else {
      const enemyDataId = data.enemyDataId || this.randomWildMonster();
      const enemyLevel = data.enemyLevel || Phaser.Math.Between(3, 6);
      this.enemyInstance = this.createInstance(enemyDataId, enemyLevel);
    }
  }

  private createDefaultPlayer(): MonsterInstance {
    const data = this.allMonsters.find((m) => m.id === "usamon")!;
    const stats = calculateStats(data, 5);
    // Give moves for Lv5
    const moves = data.learnset
      .filter((e) => e.level <= 5)
      .map((e) => e.moveId)
      .slice(-4);
    return {
      dataId: "usamon",
      level: 5,
      exp: getExpForLevel(5),
      currentHp: stats.hp,
      maxHp: stats.hp,
      stats,
      moves,
    };
  }

  private createInstance(dataId: string, level: number): MonsterInstance {
    const data = this.allMonsters.find((m) => m.id === dataId)!;
    const stats = calculateStats(data, level);
    const moves = data.learnset
      .filter((e) => e.level <= level)
      .map((e) => e.moveId)
      .slice(-4);
    return {
      dataId,
      level,
      exp: getExpForLevel(level),
      currentHp: stats.hp,
      maxHp: stats.hp,
      stats,
      moves,
    };
  }

  private randomWildMonster(): string {
    const wild = ["mochichi", "sunagani", "rairai", "regonyas"];
    return wild[Math.floor(Math.random() * wild.length)];
  }

  private instanceToBattleMonster(inst: MonsterInstance): BattleMonster {
    const data = this.allMonsters.find((m) => m.id === inst.dataId)!;
    const battleMoves: BattleMove[] = inst.moves.map((moveId) => {
      const md = this.allMoves.find((m) => m.id === moveId)!;
      return {
        name: md.name,
        type: md.type,
        power: md.power,
        isSupport: md.isSupport,
        priority: md.priority,
        effect: md.effect
          ? {
              stat: (md.effect.stat as "attack" | "defense" | "speed") || "attack",
              multiplier: md.effect.multiplier || 1,
              target: (md.effect.target as "self" | "enemy") || "self",
              type: md.effect.type,
              healPercent: md.effect.healPercent,
              min: md.effect.min,
              max: md.effect.max,
            }
          : undefined,
      };
    });
    return {
      name: data.name,
      type: data.type,
      level: inst.level,
      maxHp: inst.maxHp,
      currentHp: inst.currentHp,
      attack: inst.stats.attack,
      defense: inst.stats.defense,
      speed: inst.stats.speed,
      moves: battleMoves,
      attackMod: 1.0,
      defenseMod: 1.0,
      speedMod: 1.0,
    };
  }

  create(): void {
    this.sy = this.scale.height / 480;

    // Clear stale gamepad state
    const gp = typeof window !== "undefined" ? (window as any).__gamepad : null;
    if (gp) { gp.aJust = false; gp.bJust = false; gp.menuJust = false; }

    this.playerMon = this.instanceToBattleMonster(this.playerInstance);
    this.enemyMon = this.instanceToBattleMonster(this.enemyInstance);

    this.drawBackground();
    this.drawMonsters();
    this.drawHpBars();
    this.drawMessageWindow();
    this.drawCommandWindow();
    this.setupInput();

    this.cameras.main.flash(500, 255, 255, 255);

    this.time.delayedCall(600, () => {
      const enemyData = this.allMonsters.find((m) => m.id === this.enemyInstance.dataId)!;
      const introMsgs: string[] = [];
      if (this.trainerData) {
        introMsgs.push(`${this.trainerData.name}が しょうぶを しかけてきた！`);
        introMsgs.push(this.trainerData.dialogBefore);
        introMsgs.push(`${this.trainerData.name}は ${enemyData.name}を くりだした！`);
      } else {
        introMsgs.push(`やせいの ${enemyData.name} が あらわれた！`);
      }
      introMsgs.push(`ゆけっ！ ${this.playerMon.name}！`);
      this.showMessages(introMsgs, () => {
        this.phase = "command";
        this.showCommandWindow();
      });
    });
  }

  // ---- Drawing ----

  private drawBackground(): void {
    const g = this.add.graphics();
    const s = this.sy;
    const H = this.scale.height;
    const skyH = Math.floor(160 * s);
    // Sky: dark navy gradient
    for (let y = 0; y < skyH; y++) {
      const t = y / skyH;
      const r = Math.floor(20 + t * 30);
      const gv = Math.floor(25 + t * 40);
      const b = Math.floor(60 + t * 50);
      g.fillStyle(Phaser.Display.Color.GetColor(r, gv, b));
      g.fillRect(0, y, 640, 1);
    }
    // Bright stars
    const rng = new Phaser.Math.RandomDataGenerator(["battlestars"]);
    for (let i = 0; i < 50; i++) {
      const sx2 = rng.between(0, 640);
      const sy2 = rng.between(0, skyH - 10);
      const brightness = rng.between(200, 255);
      g.fillStyle(Phaser.Display.Color.GetColor(brightness, brightness, brightness));
      g.fillRect(sx2, sy2, rng.between(1, 2), rng.between(1, 2));
    }
    // Ground: cream-light gray (fills rest)
    for (let y = skyH; y < H; y++) {
      const t = Math.min(1, (y - skyH) / (80 * s));
      const r = Math.floor(200 + t * 20);
      const gv = Math.floor(195 + t * 15);
      const b = Math.floor(180 + t * 10);
      g.fillStyle(Phaser.Display.Color.GetColor(r, gv, b));
      g.fillRect(0, y, 640, 1);
    }

    // Elliptical SANDY platforms (RSE desert-style): enemy upper-right, player lower-left.
    const plat = this.add.graphics().setDepth(1);
    const prng = new Phaser.Math.RandomDataGenerator(["sandplatform"]);
    const drawPlat = (cx: number, cyDesign: number, rx: number, ry: number) => {
      const cy = Math.round(cyDesign * s);
      // soft drop shadow
      plat.fillStyle(0x1a1c22, 0.25);
      plat.fillEllipse(cx, cy + 5, rx + 6, ry + 4);
      // sand base
      plat.fillStyle(0xbcab6c, 1);
      plat.fillEllipse(cx, cy, rx, ry);
      // darker lower band
      plat.fillStyle(0x9f8b4c, 1);
      plat.fillEllipse(cx, cy + ry * 0.38, rx * 0.94, ry * 0.6);
      // lit top
      plat.fillStyle(0xd9c98a, 0.95);
      plat.fillEllipse(cx, cy - ry * 0.32, rx * 0.8, ry * 0.5);
      // speckles (sand grain / small rocks)
      plat.fillStyle(0x7c6836, 0.85);
      for (let i = 0; i < 26; i++) {
        const ang = prng.frac() * Math.PI * 2;
        const rr = Math.sqrt(prng.frac());
        const px = cx + Math.cos(ang) * rx * 0.86 * rr;
        const py = cy + Math.sin(ang) * ry * 0.86 * rr;
        const sz = prng.between(1, 3);
        plat.fillRect(px, py, sz, sz);
      }
      // rim highlight
      plat.lineStyle(2, 0xe6d9a2, 0.55);
      plat.strokeEllipse(cx, cy, rx, ry);
    };
    drawPlat(this.EPLAT_X, this.EPLAT_Y, 152, 38);
    drawPlat(this.PPLAT_X, this.PPLAT_Y, 176, 46);
  }

  // ---- RSE battle layout anchors (640-wide design, Y ×sy) ----
  private EPLAT_X = 466; private EPLAT_Y = 150;   // enemy platform (upper-right)
  private PPLAT_X = 165; private PPLAT_Y = 228;   // player platform (lower-left)

  private drawMonsters(): void {
    const playerData = this.allMonsters.find((m) => m.id === this.playerInstance.dataId)!;
    const enemyData = this.allMonsters.find((m) => m.id === this.enemyInstance.dataId)!;
    // Bottom-center origin so each monster stands on its platform.
    this.playerSprite = this.add
      .image(this.PPLAT_X, Math.round((this.PPLAT_Y + 8) * this.sy), this.playerTexKey(playerData.id))
      .setOrigin(0.5, 1).setDepth(5);
    this.enemySprite = this.add
      .image(this.EPLAT_X, Math.round((this.EPLAT_Y + 6) * this.sy), `monster-${enemyData.id}`)
      .setOrigin(0.5, 1).setDepth(5);
    // Full-body sprites are tight-cropped pixel art of varying aspect — fit each
    // inside a box so wide monsters (e.g. crabs) aren't oversized (crisp: pixelArt).
    this.sizeMonsterSprite(this.playerSprite, 128, 132);
    this.sizeMonsterSprite(this.enemySprite, 110, 116);
  }

  // The player's own monster shows its back sprite (RSE-style) when available,
  // otherwise falls back to the front sprite.
  private playerTexKey(id: string): string {
    const back = `monster-${id}-back`;
    return this.textures.exists(back) ? back : `monster-${id}`;
  }

  // Scale a monster sprite to fit within a target box (design units, ×sy),
  // preserving aspect so both wide and tall monsters read at a similar size.
  private sizeMonsterSprite(sprite: Phaser.GameObjects.Image, maxW: number, maxH: number): void {
    const w = sprite.width || 64;
    const h = sprite.height || 64;
    const scale = Math.min((maxW * this.sy) / w, (maxH * this.sy) / h);
    sprite.setScale(scale);
  }

  // ---- HUD geometry (RSE status boxes) ----
  // Enemy box: upper-left. Player box: lower-right (above the message window).
  private enemyBoxRect() { const s = this.sy; return { x: 18, y: Math.round(26 * s), w: 300, h: Math.round(52 * s) }; }
  private playerBoxRect() { const s = this.sy; return { x: 320, y: Math.round(150 * s), w: 306, h: Math.round(84 * s) }; }
  private hpGeom(isPlayer: boolean) {
    const s = this.sy;
    return isPlayer
      ? { x: 400, y: Math.round(196 * s), w: 210, h: Math.max(7, Math.round(9 * s)) }
      : { x: 100, y: Math.round(60 * s), w: 208, h: Math.max(7, Math.round(9 * s)) };
  }
  private expGeom() { const s = this.sy; return { x: 340, y: Math.round(220 * s), w: 270, h: Math.max(4, Math.round(6 * s)) }; }

  // RSE-style light status panel with a small pointed tab.
  private drawStatusPanel(r: { x: number; y: number; w: number; h: number }): void {
    const g = this.add.graphics().setDepth(9);
    g.fillStyle(0x101018, 0.30);
    g.fillRoundedRect(r.x + 3, r.y + 4, r.w, r.h, 11);      // drop shadow
    g.fillStyle(0xf3efe0, 0.98);
    g.fillRoundedRect(r.x, r.y, r.w, r.h, 11);              // light panel
    g.lineStyle(3, 0x46688f, 1);
    g.strokeRoundedRect(r.x, r.y, r.w, r.h, 11);            // blue frame
    g.lineStyle(1, 0xd6d0bc, 1);
    g.strokeRoundedRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 8); // inner line
  }

  // Small "HP"/"EXP" label tag drawn on the light panel.
  private drawTag(x: number, y: number, label: string, color: string): Phaser.GameObjects.Text {
    return this.add.text(x, y, label, {
      fontSize: "11px", color, fontFamily: "'DotGothic16', monospace", fontStyle: "bold",
    }).setOrigin(0, 0.5).setDepth(11);
  }

  private drawHpBars(): void {
    const F = "'DotGothic16', monospace";
    const NAME = "#2b3346", LV = "#3a4256", HPTAG = "#c24a30", EXPTAG = "#2f6ab0";
    // ===== Enemy status panel (upper-left) =====
    const eb = this.enemyBoxRect();
    this.drawStatusPanel(eb);
    this.enemyNameText = this.add
      .text(eb.x + 16, eb.y + Math.round(7 * this.sy), `${this.enemyMon.name}`, {
        fontSize: "15px", color: NAME, fontFamily: F, fontStyle: "bold",
      }).setDepth(11);
    this.enemyLvText = this.add.text(eb.x + eb.w - 14, eb.y + Math.round(8 * this.sy), `Lv${this.enemyMon.level}`, {
      fontSize: "13px", color: LV, fontFamily: F, fontStyle: "bold",
    }).setOrigin(1, 0).setDepth(11);
    const eg = this.hpGeom(false);
    this.drawTag(eb.x + 16, eg.y, "HP", HPTAG);
    this.enemyHpBar = this.add.graphics().setDepth(11);
    this.drawHpBarGraphic(this.enemyHpBar, eg.x, eg.y - eg.h / 2, eg.w, eg.h, this.enemyMon.currentHp / this.enemyMon.maxHp);
    // enemy HP numbers are hidden (RSE-style); keep the object to avoid null refs
    this.enemyHpText = this.add.text(0, 0, "", { fontSize: "1px" }).setVisible(false).setDepth(11);

    // ===== Player status panel (lower-right) =====
    const pb = this.playerBoxRect();
    this.drawStatusPanel(pb);
    this.playerNameText = this.add
      .text(pb.x + 16, pb.y + Math.round(9 * this.sy), `${this.playerMon.name}`, {
        fontSize: "15px", color: NAME, fontFamily: F, fontStyle: "bold",
      }).setDepth(11);
    this.playerLvText = this.add.text(pb.x + pb.w - 14, pb.y + Math.round(10 * this.sy), `Lv${this.playerMon.level}`, {
      fontSize: "13px", color: LV, fontFamily: F, fontStyle: "bold",
    }).setOrigin(1, 0).setDepth(11);
    const pg = this.hpGeom(true);
    this.drawTag(pb.x + 16, pg.y, "HP", HPTAG);
    this.playerHpBar = this.add.graphics().setDepth(11);
    this.drawHpBarGraphic(this.playerHpBar, pg.x, pg.y - pg.h / 2, pg.w, pg.h, this.playerMon.currentHp / this.playerMon.maxHp);
    this.playerHpText = this.add
      .text(pb.x + pb.w - 14, pg.y + Math.round(9 * this.sy), `${this.playerMon.currentHp}/${this.playerMon.maxHp}`, {
        fontSize: "15px", color: NAME, fontFamily: F, fontStyle: "bold",
      }).setOrigin(1, 0).setDepth(11);
    // EXP bar (player only)
    const xg = this.expGeom();
    this.drawTag(pb.x + 16, xg.y, "EXP", EXPTAG);
    this.playerExpBar = this.add.graphics().setDepth(11);
    this.refreshPlayerExp();
  }

  // Draw a capsule HP bar: outer dark border, light track, colored fill.
  private drawHpBarGraphic(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number, ratio: number): void {
    g.clear();
    const r = height / 2;
    g.fillStyle(0x30363f);
    g.fillRoundedRect(x - 2, y - 2, width + 4, height + 4, r + 1);
    g.fillStyle(0xdfe3e0);
    g.fillRoundedRect(x, y, width, height, r);
    const cr = Phaser.Math.Clamp(ratio, 0, 1);
    const color = cr > 0.5 ? 0x40c850 : cr > 0.2 ? 0xf0c020 : 0xe84030;
    const fw = Math.floor(width * cr);
    if (fw > 0) {
      g.fillStyle(color);
      g.fillRoundedRect(x, y, Math.max(fw, height), height, r);
    }
  }

  // ---- HUD refresh helpers (single source of truth for coordinates) ----
  private refreshPlayerHp(): void {
    const g = this.hpGeom(true);
    this.drawHpBarGraphic(this.playerHpBar, g.x, g.y - g.h / 2, g.w, g.h, this.playerMon.currentHp / this.playerMon.maxHp);
    this.playerHpText.setText(`${this.playerMon.currentHp}/${this.playerMon.maxHp}`);
    this.refreshPlayerExp();
  }
  private refreshEnemyHp(): void {
    const g = this.hpGeom(false);
    this.drawHpBarGraphic(this.enemyHpBar, g.x, g.y - g.h / 2, g.w, g.h, this.enemyMon.currentHp / this.enemyMon.maxHp);
  }
  private refreshPlayerExp(): void {
    const xg = this.expGeom();
    const cur = getExpForLevel(this.playerInstance.level);
    const next = getExpForLevel(this.playerInstance.level + 1);
    const ratio = Phaser.Math.Clamp((this.playerInstance.exp - cur) / Math.max(1, next - cur), 0, 1);
    this.playerExpBar.clear();
    const r = xg.h / 2;
    this.playerExpBar.fillStyle(0x30363f);
    this.playerExpBar.fillRoundedRect(xg.x - 2, xg.y - xg.h / 2 - 2, xg.w + 4, xg.h + 4, r + 1);
    this.playerExpBar.fillStyle(0xdfe3e0);
    this.playerExpBar.fillRoundedRect(xg.x, xg.y - xg.h / 2, xg.w, xg.h, r);
    const fw = Math.floor(xg.w * ratio);
    if (fw > 0) {
      this.playerExpBar.fillStyle(0x3a9be0);
      this.playerExpBar.fillRoundedRect(xg.x, xg.y - xg.h / 2, Math.max(fw, xg.h), xg.h, r);
    }
  }

  private drawMessageWindow(): void {
    this.msgBg = this.add.graphics().setDepth(20);
    this.msgBg.fillStyle(0x111122, 0.95);
    const msgY = Math.round(240 * this.sy);
    const msgH = Math.round(100 * this.sy);
    this.msgBg.fillRect(0, msgY, 640, msgH);
    this.msgBg.lineStyle(2, 0x4488aa);
    this.msgBg.strokeRect(2, msgY + 2, 636, msgH - 4);

    this.msgText = this.add
      .text(20, Math.round(260 * this.sy), "", {
        fontSize: "16px",
        color: "#ffffff",
        fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 3,
        wordWrap: { width: 600 },
      })
      .setDepth(21);
  }

  private drawCommandWindow(): void {
    const labels = ["たたかう", "どうぐ", "交代", "にげる"];
    const positions = [
      { x: 160, y: Math.round(370 * this.sy) },
      { x: 480, y: Math.round(370 * this.sy) },
      { x: 160, y: Math.round(430 * this.sy) },
      { x: 480, y: Math.round(430 * this.sy) },
    ];

    for (let i = 0; i < 4; i++) {
      const px = positions[i].x;
      const py = positions[i].y;
      const bg = this.add.graphics().setDepth(20).setVisible(false);
      const text = this.add
        .text(px, py, labels[i], {
          fontSize: "18px",
          color: "#ffffff",
          fontFamily: "'DotGothic16', monospace",
          stroke: "#000000", strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(21)
        .setVisible(false);

      const zone = this.add
        .zone(px, py, 280, 50)
        .setInteractive()
        .setDepth(22)
        .setOrigin(0.5);
      zone.setVisible(false);
      zone.disableInteractive();

      const idx = i;
      zone.on("pointerdown", () => {
        if (this.phase === "command") {
          this.selectedCommand = idx;
          this.highlightCommand(idx);
          this.executeCommand(idx);
        }
      });

      this.commandSlots.push({ label: labels[i], x: px, y: py, bg, text, zone });
    }
  }

  private showCommandWindow(): void {
    this.commandSlots.forEach((slot) => {
      slot.bg.setVisible(true);
      slot.text.setVisible(true);
      slot.zone.setVisible(true);
      slot.zone.setInteractive();
    });
    this.selectedCommand = 0;
    this.highlightCommand(0);
  }

  private hideCommandWindow(): void {
    this.commandSlots.forEach((slot) => {
      slot.bg.setVisible(false);
      slot.text.setVisible(false);
      slot.zone.setVisible(false);
      slot.zone.disableInteractive();
    });
  }

  private highlightCommand(index: number): void {
    const w = 280;
    const h = 50;
    this.commandSlots.forEach((slot, i) => {
      slot.bg.clear();
      if (i === index) {
        slot.bg.fillStyle(0x2244aa, 0.9);
        slot.bg.fillRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 8);
        slot.bg.lineStyle(2, 0x66aaff);
        slot.bg.strokeRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 8);
        slot.text.setColor("#ffffff");
      } else {
        slot.bg.fillStyle(0x222233, 0.8);
        slot.bg.fillRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 8);
        slot.bg.lineStyle(1, 0x445566);
        slot.bg.strokeRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 8);
        slot.text.setColor("#aaaaaa");
      }
    });
  }

  private showMoveSelect(): void {
    this.phase = "move_select";
    this.hideCommandWindow();
    this.selectedMove = 0;

    this.moveSlots.forEach((slot) => {
      slot.bg.destroy();
      slot.text.destroy();
      slot.zone.destroy();
    });
    this.moveSlots = [];

    const moves = this.playerMon.moves;
    const positions = [
      { x: 160, y: Math.round(370 * this.sy) },
      { x: 480, y: Math.round(370 * this.sy) },
      { x: 160, y: Math.round(430 * this.sy) },
      { x: 480, y: Math.round(430 * this.sy) },
    ];

    for (let i = 0; i < 4; i++) {
      const px = positions[i].x;
      const py = positions[i].y;
      const move = moves[i];
      const label = move ? move.name : "---";

      const bg = this.add.graphics().setDepth(20);
      const text = this.add
        .text(px, py, label, {
          fontSize: "18px",
          color: move ? "#ffffff" : "#555555",
          fontFamily: "'DotGothic16', monospace",
          stroke: "#000000", strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(21);

      const zone = this.add
        .zone(px, py, 280, 50)
        .setDepth(22)
        .setOrigin(0.5);

      if (move) {
        zone.setInteractive();
        const idx = i;
        zone.on("pointerdown", () => {
          if (this.phase === "move_select") {
            this.selectedMove = idx;
            this.highlightMoves(idx);
            this.executeTurn(this.playerMon.moves[idx]);
          }
        });
      }

      this.moveSlots.push({ label, x: px, y: py, bg, text, zone });
    }

    this.highlightMoves(0);
  }

  private hideMoveSelect(): void {
    this.moveSlots.forEach((slot) => {
      slot.bg.destroy();
      slot.text.destroy();
      slot.zone.destroy();
    });
    this.moveSlots = [];
  }

  private highlightMoves(index: number): void {
    const w = 280;
    const h = 50;
    this.moveSlots.forEach((slot, i) => {
      slot.bg.clear();
      const move = this.playerMon.moves[i];
      if (i === index && move) {
        slot.bg.fillStyle(0x2244aa, 0.9);
        slot.bg.fillRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 8);
        slot.bg.lineStyle(2, 0x66aaff);
        slot.bg.strokeRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 8);
        slot.text.setColor("#ffffff");
      } else {
        slot.bg.fillStyle(0x222233, 0.8);
        slot.bg.fillRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 8);
        slot.bg.lineStyle(1, 0x445566);
        slot.bg.strokeRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 8);
        slot.text.setColor(move ? "#aaaaaa" : "#555555");
      }
    });
  }

  // ---- Input ----

  private setupInput(): void {
    if (this.input.keyboard) {
      this.cursorKeys = this.input.keyboard.createCursorKeys();
      this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
      this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      this.bKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B);
      this.escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    }

    this.msgBg.setInteractive(
      new Phaser.Geom.Rectangle(0, Math.round(240 * this.sy), 640, Math.round(100 * this.sy)),
      Phaser.Geom.Rectangle.Contains
    );
    this.msgBg.on("pointerdown", () => {
      if (this.waitingForInput) {
        this.waitingForInput = false;
        this.processMessageQueue();
      }
    });
  }

  update(): void {
    // Keyboard input (may not be available on mobile)
    let kbUp = false, kbDown = false, kbLeft = false, kbRight = false;
    let kbEnter = false, kbSpace = false, kbB = false, kbEsc = false;

    if (this.input.keyboard && this.cursorKeys) {
      kbUp = Phaser.Input.Keyboard.JustDown(this.cursorKeys.up);
      kbDown = Phaser.Input.Keyboard.JustDown(this.cursorKeys.down);
      kbLeft = Phaser.Input.Keyboard.JustDown(this.cursorKeys.left);
      kbRight = Phaser.Input.Keyboard.JustDown(this.cursorKeys.right);
      kbEnter = Phaser.Input.Keyboard.JustDown(this.enterKey);
      kbSpace = Phaser.Input.Keyboard.JustDown(this.spaceKey);
      kbB = Phaser.Input.Keyboard.JustDown(this.bKey);
      kbEsc = Phaser.Input.Keyboard.JustDown(this.escKey);
    }

    // Gamepad input
    const gp = typeof window !== "undefined" ? (window as any).__gamepad : null;
    const gpDpad = gp?.dpad || null;
    const gpDpadJustUp = gpDpad === "up" && this.gpPrevDpad !== "up";
    const gpDpadJustDown = gpDpad === "down" && this.gpPrevDpad !== "down";
    const gpDpadJustLeft = gpDpad === "left" && this.gpPrevDpad !== "left";
    const gpDpadJustRight = gpDpad === "right" && this.gpPrevDpad !== "right";
    this.gpPrevDpad = gpDpad;

    let gpA = false, gpB = false;
    if (gp) {
      if (gp.aJust) { gpA = true; gp.aJust = false; }
      if (gp.bJust) { gpB = true; gp.bJust = false; }
    }

    // Combined input
    const justUp = kbUp || gpDpadJustUp;
    const justDown = kbDown || gpDpadJustDown;
    const justLeft = kbLeft || gpDpadJustLeft;
    const justRight = kbRight || gpDpadJustRight;
    const confirm = kbEnter || kbSpace || gpA;
    const cancel = kbB || kbEsc || gpB;

    if (this.waitingForInput && confirm) {
      this.waitingForInput = false;
      this.processMessageQueue();
      return;
    }

    // Evolution cancel
    if (this.phase === "evolution" && cancel) {
      this.evolutionCancelled = true;
    }

    if (this.phase === "command") {
      if (justUp && this.selectedCommand >= 2) {
        this.selectedCommand -= 2;
        this.highlightCommand(this.selectedCommand);
      }
      if (justDown && this.selectedCommand < 2) {
        this.selectedCommand += 2;
        this.highlightCommand(this.selectedCommand);
      }
      if (justLeft && this.selectedCommand % 2 === 1) {
        this.selectedCommand -= 1;
        this.highlightCommand(this.selectedCommand);
      }
      if (justRight && this.selectedCommand % 2 === 0) {
        this.selectedCommand += 1;
        this.highlightCommand(this.selectedCommand);
      }
      if (confirm) {
        this.executeCommand(this.selectedCommand);
      }
    } else if (this.phase === "move_select") {
      const maxMoves = this.playerMon.moves.length;
      if (justUp && this.selectedMove >= 2) {
        this.selectedMove -= 2;
        this.highlightMoves(this.selectedMove);
      }
      if (justDown && this.selectedMove + 2 < maxMoves) {
        this.selectedMove += 2;
        this.highlightMoves(this.selectedMove);
      }
      if (justLeft && this.selectedMove % 2 === 1) {
        this.selectedMove -= 1;
        this.highlightMoves(this.selectedMove);
      }
      if (justRight && this.selectedMove % 2 === 0 && this.selectedMove + 1 < maxMoves) {
        this.selectedMove += 1;
        this.highlightMoves(this.selectedMove);
      }
      if (confirm) {
        const move = this.playerMon.moves[this.selectedMove];
        if (move) {
          this.executeTurn(move);
        }
      }
      if (kbEsc || gpB) {
        this.hideMoveSelect();
        this.phase = "command";
        this.showCommandWindow();
        this.setMessage("");
      }
    } else if (this.phase === "learn_move") {
      // Move replacement selection handled by command slots
      const maxSlots = Math.min(this.commandSlots.length, 5);
      if (justUp && this.selectedCommand >= 2) {
        this.selectedCommand -= 2;
        this.highlightLearnSlots(this.selectedCommand);
      }
      if (justDown && this.selectedCommand + 2 < maxSlots) {
        this.selectedCommand += 2;
        this.highlightLearnSlots(this.selectedCommand);
      }
      if (justLeft && this.selectedCommand % 2 === 1) {
        this.selectedCommand -= 1;
        this.highlightLearnSlots(this.selectedCommand);
      }
      if (justRight && this.selectedCommand % 2 === 0 && this.selectedCommand + 1 < maxSlots) {
        this.selectedCommand += 1;
        this.highlightLearnSlots(this.selectedCommand);
      }
      if (confirm) {
        this.handleMoveLearnChoice(this.selectedCommand);
      }
    }
  }

  // ---- Commands ----

  private executeCommand(index: number): void {
    switch (index) {
      case 0:
        this.showMoveSelect();
        break;
      case 1:
        this.handleItemUse();
        break;
      case 2:
        this.handleSwitch();
        break;
      case 3:
        this.handleFlee();
        break;
    }
  }

  // ---- Turn Execution ----

  private executeTurn(playerMove: BattleMove): void {
    this.phase = "executing";
    this.hideMoveSelect();

    const playerSpeed = this.playerMon.speed * this.playerMon.speedMod;
    const enemySpeed = this.enemyMon.speed * this.enemyMon.speedMod;
    const enemyMove =
      this.enemyMon.moves[Math.floor(Math.random() * this.enemyMon.moves.length)];

    // Priority move check
    const playerPriority = playerMove.priority || false;
    const enemyPriority = enemyMove.priority || false;

    let playerFirst: boolean;
    if (playerPriority && !enemyPriority) playerFirst = true;
    else if (!playerPriority && enemyPriority) playerFirst = false;
    else playerFirst = playerSpeed >= enemySpeed;

    const firstAttacker = playerFirst ? this.playerMon : this.enemyMon;
    const firstMove = playerFirst ? playerMove : enemyMove;
    const firstTarget = playerFirst ? this.enemyMon : this.playerMon;
    const firstSprite = playerFirst ? this.enemySprite : this.playerSprite;

    const secondAttacker = playerFirst ? this.enemyMon : this.playerMon;
    const secondMove = playerFirst ? enemyMove : playerMove;
    const secondTarget = playerFirst ? this.playerMon : this.enemyMon;
    const secondSprite = playerFirst ? this.playerSprite : this.enemySprite;

    this.executeAction(firstAttacker, firstMove, firstTarget, firstSprite, () => {
      if (firstTarget.currentHp <= 0) {
        this.checkBattleEnd();
        return;
      }
      this.executeAction(secondAttacker, secondMove, secondTarget, secondSprite, () => {
        if (secondTarget.currentHp <= 0) {
          this.checkBattleEnd();
          return;
        }
        this.phase = "command";
        this.showCommandWindow();
      });
    });
  }

  private executeAction(
    attacker: BattleMonster,
    move: BattleMove,
    target: BattleMonster,
    targetSprite: Phaser.GameObjects.Image,
    onComplete: () => void
  ): void {
    const messages: string[] = [];

    if (move.isSupport && move.effect) {
      messages.push(`${attacker.name}の ${move.name}！`);
      const eff = move.effect;

      // Heal effects
      if (eff.type === "heal" || eff.type === "healAndBuff") {
        const healAmount = Math.floor(attacker.maxHp * ((eff.healPercent || 50) / 100));
        attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + healAmount);
        messages.push(`${attacker.name}のHPが かいふくした！`);
        // Sync to instance if player
        if (attacker === this.playerMon) {
          this.playerInstance.currentHp = attacker.currentHp;
        }
      }

      // Stat change
      if (eff.type === "statChange" || eff.type === "healAndBuff" || eff.type === "allStatsUp") {
        const subject = eff.target === "self" ? attacker : target;
        if (eff.type === "allStatsUp") {
          const mult = eff.multiplier || 1.2;
          subject.attackMod *= mult;
          subject.defenseMod *= mult;
          subject.speedMod *= mult;
          messages.push(`${subject.name}の のうりょくが あがった！`);
        } else if (eff.stat) {
          const mult = eff.multiplier || 1;
          switch (eff.stat) {
            case "attack": subject.attackMod *= mult; break;
            case "defense": subject.defenseMod *= mult; break;
            case "speed": subject.speedMod *= mult; break;
          }
          const statName = eff.stat === "attack" ? "こうげき" : eff.stat === "defense" ? "ぼうぎょ" : "すばやさ";
          const direction = mult > 1 ? "あがった" : "さがった";
          messages.push(`${subject.name}の ${statName}が ${direction}！`);
        }
      }

      this.showMessages(messages, () => {
        // Update HP bar if healed
        if (attacker === this.playerMon) {
          this.refreshPlayerHp();
        }
        onComplete();
      });
    } else {
      // Attack move
      // Check accuracy
      const roll = Math.random() * 100;
      const acc = (move as BattleMove & { accuracy?: number }).accuracy || 100;
      if (roll > acc) {
        messages.push(`${attacker.name}の ${move.name}！`);
        messages.push(`しかし こうげきは はずれた！`);
        this.showMessages(messages, onComplete);
        return;
      }

      // Multi-hit
      if (move.effect && move.effect.type === "multiHit") {
        const hits = Phaser.Math.Between(move.effect.min || 2, move.effect.max || 5);
        messages.push(`${attacker.name}の ${move.name}！`);
        let totalDamage = 0;
        for (let i = 0; i < hits; i++) {
          const { damage } = calculateDamage(attacker, target, move, this.typeChart);
          totalDamage += damage;
        }
        target.currentHp = Math.max(0, target.currentHp - totalDamage);
        messages.push(`${hits}かい あたった！`);

        this.showMessages(messages, () => {
          this.blinkSprite(targetSprite, () => {
            this.syncHpToInstance(target);
            this.animateHpBar(target, target === this.playerMon, onComplete);
          });
        });
        return;
      }

      const { damage, effectiveness } = calculateDamage(attacker, target, move, this.typeChart);
      messages.push(`${attacker.name}の ${move.name}！`);

      this.showMessages(messages, () => {
        target.currentHp = Math.max(0, target.currentHp - damage);
        this.syncHpToInstance(target);

        this.blinkSprite(targetSprite, () => {
          this.animateHpBar(target, target === this.playerMon, () => {
            const effMessages: string[] = [];
            if (effectiveness >= 2.0) effMessages.push("こうかは バツグンだ！");
            else if (effectiveness <= 0.5) effMessages.push("こうかは いまひとつ…");
            if (effMessages.length > 0) {
              this.showMessages(effMessages, onComplete);
            } else {
              onComplete();
            }
          });
        });
      });
    }
  }

  private syncHpToInstance(mon: BattleMonster): void {
    if (mon === this.playerMon) {
      this.playerInstance.currentHp = mon.currentHp;
    } else {
      this.enemyInstance.currentHp = mon.currentHp;
    }
  }

  // ---- Animations ----

  private blinkSprite(sprite: Phaser.GameObjects.Image, onComplete: () => void): void {
    let count = 0;
    this.time.addEvent({
      delay: 100,
      repeat: 5,
      callback: () => {
        sprite.setVisible(!sprite.visible);
        count++;
        if (count >= 6) {
          sprite.setVisible(true);
          onComplete();
        }
      },
    });
  }

  private animateHpBar(mon: BattleMonster, isPlayer: boolean, onComplete: () => void): void {
    const hpBar = isPlayer ? this.playerHpBar : this.enemyHpBar;
    const g = this.hpGeom(isPlayer);
    const barY = g.y - g.h / 2;
    const targetRatio = mon.currentHp / mon.maxHp;

    this.tweens.addCounter({
      from: 0,
      to: 100,
      duration: 400,
      ease: "Linear",
      onUpdate: (tween) => {
        const progress = (tween.getValue() ?? 0) / 100;
        const displayRatio = Phaser.Math.Linear(targetRatio + (1 - progress) * 0.1, targetRatio, progress);
        this.drawHpBarGraphic(hpBar, g.x, barY, g.w, g.h, Phaser.Math.Clamp(displayRatio, 0, 1));
      },
      onComplete: () => {
        this.drawHpBarGraphic(hpBar, g.x, barY, g.w, g.h, targetRatio);
        // enemy HP numbers are hidden (RSE-style); only the player shows numbers
        if (isPlayer) this.playerHpText.setText(`${mon.currentHp}/${mon.maxHp}`);
        onComplete();
      },
    });
  }

  // ---- Messages ----

  private setMessage(text: string): void {
    this.msgText.setText(text);
  }

  private showMessages(texts: string[], onAllDone: () => void): void {
    this.messageQueue = texts.map((text, i) => ({
      text,
      callback: i === texts.length - 1 ? onAllDone : undefined,
    }));
    this.isShowingMessage = true;
    this.processMessageQueue();
  }

  private processMessageQueue(): void {
    if (this.messageQueue.length === 0) {
      this.isShowingMessage = false;
      return;
    }
    const msg = this.messageQueue.shift()!;
    this.setMessage(msg.text);

    if (msg.callback) {
      this.waitingForInput = true;
      this.time.delayedCall(300, () => {
        const checkDone = () => {
          if (!this.waitingForInput) msg.callback!();
          else this.time.delayedCall(50, checkDone);
        };
        checkDone();
      });
    } else {
      this.waitingForInput = true;
      this.time.delayedCall(300, () => {
        const checkDone = () => {
          if (!this.waitingForInput) this.processMessageQueue();
          else this.time.delayedCall(50, checkDone);
        };
        checkDone();
      });
    }
  }

  // ---- Battle End ----

  private checkBattleEnd(): void {
    if (this.enemyMon.currentHp <= 0) {
      this.phase = "victory";
      this.tweens.add({
        targets: this.enemySprite,
        alpha: 0,
        y: this.enemySprite.y + 30,
        duration: 500,
      });
      const enemyData = this.allMonsters.find((m) => m.id === this.enemyInstance.dataId)!;
      this.showMessages([`${enemyData.name} を たおした！`], () => {
        if (this.trainerData && this.trainerPartyIndex < this.trainerData.party.length - 1) {
          // Trainer has more monsters
          this.handleExpGain(() => this.trainerSendNext());
        } else if (this.trainerData) {
          // Last trainer mon defeated
          this.trainerSendNext();
        } else {
          this.handleExpGain();
        }
      });
    } else if (this.playerMon.currentHp <= 0) {
      this.phase = "defeat";
      this.tweens.add({
        targets: this.playerSprite,
        alpha: 0,
        y: this.playerSprite.y + 30,
        duration: 500,
      });
      this.showMessages(["めのまえが まっくらになった…"], () => {
        this.time.delayedCall(1500, () => this.endBattleDefeat());
      });
    }
  }

  // ---- Experience & Level Up ----

  private afterExpCallback: (() => void) | null = null;

  private handleExpGain(afterDone?: () => void): void {
    this.afterExpCallback = afterDone || null;
    const enemyData = this.allMonsters.find((m) => m.id === this.enemyInstance.dataId)!;
    const expGain = getExpReward(enemyData.baseExp, this.enemyInstance.level);
    this.playerInstance.exp += expGain;
    this.refreshPlayerExp();

    const playerData = this.allMonsters.find((m) => m.id === this.playerInstance.dataId)!;

    this.showMessages(
      [`${playerData.name}は ${expGain}けいけんちを かくとく！`],
      () => {
        this.checkLevelUp();
      }
    );
  }

  private checkLevelUp(): void {
    const nextLevelExp = getExpForLevel(this.playerInstance.level + 1);
    if (this.playerInstance.exp >= nextLevelExp && this.playerInstance.level < 100) {
      this.playerInstance.level++;
      applyLevelUp(this.playerInstance, this.allMonsters);
      // Sync battle monster
      this.playerMon.level = this.playerInstance.level;
      this.playerMon.maxHp = this.playerInstance.maxHp;
      this.playerMon.currentHp = this.playerInstance.currentHp;
      this.playerMon.attack = this.playerInstance.stats.attack;
      this.playerMon.defense = this.playerInstance.stats.defense;
      this.playerMon.speed = this.playerInstance.stats.speed;

      // Update display
      const playerData = this.allMonsters.find((m) => m.id === this.playerInstance.dataId)!;
      this.playerNameText.setText(`${playerData.name}`);
      this.playerLvText.setText(`Lv${this.playerInstance.level}`);
      this.refreshPlayerHp();

      this.showMessages(
        [`${playerData.name}は レベル${this.playerInstance.level}に なった！`],
        () => {
          // Check for new move
          const newMoveId = getNewMoveAtLevel(
            this.allMonsters.find((m) => m.id === this.playerInstance.dataId)!,
            this.playerInstance.level
          );
          if (newMoveId) {
            this.handleNewMove(newMoveId);
          } else {
            // Check for more level ups
            this.checkLevelUp();
          }
        }
      );
    } else {
      // No more level ups, check evolution
      this.checkEvolutionTrigger();
    }
  }

  // ---- Move Learning ----

  private handleNewMove(moveId: string): void {
    const moveData = this.allMoves.find((m) => m.id === moveId)!;

    if (this.playerInstance.moves.length < 4) {
      this.playerInstance.moves.push(moveId);
      // Refresh battle monster moves
      this.playerMon = this.instanceToBattleMonster(this.playerInstance);

      this.showMessages(
        [`${this.allMonsters.find((m) => m.id === this.playerInstance.dataId)!.name}は ${moveData.name}を おぼえた！`],
        () => this.checkLevelUp()
      );
    } else {
      // Need to forget a move
      this.pendingMoveId = moveId;
      this.showMessages(
        [
          `${moveData.name}を おぼえたい…`,
          `しかし わざは 4つまでしか おぼえられない！`,
          `わざを わすれさせますか？`,
        ],
        () => {
          this.showMoveLearnUI(moveId);
        }
      );
    }
  }

  private showMoveLearnUI(newMoveId: string): void {
    this.phase = "learn_move";
    this.hideCommandWindow();

    // Destroy old command slots
    this.commandSlots.forEach((s) => {
      s.bg.destroy();
      s.text.destroy();
      s.zone.destroy();
    });
    this.commandSlots = [];

    const newMove = this.allMoves.find((m) => m.id === newMoveId)!;
    // Show 4 existing moves + "覚えない" option
    const labels = [
      ...this.playerInstance.moves.map((mid) => this.allMoves.find((m) => m.id === mid)!.name),
      "覚えない",
    ];
    const positions = [
      { x: 160, y: Math.round(360 * this.sy) },
      { x: 480, y: Math.round(360 * this.sy) },
      { x: 160, y: Math.round(410 * this.sy) },
      { x: 480, y: Math.round(410 * this.sy) },
      { x: 320, y: Math.round(455 * this.sy) },
    ];

    for (let i = 0; i < labels.length; i++) {
      const px = positions[i].x;
      const py = positions[i].y;
      const bg = this.add.graphics().setDepth(20);
      const text = this.add
        .text(px, py, labels[i], {
          fontSize: "15px",
          color: "#ffffff",
          fontFamily: "'DotGothic16', monospace",
          stroke: "#000000", strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(21);

      const zone = this.add
        .zone(px, py, 260, 40)
        .setInteractive()
        .setDepth(22)
        .setOrigin(0.5);

      const idx = i;
      zone.on("pointerdown", () => {
        if (this.phase === "learn_move") {
          this.handleMoveLearnChoice(idx);
        }
      });

      this.commandSlots.push({ label: labels[i], x: px, y: py, bg, text, zone });
    }

    this.selectedCommand = 0;
    this.highlightLearnSlots(0);
    this.setMessage(`どの わざを わすれさせる？（新: ${newMove.name}）`);
  }

  private highlightLearnSlots(index: number): void {
    const w = 260;
    const h = 40;
    this.commandSlots.forEach((slot, i) => {
      slot.bg.clear();
      if (i === index) {
        slot.bg.fillStyle(0x2244aa, 0.9);
        slot.bg.fillRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 6);
        slot.bg.lineStyle(2, 0x66aaff);
        slot.bg.strokeRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 6);
      } else {
        slot.bg.fillStyle(0x222233, 0.8);
        slot.bg.fillRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 6);
        slot.bg.lineStyle(1, 0x445566);
        slot.bg.strokeRoundedRect(slot.x - w / 2, slot.y - h / 2, w, h, 6);
      }
    });
  }

  private handleMoveLearnChoice(index: number): void {
    if (!this.pendingMoveId) return;

    // Clear UI
    this.commandSlots.forEach((s) => {
      s.bg.destroy();
      s.text.destroy();
      s.zone.destroy();
    });
    this.commandSlots = [];

    const newMove = this.allMoves.find((m) => m.id === this.pendingMoveId)!;
    const playerData = this.allMonsters.find((m) => m.id === this.playerInstance.dataId)!;

    if (index === 4) {
      // Don't learn
      this.pendingMoveId = null;
      this.showMessages(
        [`${playerData.name}は ${newMove.name}を おぼえるのを あきらめた！`],
        () => {
          this.rebuildCommandWindow();
          this.checkLevelUp();
        }
      );
    } else {
      // Replace move
      const oldMoveId = this.playerInstance.moves[index];
      const oldMove = this.allMoves.find((m) => m.id === oldMoveId)!;
      this.playerInstance.moves[index] = this.pendingMoveId;
      this.playerMon = this.instanceToBattleMonster(this.playerInstance);
      this.pendingMoveId = null;

      this.showMessages(
        [
          `1… 2…… ${playerData.name}は ${oldMove.name}を わすれた！`,
          `そして ${newMove.name}を おぼえた！`,
        ],
        () => {
          this.rebuildCommandWindow();
          this.checkLevelUp();
        }
      );
    }
  }

  private rebuildCommandWindow(): void {
    // Rebuild standard command slots
    this.commandSlots.forEach((s) => {
      s.bg.destroy();
      s.text.destroy();
      s.zone.destroy();
    });
    this.commandSlots = [];
    this.drawCommandWindow();
  }

  // ---- Evolution ----

  private checkEvolutionTrigger(): void {
    const evoResult = checkEvolution(this.playerInstance, this.allMonsters);
    if (evoResult) {
      this.pendingEvolution = evoResult;
      this.startEvolution();
    } else if (this.afterExpCallback) {
      const cb = this.afterExpCallback;
      this.afterExpCallback = null;
      this.time.delayedCall(500, () => cb());
    } else {
      this.time.delayedCall(500, () => this.endBattle());
    }
  }

  private startEvolution(): void {
    if (!this.pendingEvolution) return;
    this.phase = "evolution";
    this.evolutionCancelled = false;

    const playerData = this.allMonsters.find((m) => m.id === this.playerInstance.dataId)!;

    this.showMessages(
      [`おや…？ ${playerData.name}の ようすが…？`],
      () => {
        this.setMessage("Bキーで しんかを とめられます");
        // Blink animation for 3 seconds
        let blinkCount = 0;
        const maxBlinks = 15;
        const blinkEvent = this.time.addEvent({
          delay: 200,
          repeat: maxBlinks - 1,
          callback: () => {
            blinkCount++;
            this.playerSprite.setTint(blinkCount % 2 === 0 ? 0xffffff : 0xffffdd);
            this.playerSprite.setAlpha(blinkCount % 2 === 0 ? 1 : 0.5);

            if (this.evolutionCancelled) {
              blinkEvent.remove();
              this.playerSprite.clearTint();
              this.playerSprite.setAlpha(1);
              this.pendingEvolution = null;
              this.showMessages(
                [`あれ…？ しんかが とまった！`],
                () => {
                  this.time.delayedCall(500, () => this.endBattle());
                }
              );
              return;
            }

            if (blinkCount >= maxBlinks) {
              this.completeEvolution();
            }
          },
        });
      }
    );
  }

  private completeEvolution(): void {
    if (!this.pendingEvolution) return;

    const oldData = this.allMonsters.find((m) => m.id === this.playerInstance.dataId)!;
    const newData = this.pendingEvolution.newData;

    applyEvolution(this.playerInstance, this.pendingEvolution.evolvesTo, this.allMonsters, this.allMoves);

    // Update sprite
    this.playerSprite.clearTint();
    this.playerSprite.setAlpha(1);
    this.playerSprite.setTexture(this.playerTexKey(newData.id));
    this.sizeMonsterSprite(this.playerSprite, 128, 132);

    // Update battle monster
    this.playerMon = this.instanceToBattleMonster(this.playerInstance);
    this.playerNameText.setText(`${newData.name}`);
    this.playerLvText.setText(`Lv${this.playerInstance.level}`);
    this.refreshPlayerHp();

    this.showMessages(
      [`おめでとう！ ${oldData.name}は ${newData.name}に しんかした！`],
      () => {
        this.pendingEvolution = null;
        // Check if new move at evolution level
        const newMoveId = getNewMoveAtLevel(newData, this.playerInstance.level);
        if (newMoveId && !this.playerInstance.moves.includes(newMoveId)) {
          this.handleNewMove(newMoveId);
        } else {
          this.time.delayedCall(500, () => this.endBattle());
        }
      }
    );
  }

  // ---- Flee ----

  private handleFlee(): void {
    this.hideCommandWindow();

    // Trainer battles: fleeing is never allowed.
    if (!this.isWild) {
      this.showMessages(["トレーナーとの しょうぶからは にげられない！"], () => {
        this.phase = "command";
        this.showCommandWindow();
      });
      return;
    }

    // Wild battles: speed-based escape (Gen3-style odds that improve with each
    // attempt). A faster monster always gets away.
    this.fleeAttempts++;
    const pSpd = Math.max(1, Math.round(this.playerMon.speed * this.playerMon.speedMod));
    const eSpd = Math.max(1, Math.round(this.enemyMon.speed * this.enemyMon.speedMod));
    const odds = Math.floor((pSpd * 128) / eSpd) + 30 * this.fleeAttempts;
    const success = pSpd >= eSpd || Phaser.Math.Between(0, 255) < odds;

    if (success) {
      this.showMessages(["うまく にげきれた！"], () => this.endBattle());
      return;
    }

    // Failed escape: the enemy gets a free turn.
    this.phase = "executing";
    this.showMessages(["だめだ！ にげられなかった！"], () => {
      const enemyMove = this.enemyMon.moves[
        Math.floor(Math.random() * this.enemyMon.moves.length)
      ];
      this.executeAction(
        this.enemyMon, enemyMove, this.playerMon, this.playerSprite,
        () => {
          if (this.playerMon.currentHp <= 0) {
            this.checkBattleEnd();
          } else {
            this.phase = "command";
            this.showCommandWindow();
          }
        }
      );
    });
  }

  // ---- Item Use (Capture) ----

  private handleItemUse(): void {
    this.hideCommandWindow();

    if (!this.isWild) {
      this.showMessages(["トレーナーのモンスターには 使えない！"], () => {
        this.phase = "command";
        this.showCommandWindow();
      });
      return;
    }

    const capsuleItem = this.playerState.items.find(i => i.id === "moon_capsule");
    if (!capsuleItem || capsuleItem.count <= 0) {
      this.showMessages(["ムーンカプセルを もっていない！"], () => {
        this.phase = "command";
        this.showCommandWindow();
      });
      return;
    }

    capsuleItem.count--;
    this.phase = "executing";
    const enemyData = this.allMonsters.find(m => m.id === this.enemyInstance.dataId)!;

    const { success, shakes } = attemptCapture(
      this.enemyMon.currentHp,
      this.enemyMon.maxHp
    );

    const msgs: string[] = [`ムーンカプセルを なげた！`];

    // Shake animation messages
    for (let i = 0; i < shakes; i++) {
      msgs.push("コロン…");
    }

    if (success) {
      msgs.push(`やった！ ${enemyData.name}を つかまえた！`);

      this.showMessages(msgs, () => {
        // Add to party or box
        if (this.playerState.party.length < 6) {
          this.playerState.party.push(this.enemyInstance);
          this.showMessages(
            [`${enemyData.name}が なかまに くわわった！`],
            () => this.endBattle()
          );
        } else {
          this.playerState.box.push(this.enemyInstance);
          this.showMessages(
            [
              `手持ちが いっぱいだ！`,
              `${enemyData.name}は あずかりボックスに おくられた！`,
            ],
            () => this.endBattle()
          );
        }
      });
    } else {
      msgs.push(`だめだ！ ${enemyData.name}に にげられた！`);
      this.showMessages(msgs, () => {
        // Enemy gets a turn
        const enemyMove = this.enemyMon.moves[
          Math.floor(Math.random() * this.enemyMon.moves.length)
        ];
        this.executeAction(
          this.enemyMon, enemyMove, this.playerMon, this.playerSprite,
          () => {
            if (this.playerMon.currentHp <= 0) {
              this.checkBattleEnd();
            } else {
              this.phase = "command";
              this.showCommandWindow();
            }
          }
        );
      });
    }
  }

  // ---- Monster Switch ----

  private handleSwitch(): void {
    this.hideCommandWindow();
    const aliveParty = this.playerState.party.filter(
      (m, i) => m.currentHp > 0 && m !== this.playerInstance
    );

    if (aliveParty.length === 0) {
      this.showMessages(["こうたいできる なかまが いない！"], () => {
        this.phase = "command";
        this.showCommandWindow();
      });
      return;
    }

    // Show switch UI using command slots
    this.commandSlots.forEach(s => { s.bg.destroy(); s.text.destroy(); s.zone.destroy(); });
    this.commandSlots = [];

    const positions = [
      { x: 160, y: Math.round(360 * this.sy) }, { x: 480, y: Math.round(360 * this.sy) },
      { x: 160, y: Math.round(410 * this.sy) }, { x: 480, y: Math.round(410 * this.sy) },
      { x: 160, y: Math.round(455 * this.sy) }, { x: 480, y: Math.round(455 * this.sy) },
    ];

    const options = [
      ...aliveParty.map(m => {
        const d = this.allMonsters.find(md => md.id === m.dataId)!;
        return `${d.name} Lv${m.level} HP${m.currentHp}/${m.maxHp}`;
      }),
      "もどる",
    ];

    this.phase = "learn_move"; // Reuse for selection
    this.selectedCommand = 0;

    for (let i = 0; i < options.length; i++) {
      const px = positions[i % positions.length].x;
      const py = positions[i % positions.length].y;
      const bg = this.add.graphics().setDepth(20);
      const text = this.add.text(px, py, options[i], {
        fontSize: "14px", color: "#ffffff", fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 3,
      }).setOrigin(0.5).setDepth(21);
      const zone = this.add.zone(px, py, 280, 40).setInteractive().setDepth(22).setOrigin(0.5);
      const idx = i;
      zone.on("pointerdown", () => {
        if (idx === aliveParty.length) {
          // Cancel
          this.commandSlots.forEach(s => { s.bg.destroy(); s.text.destroy(); s.zone.destroy(); });
          this.commandSlots = [];
          this.rebuildCommandWindow();
          this.phase = "command";
          this.showCommandWindow();
        } else {
          this.doSwitch(aliveParty[idx]);
        }
      });
      this.commandSlots.push({ label: options[i], x: px, y: py, bg, text, zone });
    }
    this.highlightLearnSlots(0);
    this.setMessage("だれを だす？");
  }

  private doSwitch(newMon: MonsterInstance): void {
    this.commandSlots.forEach(s => { s.bg.destroy(); s.text.destroy(); s.zone.destroy(); });
    this.commandSlots = [];

    const oldData = this.allMonsters.find(m => m.id === this.playerInstance.dataId)!;
    const newData = this.allMonsters.find(m => m.id === newMon.dataId)!;

    this.playerInstance = newMon;
    this.playerMon = this.instanceToBattleMonster(this.playerInstance);

    // Update sprite
    this.playerSprite.setTexture(this.playerTexKey(newMon.dataId));
    this.sizeMonsterSprite(this.playerSprite, 128, 132);
    this.playerNameText.setText(`${newData.name}`);
    this.playerLvText.setText(`Lv${newMon.level}`);
    this.refreshPlayerHp();

    this.showMessages(
      [`${oldData.name} もどれ！ ゆけっ！${newData.name}！`],
      () => {
        // Enemy gets a turn
        const enemyMove = this.enemyMon.moves[
          Math.floor(Math.random() * this.enemyMon.moves.length)
        ];
        this.executeAction(
          this.enemyMon, enemyMove, this.playerMon, this.playerSprite,
          () => {
            if (this.playerMon.currentHp <= 0) {
              this.checkBattleEnd();
            } else {
              this.rebuildCommandWindow();
              this.phase = "command";
              this.showCommandWindow();
            }
          }
        );
      }
    );
  }

  // ---- End Battle ----

  private endBattle(): void {
    this.cameras.main.fadeOut(500, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => {
      this.scene.start("MapScene", {
        mapKey: this.returnMapKey,
        playerX: this.returnPlayerX,
        playerY: this.returnPlayerY,
        playerState: this.playerState,
        trainerDefeated: this.trainerData?.id,
      });
    });
  }

  private endBattleDefeat(): void {
    // Reset all party HP for respawn
    this.playerState.party.forEach(m => { m.currentHp = m.maxHp; });

    this.cameras.main.fadeOut(500, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => {
      this.scene.start("MapScene", {
        mapKey: "moonbase",
        playerState: this.playerState,
      });
    });
  }

  // ---- Trainer: next monster ----

  private trainerSendNext(): void {
    this.trainerPartyIndex++;
    if (!this.trainerData || this.trainerPartyIndex >= this.trainerData.party.length) {
      // Trainer defeated!
      const prize = this.trainerData!.prizeMoneyBase;
      this.playerState.money += prize;
      this.playerState.defeatedTrainers.push(this.trainerData!.id);
      this.showMessages(
        [
          this.trainerData!.dialogWin,
          `${prize}円 もらった！`,
        ],
        () => this.handleExpGain()
      );
      return;
    }

    const next = this.trainerData!.party[this.trainerPartyIndex];
    this.enemyInstance = this.createInstance(next.id, next.level);
    this.enemyMon = this.instanceToBattleMonster(this.enemyInstance);

    const enemyData = this.allMonsters.find(m => m.id === next.id)!;
    this.enemySprite.setTexture(`monster-${next.id}`);
    this.sizeMonsterSprite(this.enemySprite, 110, 116);
    this.enemySprite.setAlpha(1);
    this.enemySprite.setY(Math.round(80 * this.sy));
    this.enemyNameText.setText(`${enemyData.name}`);
    this.enemyLvText.setText(`Lv${next.level}`);
    this.refreshEnemyHp();

    this.showMessages(
      [`${this.trainerData!.name}は ${enemyData.name}を くりだした！`],
      () => {
        this.phase = "command";
        this.showCommandWindow();
      }
    );
  }
}
