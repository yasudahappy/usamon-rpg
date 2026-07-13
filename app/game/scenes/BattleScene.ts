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
import { calculateCaptureRate } from "../data/encounterSystem";
import { markSeen, markCaught } from "../data/dex";
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
  | "target_select"
  | "executing"
  | "victory"
  | "defeat"
  | "exp_gain"
  | "learn_move"
  | "switch_mon"
  | "item_select"
  | "evolution";

// ---- Double battle (2vs2) runtime types ----
interface DSlot {
  mon: BattleMonster;
  inst: MonsterInstance;
  sprite: Phaser.GameObjects.Image;
  panel: {
    bar: Phaser.GameObjects.Graphics;
    name: Phaser.GameObjects.Text;
    lv: Phaser.GameObjects.Text;
    hp?: Phaser.GameObjects.Text;
    objs: Phaser.GameObjects.GameObject[];
    rect: { x: number; y: number; w: number; h: number };
  };
}
interface DAction {
  side: "p" | "e";
  slot: number;
  move: BattleMove;
  targetSide: "p" | "e";
  targetSlot: number;
}

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
  // Evolutions are deferred and played AFTER the battle ends (EvolutionScene).
  private pendingEvolutions: { partyIndex: number; fromId: string; toId: string }[] = [];

  // Move learning
  private pendingMoveId: string | null = null;

  // Player state (party, items, money)
  private playerState!: PlayerState;

  // Battle mode
  private isWild = true;
  private trainerData: TrainerData | null = null;
  private trainerPartyIndex = 0;
  // トレーナーの残り手持ち数を示すボール表示。
  private trainerPips: Phaser.GameObjects.GameObject[] = [];
  private trainerRemaining = 0;
  private trainerPortrait?: Phaser.GameObjects.Image;
  private playerBackPortrait?: Phaser.GameObjects.Image;
  private enemyInfoObjects: Phaser.GameObjects.GameObject[] = [];
  private playerInfoObjects: Phaser.GameObjects.GameObject[] = [];
  private fleeAttempts = 0;

  // ---- Double battle (2vs2) state — singles code never touches these ----
  private isDouble = false;
  private dP: (DSlot | null)[] = [];        // player actives (up to 2)
  private dE: (DSlot | null)[] = [];        // enemy actives (up to 2)
  private dEReserve: { id: string; level: number }[] = [];
  private dCmdSlot = 0;                     // which player slot is choosing
  private dActions: DAction[] = [];
  private dPendingMove: BattleMove | null = null;
  private dTargetIdx = 0;
  private dTargetMarker?: Phaser.GameObjects.Triangle;
  private trainerPortrait2?: Phaser.GameObjects.Image;
  private dParticipants: Set<MonsterInstance> = new Set();
  private dOver = false;

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
    this.pendingEvolutions = [];
    this.pendingMoveId = null;
    this.isWild = data.isWild !== false;
    this.trainerData = data.trainerData || null;
    this.trainerPartyIndex = 0;
    this.trainerPips = [];
    this.trainerRemaining = this.trainerData ? this.trainerData.party.length : 0;
    this.trainerPortrait = undefined;   // display object is recreated per battle
    this.playerBackPortrait = undefined;
    // Double battle reset
    this.isDouble = !!this.trainerData?.doubles;
    this.dP = []; this.dE = []; this.dEReserve = [];
    this.dCmdSlot = 0; this.dActions = []; this.dPendingMove = null;
    this.dTargetIdx = 0; this.dTargetMarker = undefined;
    this.trainerPortrait2 = undefined;
    this.dParticipants = new Set();
    this.dOver = false;

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

    if (this.isDouble) { this.createDouble(); return; }

    this.playerMon = this.instanceToBattleMonster(this.playerInstance);
    this.enemyMon = this.instanceToBattleMonster(this.enemyInstance);

    // ずかん: the opponent is now "seen"; the party is "caught".
    markSeen(this.playerState, this.enemyInstance.dataId);
    this.playerState?.party.forEach(m => markCaught(this.playerState, m.dataId));

    this.drawBackground();
    this.drawMonsters();
    this.drawHpBars();
    // While the hero's back illustration is up, hide the player's status panel too.
    if (this.playerBackPortrait?.visible) {
      this.playerInfoObjects.forEach(o => (o as Phaser.GameObjects.Image).setVisible(false));
    }
    this.drawMessageWindow();
    this.drawCommandWindow();
    this.setupInput();

    this.cameras.main.flash(500, 255, 255, 255);

    this.time.delayedCall(600, () => {
      const enemyData = this.allMonsters.find((m) => m.id === this.enemyInstance.dataId)!;
      const toCommand = () => { this.phase = "command"; this.showCommandWindow(); };
      // Hero throws a capsule and sends out the player's almon.
      const sendOutPlayer = () => this.showMessages(
        [`ゆけっ！ ${this.playerMon.name}！`],
        () => this.throwPlayerCapsuleAndReveal(toCommand)
      );
      if (this.trainerData) {
        const t = this.trainerData;
        // Trainer appears FIRST, then throws a capsule and the almon pops out.
        this.enemySprite.setVisible(false);
        this.showTrainerPortrait(() => {
          this.showMessages(
            [`${t.name}が しょうぶを しかけてきた！`, t.dialogBefore],
            () => this.showMessages(
              [`${t.name}は ${enemyData.name}を くりだした！`],
              // トレーナーはカプセルを投げながら右へフェードアウトする
              () => { this.drawTrainerPips(); this.throwCapsuleAndReveal(sendOutPlayer); }
            )
          );
        });
      } else {
        this.showMessages([`やせいの ${enemyData.name} が あらわれた！`], sendOutPlayer);
      }
    });
  }

  // ---- Trainer battle portrait (intro / victory) ----
  private trainerPortraitKey(): string {
    const k = this.trainerData?.battleSprite;
    if (k && this.textures.exists(k)) return k;
    return this.textures.exists("cast-char0-down") ? "cast-char0-down" : "player-frame-0";
  }

  private showTrainerPortrait(onDone?: () => void): void {
    const y = Math.round((this.EPLAT_Y + 8) * this.sy);
    const key = this.trainerPortraitKey();
    if (!this.trainerPortrait) {
      this.trainerPortrait = this.add.image(720, y, key).setOrigin(0.5, 1).setDepth(6);
    }
    this.trainerPortrait.setTexture(key);
    const h = this.trainerPortrait.height || 32;
    this.trainerPortrait.setScale((122 * this.sy) / h);   // trainer portrait size
    this.trainerPortrait.setVisible(true).setAlpha(1).setPosition(720, y);
    // hide the enemy monster's status panel while the trainer stands in
    this.enemyInfoObjects.forEach(o => (o as Phaser.GameObjects.Image).setVisible(false));
    this.tweens.add({ targets: this.trainerPortrait, x: this.EPLAT_X, duration: 350, ease: "Cubic.out",
      onComplete: () => onDone && onDone() });
  }

  private hideTrainerPortrait(onDone?: () => void): void {
    if (!this.trainerPortrait) { onDone && onDone(); return; }
    this.tweens.add({ targets: this.trainerPortrait, x: 740, duration: 300, ease: "Cubic.in",
      onComplete: () => {
        this.trainerPortrait!.setVisible(false);
        this.enemyInfoObjects.forEach(o => (o as Phaser.GameObjects.Image).setVisible(true));
        onDone && onDone();
      } });
  }

  private genPipTextures(): void {
    if (this.textures.exists("pip-on")) return;
    const mk = (key: string, on: boolean) => {
      const c = document.createElement("canvas"); c.width = 16; c.height = 16;
      const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = on ? "#e8edf3" : "#39404e";
      ctx.beginPath(); ctx.arc(8, 8, 6, 0, Math.PI * 2); ctx.fill();
      if (on) {
        ctx.fillStyle = "#2b3a63";
        ctx.beginPath(); ctx.arc(8, 8, 6, Math.PI, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#f4c95a"; ctx.beginPath(); ctx.arc(6, 5, 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = on ? "#8a94a8" : "#525a68"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(8, 8, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = on ? "#30384a" : "#464e5c";
      ctx.beginPath(); ctx.moveTo(2.5, 8); ctx.lineTo(13.5, 8); ctx.stroke();
      this.textures.addCanvas(key, c);
    };
    mk("pip-on", true); mk("pip-off", false);
  }

  /** トレーナーの残り手持ち数を、敵ステータス枠の下にボールで並べて表示。 */
  private drawTrainerPips(): void {
    if (!this.trainerData) return;
    this.genPipTextures();
    this.trainerPips.forEach(o => o.destroy());
    this.trainerPips = [];
    const total = this.trainerData.party.length;
    const s = this.sy;
    const startX = 26, y = Math.round(86 * s);
    for (let i = 0; i < total; i++) {
      const on = i < this.trainerRemaining;
      const img = this.add.image(startX + i * 20, y, on ? "pip-on" : "pip-off")
        .setDepth(22).setScrollFactor(0).setScale(s * 0.9);
      this.trainerPips.push(img);
    }
  }

  private genCapsuleTexture(): void {
    if (this.textures.exists("capsule-moon")) return;
    const c = document.createElement("canvas"); c.width = 24; c.height = 24;
    const ctx = c.getContext("2d")!; ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#e8edf3"; ctx.beginPath(); ctx.arc(12, 12, 10, 0, Math.PI * 2); ctx.fill();     // sphere
    ctx.fillStyle = "#2b3a63"; ctx.beginPath(); ctx.arc(12, 12, 10, Math.PI, Math.PI * 2); ctx.fill(); // top navy
    ctx.fillStyle = "#f4c95a"; ctx.beginPath(); ctx.arc(9, 7, 4, 0, Math.PI * 2); ctx.fill();          // crescent
    ctx.fillStyle = "#2b3a63"; ctx.beginPath(); ctx.arc(11, 6, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#8a94a8"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(2, 12); ctx.lineTo(22, 12); ctx.stroke();
    ctx.fillStyle = "#cfd6e2"; ctx.beginPath(); ctx.arc(12, 12, 3, 0, Math.PI * 2); ctx.fill();        // button
    ctx.strokeStyle = "#30384a"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(12, 12, 10, 0, Math.PI * 2); ctx.stroke();
    this.textures.addCanvas("capsule-moon", c);
  }

  /** カプセルが弾けた瞬間の光の輪と星くず。 */
  private burstFx(x: number, y: number): void {
    const sy = this.sy;
    const flash = this.add.circle(x, y, 8 * sy, 0xffffff).setDepth(7);
    this.tweens.add({ targets: flash, scale: 6, alpha: 0, duration: 320, ease: "Cubic.out",
      onComplete: () => flash.destroy() });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      const star = this.add.circle(x, y, (i % 2 ? 2.4 : 3.4) * sy, i % 2 ? 0xfff2b0 : 0xffffff).setDepth(8);
      this.tweens.add({
        targets: star, x: x + Math.cos(a) * 52 * sy, y: y + Math.sin(a) * 40 * sy - 10 * sy,
        alpha: 0, scale: 0.3, duration: 420, ease: "Cubic.out", onComplete: () => star.destroy(),
      });
    }
  }

  /** カプセルを (fromX,fromY)→(toX,toY) へ放物線で投げ、弾けたら onBurst。 */
  private throwCapsuleArc(
    fromX: number, fromY: number, toX: number, toY: number,
    onBurst: () => void, delay = 0
  ): void {
    this.genCapsuleTexture();
    const sy = this.sy;
    const cap = this.add.image(fromX, fromY, "capsule-moon")
      .setDepth(8).setScale(sy * 1.1).setVisible(delay === 0);
    const o = { t: 0 };
    this.tweens.add({
      targets: o, t: 1, duration: 480, delay, ease: "Sine.in",
      onStart: () => cap.setVisible(true),
      onUpdate: () => {
        cap.x = fromX + (toX - fromX) * o.t;
        cap.y = (fromY + (toY - fromY) * o.t) - Math.sin(o.t * Math.PI) * 70 * sy;
        cap.rotation += 0.35;
      },
      onComplete: () => { cap.destroy(); this.burstFx(toX, toY); onBurst(); },
    });
  }

  /** カプセルの弾けた点からスプライトをぽんっと登場させる。 */
  private popInSprite(sprite: Phaser.GameObjects.Image, onDone?: () => void): void {
    const s = sprite.scaleX;
    sprite.setVisible(true).setAlpha(1).setScale(s * 0.1);
    this.tweens.add({ targets: sprite, scaleX: s, scaleY: s, duration: 260, ease: "Back.out",
      onComplete: () => onDone && onDone() });
  }

  /**
   * 画面外（自分側は左・相手側は右）からカプセルが飛んできて弾け、
   * スプライトが登場する。交代や2体目以降のくりだしで使う共通演出。
   */
  private capsuleRevealSprite(
    sprite: Phaser.GameObjects.Image, isPlayer: boolean, onDone?: () => void
  ): void {
    // A still-running faint tween would keep squashing the reused sprite.
    this.tweens.killTweensOf(sprite);
    sprite.clearTint();
    sprite.setVisible(false);
    const fromX = isPlayer ? -24 : 664;
    const fromY = sprite.y - 90 * this.sy;
    this.throwCapsuleArc(fromX, fromY, sprite.x, sprite.y + sprite.displayHeight * 0.2,
      () => this.popInSprite(sprite, onDone));
  }

  /** モンスターをカプセルに回収する（光って縮んで消える）。 */
  private recallSprite(sprite: Phaser.GameObjects.Image, onDone: () => void): void {
    this.tweens.killTweensOf(sprite);
    const glow = this.add.circle(sprite.x, sprite.y, 10 * this.sy, 0xffd7d0, 0.9).setDepth(7);
    this.tweens.add({ targets: glow, scale: 4, alpha: 0, duration: 300, ease: "Cubic.out",
      onComplete: () => glow.destroy() });
    this.tweens.add({
      targets: sprite, scaleX: sprite.scaleX * 0.05, scaleY: sprite.scaleY * 0.05, alpha: 0,
      duration: 240, ease: "Cubic.in",
      onComplete: () => { sprite.setVisible(false); onDone(); },
    });
  }

  /**
   * ひんし演出: 赤く点滅→くずれ落ちて消え、足もとに砂ぼこりが舞う。
   * scale/y を崩すので、次に使う側は sizeMonsterSprite と位置リセットを通すこと。
   */
  private playFaintFx(sprite: Phaser.GameObjects.Image): void {
    const sy = this.sy;
    const baseY = sprite.y + sprite.displayHeight * 0.35;
    sprite.setTint(0xff7a7a);
    this.time.delayedCall(130, () => sprite.clearTint());
    this.cameras.main.shake(140, 0.004);
    this.tweens.add({
      targets: sprite, y: sprite.y + sprite.displayHeight * 0.45,
      scaleY: sprite.scaleY * 0.25, alpha: 0,
      duration: 430, delay: 140, ease: "Cubic.in",
      onComplete: () => sprite.setVisible(false),
    });
    this.time.delayedCall(320, () => {
      for (let i = 0; i < 5; i++) {
        const px = sprite.x + (i - 2) * 14 * sy;
        const p = this.add.circle(px, baseY, (5 + (i % 3) * 2) * sy, 0xd8d2c4, 0.85).setDepth(7);
        this.tweens.add({
          targets: p, y: baseY - (18 + (i % 2) * 10) * sy, scale: 1.8, alpha: 0,
          duration: 480, ease: "Cubic.out", onComplete: () => p.destroy(),
        });
      }
    });
  }

  /**
   * Trainer tosses a moon-capsule and the almon appears. The trainer slides
   * off to the RIGHT edge (fading out) WHILE the capsule is in the air.
   */
  private throwCapsuleAndReveal(onDone: () => void): void {
    const sy = this.sy;
    const startX = (this.trainerPortrait?.x ?? this.EPLAT_X) - 22 * sy;
    const startY = this.trainerPortrait
      ? this.trainerPortrait.y - this.trainerPortrait.displayHeight * 0.55
      : Math.round(this.EPLAT_Y * sy);
    const endX = this.EPLAT_X;
    const endY = Math.round((this.EPLAT_Y + 2) * sy);
    const tp = this.trainerPortrait;
    if (tp && tp.visible) {
      this.tweens.add({
        targets: tp, x: tp.x + 130, alpha: 0, duration: 520, ease: "Cubic.in",
        onComplete: () => { tp.setVisible(false); tp.setAlpha(1); },
      });
    }
    this.throwCapsuleArc(startX, startY, endX, endY, () => {
      this.cameras.main.flash(160, 200, 240, 255);
      this.enemyInfoObjects.forEach(x => (x as Phaser.GameObjects.Image).setVisible(true));
      this.popInSprite(this.enemySprite, onDone);
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
    drawPlat(this.EPLAT_X, this.EPLAT_Y, 182, 46);
    drawPlat(this.PPLAT_X, this.PPLAT_Y, 211, 55);
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
    // Trainer battles reveal the enemy only after the capsule is thrown.
    if (this.trainerData) this.enemySprite.setVisible(false);
    // The player's almon is sent out after the hero throws a capsule; until then
    // show the hero's back illustration (both wild and trainer battles).
    if (this.textures.exists(this.playerBackKey())) {
      this.playerSprite.setVisible(false);
      this.showPlayerBack();
    }
  }

  /** Battle back-illustration key, chosen by the player's saved gender. */
  private playerBackKey(): string {
    let girl = false;
    try {
      girl = JSON.parse(localStorage.getItem("usamon-player-setup") || "{}").gender === "girl";
    } catch { /* ignore */ }
    return girl && this.textures.exists("player-back-girl") ? "player-back-girl" : "player-back";
  }

  private showPlayerBack(): void {
    const y = Math.round((this.PPLAT_Y + 12) * this.sy);
    if (!this.playerBackPortrait) {
      this.playerBackPortrait = this.add.image(this.PPLAT_X, y, this.playerBackKey()).setOrigin(0.5, 1).setDepth(6);
    }
    const h = this.playerBackPortrait.height || 32;
    this.playerBackPortrait.setScale((148 * this.sy) / h);
    this.playerBackPortrait.setVisible(true).setAlpha(1).setPosition(this.PPLAT_X, y);
  }

  /** Hero throws a moon-capsule; it bursts and the player's almon appears. */
  private throwPlayerCapsuleAndReveal(onDone: () => void): void {
    const bp = this.playerBackPortrait;
    if (!bp) { this.playerSprite.setVisible(true); onDone(); return; }
    this.genCapsuleTexture();
    const sy = this.sy;
    // Capsule launches from the hero's hand (captured before the recoil) and
    // flies FORWARD (toward the platform where the almon appears)...
    const startX = bp.x + 16 * sy;
    const startY = bp.y - bp.displayHeight * 0.5;
    const endX = this.PPLAT_X;
    const endY = Math.round((this.PPLAT_Y + 6) * sy);
    // ...while the hero steps BACKWARD (down-left) as they throw.
    this.tweens.add({
      targets: bp, x: bp.x - 72 * sy, y: bp.y + 20 * sy, duration: 430, ease: "Sine.out",
    });
    this.throwCapsuleArc(startX, startY, endX, endY, () => {
      // Hero has already stepped back; now fade the back-view out.
      this.tweens.add({ targets: bp, alpha: 0, duration: 260, ease: "Cubic.in",
        onComplete: () => bp.setVisible(false) });
      this.playerInfoObjects.forEach(x => (x as Phaser.GameObjects.Image).setVisible(true));
      this.popInSprite(this.playerSprite, onDone);
    });
  }

  // The player's own monster shows its back sprite (RSE-style) when available,
  // otherwise falls back to the front sprite.
  private playerTexKey(id: string): string {
    const back = `monster-${id}-back`;
    return this.textures.exists(back) ? back : `monster-${id}`;
  }

  // Scale a monster sprite to fit within a target box (design units, ×sy),
  // preserving aspect so both wide and tall monsters read at a similar size.
  // Per-species battle-size tweak (multiplies the fit-to-box scale). Used when a
  // monster should read smaller/larger than its raw art implies.
  private static MONSTER_SCALE: Record<string, number> = {
    usamon: 0.77,
    mochichi: 0.5,
    mochigori: 1.265,
    gorimocchi: 1.38,
    sunagani: 0.6,
    lobsner: 0.9,
    rairai: 0.5,
    ikarion: 0.85,
    regonyas: 0.63,
    sharisu: 0.95,
    sharian: 1.1,
    meteko: 0.54,
    meteodon: 1.2,
    roubau: 0.6,
    shakurin: 0.5,
    shakuruton: 1.3,
    hotaruna: 0.5,
    genbu: 0.5,
    hidaneko: 0.6,
    kagario: 0.945,
    solpoka: 0.55,
    fureado: 1.15,
    prominence: 1.3,
  };

  // Extra multiplier applied ONLY to the back-view (the player's own monster).
  private static MONSTER_SCALE_BACK: Record<string, number> = {
    prominence: 0.9,
  };

  // Species that hover above their platform (design px, scaled by sy).
  private static MONSTER_LIFT: Record<string, number> = {
    meteko: 14,
    hotaruna: 12,
  };

  private sizeMonsterSprite(sprite: Phaser.GameObjects.Image, maxW: number, maxH: number): void {
    const w = sprite.width || 64;
    const h = sprite.height || 64;
    let scale = Math.min((maxW * this.sy) / w, (maxH * this.sy) / h);
    // Derive the species id from the texture key ("monster-<id>" / "monster-<id>-back").
    const isBack = sprite.texture.key.endsWith("-back");
    const id = sprite.texture.key.replace(/^monster-/, "").replace(/-back$/, "");
    scale *= BattleScene.MONSTER_SCALE[id] ?? 1;
    if (isBack) scale *= BattleScene.MONSTER_SCALE_BACK[id] ?? 1;
    sprite.setScale(scale);
    // Apply a hover offset for floating species (baseline captured once, so
    // repeated re-sizes don't compound the lift).
    if (sprite.getData("groundY") === undefined) sprite.setData("groundY", sprite.y);
    const lift = (BattleScene.MONSTER_LIFT[id] ?? 0) * this.sy;
    sprite.y = (sprite.getData("groundY") as number) - lift;
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
  private drawStatusPanel(r: { x: number; y: number; w: number; h: number }): Phaser.GameObjects.Graphics {
    const g = this.add.graphics().setDepth(9);
    g.fillStyle(0x101018, 0.30);
    g.fillRoundedRect(r.x + 3, r.y + 4, r.w, r.h, 11);      // drop shadow
    g.fillStyle(0xf3efe0, 0.98);
    g.fillRoundedRect(r.x, r.y, r.w, r.h, 11);              // light panel
    g.lineStyle(3, 0x46688f, 1);
    g.strokeRoundedRect(r.x, r.y, r.w, r.h, 11);            // blue frame
    g.lineStyle(1, 0xd6d0bc, 1);
    g.strokeRoundedRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 8); // inner line
    return g;
  }

  // Small "HP"/"EXP" label tag drawn on the light panel.
  private drawTag(x: number, y: number, label: string, color: string): Phaser.GameObjects.Text {
    return this.add.text(x, y, label, {
      fontSize: "15px", color, fontFamily: "'DotGothic16', monospace", fontStyle: "bold",
    }).setOrigin(0, 0.5).setDepth(11);
  }

  private drawHpBars(): void {
    const F = "'DotGothic16', monospace";
    const NAME = "#2b3346", LV = "#3a4256", HPTAG = "#c24a30", EXPTAG = "#2f6ab0";
    // ===== Enemy status panel (upper-left) =====
    const eb = this.enemyBoxRect();
    const ePanel = this.drawStatusPanel(eb);
    this.enemyNameText = this.add
      .text(eb.x + 16, eb.y + Math.round(7 * this.sy), `${this.enemyMon.name}`, {
        fontSize: "20px", color: NAME, fontFamily: F, fontStyle: "bold",
      }).setDepth(11);
    this.enemyLvText = this.add.text(eb.x + eb.w - 14, eb.y + Math.round(8 * this.sy), `Lv${this.enemyMon.level}`, {
      fontSize: "18px", color: LV, fontFamily: F, fontStyle: "bold",
    }).setOrigin(1, 0).setDepth(11);
    const eg = this.hpGeom(false);
    const eTag = this.drawTag(eb.x + 16, eg.y, "HP", HPTAG);
    this.enemyHpBar = this.add.graphics().setDepth(11);
    this.drawHpBarGraphic(this.enemyHpBar, eg.x, eg.y - eg.h / 2, eg.w, eg.h, this.enemyMon.currentHp / this.enemyMon.maxHp);
    // enemy HP numbers are hidden (RSE-style); keep the object to avoid null refs
    this.enemyHpText = this.add.text(0, 0, "", { fontSize: "1px" }).setVisible(false).setDepth(11);
    // Group the enemy status UI so it can be hidden while the trainer portrait shows.
    this.enemyInfoObjects = [ePanel, this.enemyNameText, this.enemyLvText, eTag, this.enemyHpBar];

    // ===== Player status panel (lower-right) =====
    const pb = this.playerBoxRect();
    const pPanel = this.drawStatusPanel(pb);
    this.playerNameText = this.add
      .text(pb.x + 16, pb.y + Math.round(9 * this.sy), `${this.playerMon.name}`, {
        fontSize: "20px", color: NAME, fontFamily: F, fontStyle: "bold",
      }).setDepth(11);
    this.playerLvText = this.add.text(pb.x + pb.w - 14, pb.y + Math.round(10 * this.sy), `Lv${this.playerMon.level}`, {
      fontSize: "18px", color: LV, fontFamily: F, fontStyle: "bold",
    }).setOrigin(1, 0).setDepth(11);
    const pg = this.hpGeom(true);
    const pTag = this.drawTag(pb.x + 16, pg.y, "HP", HPTAG);
    this.playerHpBar = this.add.graphics().setDepth(11);
    this.drawHpBarGraphic(this.playerHpBar, pg.x, pg.y - pg.h / 2, pg.w, pg.h, this.playerMon.currentHp / this.playerMon.maxHp);
    this.playerHpText = this.add
      .text(pb.x + pb.w - 14, pg.y + Math.round(9 * this.sy), `${this.playerMon.currentHp}/${this.playerMon.maxHp}`, {
        fontSize: "20px", color: NAME, fontFamily: F, fontStyle: "bold",
      }).setOrigin(1, 0).setDepth(11);
    // EXP bar (player only)
    const xg = this.expGeom();
    const xTag = this.drawTag(pb.x + 16, xg.y, "EXP", EXPTAG);
    this.playerExpBar = this.add.graphics().setDepth(11);
    this.refreshPlayerExp();
    // Group so the panel can be hidden until the hero sends out the almon.
    this.playerInfoObjects = [pPanel, this.playerNameText, this.playerLvText, pTag,
      this.playerHpBar, this.playerHpText, xTag, this.playerExpBar];
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
        fontSize: "22px",
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
          fontSize: "24px",
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
    // どうぐ／こうたい画面などでコマンドスロットを破棄した後に戻ってきた場合、
    // スロットが空だとコマンド枠が表示されない（＝空の枠）ので作り直す。
    if (this.commandSlots.length === 0) this.drawCommandWindow();
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
          fontSize: "24px",
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
      // 送り出しは各メッセージが持つ単一のポーリングに任せる。ここで
      // processMessageQueue を直接呼ぶと二重送り（連打でメッセージや
      // コールバック＝経験値取得などのスキップ）が起きるため false のみ。
      if (this.waitingForInput) this.waitingForInput = false;
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
      // false にするだけ（送り出しは単一ポーリングが担当）。二重送りで
      // 経験値などのコールバックがスキップされるのを防ぐ。
      this.waitingForInput = false;
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
          if (this.isDouble) this.chooseMoveD(move);
          else this.executeTurn(move);
        }
      }
      if (kbEsc || gpB) {
        this.hideMoveSelect();
        this.phase = "command";
        this.showCommandWindow();
        if (this.isDouble) this.setCommandPromptD();
        else this.setMessage("");
      }
    } else if (this.phase === "target_select") {
      // Double battle: pick which enemy to hit (left/right toggles).
      if ((justLeft || justRight || justUp || justDown) && this.isDouble) {
        const alive = this.dAliveSlots(this.dE);
        if (alive.length > 1) {
          this.dTargetIdx = alive.find(i => i !== this.dTargetIdx) ?? this.dTargetIdx;
          this.placeTargetMarkerD();
        }
      }
      if (confirm && this.dPendingMove) {
        this.lockActionD(this.dPendingMove, this.dTargetIdx, "e");
      } else if (kbEsc || gpB) {
        this.destroyTargetMarkerD();
        this.dPendingMove = null;
        this.showMoveSelect();
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
    } else if (this.phase === "item_select") {
      // Bag selection (2-column grid of usable items + もどる).
      const maxSlots = Math.min(this.commandSlots.length, 6);
      if (justUp && this.selectedCommand >= 2) { this.selectedCommand -= 2; this.highlightLearnSlots(this.selectedCommand); }
      if (justDown && this.selectedCommand + 2 < maxSlots) { this.selectedCommand += 2; this.highlightLearnSlots(this.selectedCommand); }
      if (justLeft && this.selectedCommand % 2 === 1) { this.selectedCommand -= 1; this.highlightLearnSlots(this.selectedCommand); }
      if (justRight && this.selectedCommand % 2 === 0 && this.selectedCommand + 1 < maxSlots) { this.selectedCommand += 1; this.highlightLearnSlots(this.selectedCommand); }
      if (confirm) {
        this.chooseBattleItem(this.selectedCommand);
      } else if (kbEsc || gpB) {
        this.chooseBattleItem(this.battleItems().length);   // もどる
      }
    } else if (this.phase === "switch_mon") {
      // Party-switch selection (2-column grid of alive members + もどる).
      const activeInsts = this.isDouble
        ? this.dAliveSlots(this.dP).map(i => this.dP[i]!.inst)
        : [this.playerInstance];
      const aliveParty = this.playerState.party.filter(
        (m) => m.currentHp > 0 && !activeInsts.includes(m)
      );
      const maxSlots = Math.min(this.commandSlots.length, 6);
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
        if (this.selectedCommand === aliveParty.length) {
          // もどる: back to the command window
          this.commandSlots.forEach(s => { s.bg.destroy(); s.text.destroy(); s.zone.destroy(); });
          this.commandSlots = [];
          this.rebuildCommandWindow();
          this.phase = "command";
          this.showCommandWindow();
          if (this.isDouble) this.setCommandPromptD();
        } else if (aliveParty[this.selectedCommand]) {
          if (this.isDouble) this.doSwitchD(aliveParty[this.selectedCommand]);
          else this.doSwitch(aliveParty[this.selectedCommand]);
        }
      } else if (kbEsc || gpB) {
        this.commandSlots.forEach(s => { s.bg.destroy(); s.text.destroy(); s.zone.destroy(); });
        this.commandSlots = [];
        this.rebuildCommandWindow();
        this.phase = "command";
        this.showCommandWindow();
        if (this.isDouble) this.setCommandPromptD();
      }
    }
  }

  // ---- Commands ----

  private executeCommand(index: number): void {
    if (this.isDouble) { this.executeCommandD(index); return; }
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
    const pages = this.paginateBattleText(texts);
    this.messageQueue = pages.map((text, i) => ({
      text,
      callback: i === pages.length - 1 ? onAllDone : undefined,
    }));
    this.isShowingMessage = true;
    this.processMessageQueue();
  }

  private measureCtx?: CanvasRenderingContext2D;
  /** 文字単位で折り返す（日本語はスペースが無く 標準ラップが効かない）。 */
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

  /** メッセージ枠に収まらない長い文章を、収まる行数ごとのページに分割する。 */
  private paginateBattleText(texts: string[]): string[] {
    const maxLines = 3;
    const maxW = 600;   // msgText の wordWrap 幅
    const out: string[] = [];
    for (const t of texts) {
      const lines = this.wrapCJK(t, maxW, 22);
      for (let i = 0; i < lines.length; i += maxLines) {
        out.push(lines.slice(i, i + maxLines).join("\n"));
      }
    }
    return out.length ? out : texts;
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
      this.playFaintFx(this.enemySprite);
      if (this.trainerData) { this.trainerRemaining = Math.max(0, this.trainerRemaining - 1); this.drawTrainerPips(); }
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
      // Active monster fainted. Only black out when the WHOLE party is down;
      // otherwise send out the next healthy party member.
      this.phase = "defeat";
      this.playerInstance.currentHp = 0;
      this.playFaintFx(this.playerSprite);
      const faintedData = this.allMonsters.find((m) => m.id === this.playerInstance.dataId)!;
      const hasAlive = this.playerState.party.some((m) => m.currentHp > 0);
      if (hasAlive) {
        this.showMessages([`${faintedData.name}は たおれた！`], () => {
          this.playerSendNext();
        });
      } else {
        this.showMessages(
          [`${faintedData.name}は たおれた！`, "めのまえが まっくらになった…"],
          () => {
            this.time.delayedCall(1500, () => this.endBattleDefeat());
          }
        );
      }
    }
  }

  // ---- Player: send out next healthy monster after a faint ----

  private playerSendNext(): void {
    const next = this.playerState.party.find((m) => m.currentHp > 0);
    if (!next) {
      this.endBattleDefeat();
      return;
    }
    this.playerInstance = next;
    this.playerMon = this.instanceToBattleMonster(this.playerInstance);

    const playerData = this.allMonsters.find((m) => m.id === this.playerInstance.dataId)!;
    this.playerSprite.setTexture(this.playerTexKey(playerData.id));
    this.playerSprite.setData("groundY", Math.round((this.PPLAT_Y + 8) * this.sy));
    this.sizeMonsterSprite(this.playerSprite, 128, 132);
    this.playerSprite.setAlpha(1).setVisible(false);
    this.playerSprite.setY(Math.round((this.PPLAT_Y + 8) * this.sy));
    this.playerNameText.setText(`${playerData.name}`);
    this.playerLvText.setText(`Lv${this.playerMon.level}`);
    this.refreshPlayerHp();

    this.showMessages([`ゆけっ！ ${this.playerMon.name}！`], () => {
      this.capsuleRevealSprite(this.playerSprite, true, () => {
        this.phase = "command";
        this.showCommandWindow();
      });
    });
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
          fontSize: "20px",
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
    // Record the evolution but DON'T play it here — it runs after the battle
    // ends, on a clean screen (EvolutionScene). This keeps the battle UI from
    // overlapping the evolution cutscene.
    const evoResult = checkEvolution(this.playerInstance, this.allMonsters);
    if (evoResult) {
      const idx = this.playerState.party.indexOf(this.playerInstance);
      if (idx >= 0) {
        this.pendingEvolutions.push({
          partyIndex: idx,
          fromId: this.playerInstance.dataId,
          toId: evoResult.evolvesTo,
        });
      }
    }
    if (this.afterExpCallback) {
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

  // バトルで つかえる どうぐ（カプセル＝捕獲／リカバリー＝回復）の一覧を作る。
  private battleItems(): { id: string; name: string; count: number; category: string }[] {
    const defs = (this.cache.json.get("items") || []) as { id: string; name: string; category?: string }[];
    const out: { id: string; name: string; count: number; category: string }[] = [];
    for (const it of this.playerState.items) {
      const def = defs.find(d => d.id === it.id);
      const cat = def?.category;
      if ((cat === "capsule" || cat === "recovery") && it.count > 0) {
        out.push({ id: it.id, name: def!.name, count: it.count, category: cat });
      }
    }
    return out;
  }

  // 「どうぐ」→ 道具一覧を ひらく（カプセル・回復アイテムから選ぶ）。
  private handleItemUse(): void {
    this.hideCommandWindow();
    const items = this.battleItems();
    if (items.length === 0) {
      this.showMessages(["つかえる どうぐを もっていない！"], () => {
        this.phase = "command";
        this.showCommandWindow();
      });
      return;
    }
    this.commandSlots.forEach(s => { s.bg.destroy(); s.text.destroy(); s.zone.destroy(); });
    this.commandSlots = [];
    const positions = [
      { x: 160, y: Math.round(360 * this.sy) }, { x: 480, y: Math.round(360 * this.sy) },
      { x: 160, y: Math.round(405 * this.sy) }, { x: 480, y: Math.round(405 * this.sy) },
      { x: 160, y: Math.round(450 * this.sy) }, { x: 480, y: Math.round(450 * this.sy) },
    ];
    const labels = [...items.map(it => `${it.name} ×${it.count}`), "もどる"];
    this.phase = "item_select";
    this.selectedCommand = 0;
    for (let i = 0; i < labels.length; i++) {
      const px = positions[i % positions.length].x;
      const py = positions[i % positions.length].y;
      const bg = this.add.graphics().setDepth(20);
      const text = this.add.text(px, py, labels[i], {
        fontSize: "18px", color: "#ffffff", fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 3,
      }).setOrigin(0.5).setDepth(21);
      const zone = this.add.zone(px, py, 290, 40).setInteractive().setDepth(22).setOrigin(0.5);
      const idx = i;
      zone.on("pointerdown", () => this.chooseBattleItem(idx));
      this.commandSlots.push({ label: labels[i], x: px, y: py, bg, text, zone });
    }
    this.highlightLearnSlots(0);
    this.setMessage("どの どうぐを つかう？");
  }

  private chooseBattleItem(idx: number): void {
    const items = this.battleItems();
    const backToCmd = () => {
      this.commandSlots.forEach(s => { s.bg.destroy(); s.text.destroy(); s.zone.destroy(); });
      this.commandSlots = [];
      this.rebuildCommandWindow();
      this.phase = "command";
      this.showCommandWindow();
    };
    if (idx >= items.length) { backToCmd(); return; }   // もどる
    const sel = items[idx];
    this.commandSlots.forEach(s => { s.bg.destroy(); s.text.destroy(); s.zone.destroy(); });
    this.commandSlots = [];
    if (sel.category === "capsule") {
      if (!this.isWild) {
        this.phase = "executing";
        this.showMessages(["トレーナーの アルモンには\nカプセルを つかえない！"], () => this.handleItemUse());
        return;
      }
      this.throwCaptureCapsule(sel.id, sel.name);
    } else {
      this.useRecoveryItem(sel.id, sel.name);
    }
  }

  /** 回復アイテムを つかう（ターンを消費して敵が こうげき）。 */
  private useRecoveryItem(itemId: string, itemName: string): void {
    this.phase = "executing";
    let ok = false, msg = "";
    if (itemId === "revive_star") {
      const fainted = this.playerState.party.find(m => m.currentHp <= 0);
      if (!fainted) { msg = "ひんしの アルモンが いない！"; }
      else {
        fainted.currentHp = Math.max(1, Math.floor(fainted.maxHp / 2));
        const nm = this.allMonsters.find(md => md.id === fainted.dataId)?.name ?? fainted.dataId;
        ok = true; msg = `${nm}は げんきを とりもどした！`;
      }
    } else {
      const mon = this.playerMon;
      if (mon.currentHp >= mon.maxHp) { msg = "HPは まんたんだ！"; }
      else {
        const amount = itemId === "repair_gel" ? 20 : itemId === "hi_repair_gel" ? 50
          : itemId === "moon_honey" ? 40 : mon.maxHp;
        const before = mon.currentHp;
        mon.currentHp = Math.min(mon.maxHp, mon.currentHp + amount);
        this.playerInstance.currentHp = mon.currentHp;
        ok = true; msg = `${this.playerMon.name}の HPが\n${mon.currentHp - before} かいふくした！`;
        this.refreshPlayerHp();
      }
    }
    if (!ok) {
      // むだ打ちしない: 一覧に もどる
      this.showMessages([msg], () => this.handleItemUse());
      return;
    }
    this.consumeBattleItem(itemId);
    this.showMessages([`${itemName}を つかった！`, msg], () => {
      // アイテム使用は 1ターン消費 → 敵の こうげき
      const enemyMove = this.enemyMon.moves[Math.floor(Math.random() * this.enemyMon.moves.length)];
      this.executeAction(this.enemyMon, enemyMove, this.playerMon, this.playerSprite, () => {
        if (this.playerMon.currentHp <= 0) this.checkBattleEnd();
        else { this.phase = "command"; this.showCommandWindow(); }
      });
    });
  }

  private consumeBattleItem(itemId: string): void {
    const e = this.playerState.items.find(i => i.id === itemId);
    if (e) { e.count--; if (e.count <= 0) this.playerState.items = this.playerState.items.filter(i => i.count > 0); }
  }

  /**
   * カプセルを投げてアルモンを吸い込み、ゆれてから 成功/失敗する演出つき捕獲。
   * star_capsule は 捕まえやすい（成功率＋）。
   */
  private throwCaptureCapsule(itemId: string, itemName: string): void {
    this.phase = "executing";
    this.consumeBattleItem(itemId);
    this.genCapsuleTexture();
    const sy = this.sy;
    const enemyData = this.allMonsters.find(m => m.id === this.enemyInstance.dataId)!;

    // 捕獲判定（スターカプセルは成功率1.5倍）。
    const base = calculateCaptureRate(this.enemyMon.currentHp, this.enemyMon.maxHp);
    const rate = Math.min(0.95, base * (itemId === "star_capsule" ? 1.5 : 1));
    const roll = Math.random();
    const success = roll < rate;
    const shakes = success ? 3 : roll < rate * 1.4 ? 2 : roll < rate * 2 ? 1 : 0;

    const ex = this.enemySprite.x, ey = this.enemySprite.y;
    const restY = ey;                                  // 吸い込み後カプセルが置かれる床
    const fromX = -20, fromY = ey - 120 * sy;

    this.setMessage(`${itemName}を なげた！`);
    // 捕獲演出のあいだは両方の情報枠を隠し（カプセルの軌道・着地と重なるのを
    // 防ぐ）、カプセルと敵スプライトを情報枠（depth 11）より前面に出す。
    this.enemyInfoObjects.forEach(o => (o as Phaser.GameObjects.Image).setVisible(false));
    this.playerInfoObjects.forEach(o => (o as Phaser.GameObjects.Image).setVisible(false));
    this.enemySprite.setDepth(12);
    const cap = this.add.image(fromX, fromY, "capsule-moon").setDepth(12).setScale(sy * 1.1);
    const o = { t: 0 };
    this.tweens.add({
      targets: o, t: 1, duration: 460, ease: "Sine.in",
      onUpdate: () => {
        cap.x = fromX + (ex - fromX) * o.t;
        cap.y = (fromY + (ey - fromY) * o.t) - Math.sin(o.t * Math.PI) * 80 * sy;
        cap.rotation += 0.3;
      },
      onComplete: () => {
        this.burstFx(ex, ey);
        this.cameras.main.flash(120, 200, 230, 255);
        // アルモンを カプセルに 吸い込む（縮んで消える）
        this.tweens.add({
          targets: this.enemySprite, x: ex, y: ey, scaleX: this.enemySprite.scaleX * 0.05,
          scaleY: this.enemySprite.scaleY * 0.05, alpha: 0, duration: 260, ease: "Cubic.in",
          onComplete: () => {
            this.enemySprite.setVisible(false);
            cap.setPosition(ex, ey - 4 * sy);
            // 床に すとん
            this.tweens.add({ targets: cap, y: restY, duration: 180, ease: "Bounce.out",
              onComplete: () => this.captureShake(cap, shakes, success, enemyData, itemName) });
          },
        });
      },
    });
  }

  /** カプセルが shakes 回 ゆれて、成功なら固定、失敗ならアルモンが出てくる。 */
  private captureShake(
    cap: Phaser.GameObjects.Image, shakes: number, success: boolean,
    enemyData: MonsterData, _itemName: string
  ): void {
    const doShake = (n: number, done: () => void) => {
      if (n <= 0) { done(); return; }
      this.time.delayedCall(260, () => {
        this.tweens.add({
          targets: cap, angle: -18, duration: 90, yoyo: true, ease: "Sine.inOut",
          onComplete: () => this.tweens.add({
            targets: cap, angle: 18, duration: 90, yoyo: true, ease: "Sine.inOut",
            onComplete: () => { cap.setAngle(0); doShake(n - 1, done); },
          }),
        });
      });
    };
    doShake(shakes, () => {
      if (success) {
        // カチッ → 星がはじけて 確定
        this.cameras.main.flash(140, 255, 240, 170);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const st = this.add.circle(cap.x, cap.y, 3 * this.sy, 0xfff2b0).setDepth(13);
          this.tweens.add({ targets: st, x: cap.x + Math.cos(a) * 46 * this.sy, y: cap.y + Math.sin(a) * 46 * this.sy,
            alpha: 0, duration: 480, ease: "Cubic.out", onComplete: () => st.destroy() });
        }
        markCaught(this.playerState, this.enemyInstance.dataId);
        this.showMessages([`やった！ ${enemyData.name}を\nつかまえた！`], () => {
          cap.destroy();
          if (this.playerState.party.length < 6) {
            this.playerState.party.push(this.enemyInstance);
            this.showMessages([`${enemyData.name}が なかまに くわわった！`], () => this.endBattle());
          } else {
            this.playerState.box.push(this.enemyInstance);
            this.showMessages([`手持ちが いっぱい！`,
              `${enemyData.name}は あずかりボックスへ おくられた！`], () => this.endBattle());
          }
        });
      } else {
        // カプセルが はじけて アルモンが 出てくる（スケールを元に戻してから）
        this.burstFx(cap.x, cap.y);
        cap.destroy();
        this.enemySprite.setVisible(true).setAlpha(1);
        this.sizeMonsterSprite(this.enemySprite, 110, 116);
        // 逃げられたので両方の情報枠を復帰し、敵スプライトの奥行きも元に戻す。
        this.enemySprite.setDepth(5);
        this.enemyInfoObjects.forEach(o => (o as Phaser.GameObjects.Image).setVisible(true));
        this.playerInfoObjects.forEach(o => (o as Phaser.GameObjects.Image).setVisible(true));
        this.popInSprite(this.enemySprite);
        this.showMessages([`ああっ！ ${enemyData.name}が\nカプセルから でてきちゃった！`], () => {
          const enemyMove = this.enemyMon.moves[Math.floor(Math.random() * this.enemyMon.moves.length)];
          this.executeAction(this.enemyMon, enemyMove, this.playerMon, this.playerSprite, () => {
            if (this.playerMon.currentHp <= 0) this.checkBattleEnd();
            else { this.phase = "command"; this.showCommandWindow(); }
          });
        });
      }
    });
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

    this.phase = "switch_mon";
    this.selectedCommand = 0;

    for (let i = 0; i < options.length; i++) {
      const px = positions[i % positions.length].x;
      const py = positions[i % positions.length].y;
      const bg = this.add.graphics().setDepth(20);
      const text = this.add.text(px, py, options[i], {
        fontSize: "19px", color: "#ffffff", fontFamily: "'DotGothic16', monospace",
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

    const afterSwitch = () => {
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
    };

    // もどれ！（カプセルに回収）→ ゆけっ！（カプセルから登場）
    this.showMessages([`${oldData.name} もどれ！`], () => {
      this.recallSprite(this.playerSprite, () => {
        this.playerInstance = newMon;
        this.playerMon = this.instanceToBattleMonster(this.playerInstance);
        this.playerSprite.setTexture(this.playerTexKey(newMon.dataId));
        // 交代アルモンは必ず接地の基準Yに戻す（前のアルモンのY残りで
        // 沈み込むのを防ぐ。send-next と同じ扱い）。
        const baseY = Math.round((this.PPLAT_Y + 8) * this.sy);
        this.playerSprite.setData("groundY", baseY);
        this.sizeMonsterSprite(this.playerSprite, 128, 132);
        this.playerSprite.setY(baseY);
        this.playerSprite.setAlpha(1).setVisible(false);
        this.playerNameText.setText(`${newData.name}`);
        this.playerLvText.setText(`Lv${newMon.level}`);
        this.refreshPlayerHp();
        this.showMessages([`ゆけっ！ ${newData.name}！`], () => {
          this.capsuleRevealSprite(this.playerSprite, true, afterSwitch);
        });
      });
    });
  }

  // ---- End Battle ----

  private endBattle(): void {
    this.cameras.main.fadeOut(500, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => {
      if (this.pendingEvolutions.length > 0) {
        // Play the deferred evolution(s) on a clean screen, then it returns
        // to the overworld itself.
        this.scene.start("EvolutionScene", {
          evolutions: this.pendingEvolutions,
          playerState: this.playerState,
          mapKey: this.returnMapKey,
          playerX: this.returnPlayerX,
          playerY: this.returnPlayerY,
          trainerDefeated: this.trainerData?.id,
        });
        return;
      }
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
    // Blacked out: revive the whole party and restart at the recovery pod the
    // player last healed at (fallback: the Crater City pod).
    this.playerState.party.forEach(m => { m.currentHp = m.maxHp; });

    this.cameras.main.fadeOut(500, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => {
      this.scene.start("MapScene", {
        mapKey: this.playerState.lastRecoveryMap || "recovery_pod",
        playerState: this.playerState,
      });
    });
  }

  // ---- Trainer: next monster ----

  private trainerSendNext(): void {
    this.trainerPartyIndex++;
    if (!this.trainerData || this.trainerPartyIndex >= this.trainerData.party.length) {
      // Trainer defeated! Show the trainer portrait again with the defeat line.
      const t = this.trainerData!;
      const prize = t.prizeMoneyBase;
      this.playerState.money += prize;
      this.playerState.defeatedTrainers.push(t.id);
      this.enemySprite.setVisible(false);
      this.showTrainerPortrait(() => {
        this.showMessages(
          [t.dialogWin, `${prize}円 もらった！`],
          () => this.hideTrainerPortrait(() => this.handleExpGain())
        );
      });
      return;
    }

    const next = this.trainerData!.party[this.trainerPartyIndex];
    this.enemyInstance = this.createInstance(next.id, next.level);
    this.enemyMon = this.instanceToBattleMonster(this.enemyInstance);

    const enemyData = this.allMonsters.find(m => m.id === next.id)!;
    this.enemySprite.setTexture(`monster-${next.id}`);
    this.sizeMonsterSprite(this.enemySprite, 110, 116);
    this.enemySprite.setAlpha(1).setVisible(false);
    this.enemySprite.setPosition(this.EPLAT_X, Math.round((this.EPLAT_Y + 6) * this.sy));
    // The player's almon stays on the field between the trainer's switches.
    this.playerSprite.setVisible(true).setAlpha(1);
    this.enemyNameText.setText(`${enemyData.name}`);
    this.enemyLvText.setText(`Lv${next.level}`);
    this.refreshEnemyHp();

    this.showMessages(
      [`${this.trainerData!.name}は ${enemyData.name}を くりだした！`],
      () => {
        this.capsuleRevealSprite(this.enemySprite, false, () => {
          this.phase = "command";
          this.showCommandWindow();
        });
      }
    );
  }

  // ================= ダブルバトル (2vs2) =================
  // シングル戦のコードパスには一切手を入れず、doubles トレーナー戦だけが
  // ここを通る。エメラルド式: 敵2体・味方2体・HPパネル4枚・ターゲット選択。

  private dAliveSlots(arr: (DSlot | null)[]): number[] {
    const out: number[] = [];
    arr.forEach((s, i) => { if (s && s.mon.currentHp > 0) out.push(i); });
    return out;
  }

  private dMonName(inst: MonsterInstance): string {
    return this.allMonsters.find(m => m.id === inst.dataId)?.name ?? inst.dataId;
  }

  private makeSlotD(inst: MonsterInstance, isPlayer: boolean, i: number): DSlot {
    const s = this.sy;
    const pos = isPlayer
      ? { x: this.PPLAT_X - 72 + i * 150, y: Math.round((this.PPLAT_Y + 8 + i * 7) * s) }
      : { x: this.EPLAT_X - 74 + i * 112, y: Math.round((this.EPLAT_Y + 6 + i * 6) * s) };
    const key = isPlayer ? this.playerTexKey(inst.dataId) : `monster-${inst.dataId}`;
    const sprite = this.add.image(pos.x, pos.y, key).setOrigin(0.5, 1).setDepth(5);
    this.sizeMonsterSprite(sprite, isPlayer ? 106 : 92, isPlayer ? 112 : 98);

    const rect = isPlayer
      ? { x: 384, y: Math.round((140 + i * 50) * s), w: 242, h: Math.round(42 * s) }
      : { x: 14, y: Math.round((8 + i * 46) * s), w: 236, h: Math.round(40 * s) };
    const panelBg = this.drawStatusPanel(rect);
    const mon = this.instanceToBattleMonster(inst);
    const name = this.add.text(rect.x + 10, rect.y + Math.round(5 * s), mon.name, {
      fontSize: "15px", color: "#222233", fontFamily: "'DotGothic16', monospace",
    }).setDepth(11);
    const lv = this.add.text(rect.x + rect.w - 10, rect.y + Math.round(5 * s), `Lv${mon.level}`, {
      fontSize: "14px", color: "#222233", fontFamily: "'DotGothic16', monospace",
    }).setOrigin(1, 0).setDepth(11);
    const bar = this.add.graphics().setDepth(11);
    let hp: Phaser.GameObjects.Text | undefined;
    if (isPlayer) {
      hp = this.add.text(rect.x + rect.w - 10, rect.y + rect.h - Math.round(4 * s),
        `${mon.currentHp}/${mon.maxHp}`, {
          fontSize: "13px", color: "#333344", fontFamily: "'DotGothic16', monospace",
        }).setOrigin(1, 1).setDepth(11);
    }
    const slot: DSlot = { mon, inst, sprite, panel: { bar, name, lv, hp, objs: [panelBg, name, lv, bar, ...(hp ? [hp] : [])], rect } };
    this.refreshPanelD(slot);
    return slot;
  }

  private dBarGeom(slot: DSlot) {
    const r = slot.panel.rect;
    return { x: r.x + 12, y: r.y + Math.round(r.h * 0.55), w: r.w - (slot.panel.hp ? 96 : 24), h: Math.max(5, Math.round(7 * this.sy)) };
  }

  private refreshPanelD(slot: DSlot): void {
    const g = this.dBarGeom(slot);
    this.drawHpBarGraphic(slot.panel.bar, g.x, g.y, g.w, g.h,
      Phaser.Math.Clamp(slot.mon.currentHp / slot.mon.maxHp, 0, 1));
    slot.panel.name.setText(slot.mon.name);
    slot.panel.lv.setText(`Lv${slot.mon.level}`);
    slot.panel.hp?.setText(`${slot.mon.currentHp}/${slot.mon.maxHp}`);
  }

  private dSetPanelsVisible(arr: (DSlot | null)[], v: boolean): void {
    arr.forEach(s => s && s.panel.objs.forEach(o => (o as Phaser.GameObjects.Image).setVisible(v)));
  }

  private createDouble(): void {
    const t = this.trainerData!;
    this.drawBackground();

    const pActives = this.playerState.party.filter(m => m.currentHp > 0).slice(0, 2);
    this.playerInstance = pActives[0];              // alias for shared UI paths
    this.dEReserve = t.party.slice(2);

    this.dP = pActives.map((inst, i) => this.makeSlotD(inst, true, i));
    this.dE = t.party.slice(0, 2).map((e, i) => this.makeSlotD(this.createInstance(e.id, e.level), false, i));
    this.playerMon = this.dP[0]!.mon;               // alias

    this.dE.forEach(s => s && markSeen(this.playerState, s.inst.dataId));
    this.playerState.party.forEach(m => markCaught(this.playerState, m.dataId));
    this.dP.forEach(s => s && this.dParticipants.add(s.inst));

    // hidden until the intro reveals them
    [...this.dP, ...this.dE].forEach(s => s && s.sprite.setVisible(false));
    this.dSetPanelsVisible(this.dP, false);
    this.dSetPanelsVisible(this.dE, false);

    this.drawMessageWindow();
    this.drawCommandWindow();
    this.setupInput();
    this.cameras.main.flash(500, 255, 255, 255);
    this.time.delayedCall(600, () => this.introD());
  }

  // ---- ペアの立ち絵（登場・勝利時） ----
  private showPairPortraitsD(onDone?: () => void): void {
    const t = this.trainerData!;
    const y = Math.round((this.EPLAT_Y + 8) * this.sy);
    const keyA = t.battleSprite && this.textures.exists(t.battleSprite) ? t.battleSprite : "player-frame-0";
    const keyB = t.battleSprite2 && this.textures.exists(t.battleSprite2) ? t.battleSprite2 : keyA;
    if (!this.trainerPortrait) this.trainerPortrait = this.add.image(720, y, keyA).setOrigin(0.5, 1).setDepth(6);
    if (!this.trainerPortrait2) this.trainerPortrait2 = this.add.image(760, y, keyB).setOrigin(0.5, 1).setDepth(6);
    const size = (img: Phaser.GameObjects.Image, key: string) => {
      img.setTexture(key);
      img.setScale((116 * this.sy) / (img.height || 32));
      img.setVisible(true).setAlpha(1).setY(y);
    };
    size(this.trainerPortrait, keyA);
    size(this.trainerPortrait2, keyB);
    this.trainerPortrait.setX(700); this.trainerPortrait2.setX(760);
    this.tweens.add({ targets: this.trainerPortrait, x: this.EPLAT_X - 52, duration: 350, ease: "Cubic.out" });
    this.tweens.add({ targets: this.trainerPortrait2, x: this.EPLAT_X + 58, duration: 350, ease: "Cubic.out",
      onComplete: () => onDone && onDone() });
  }

  private hidePairPortraitsD(onDone?: () => void): void {
    if (!this.trainerPortrait) { onDone && onDone(); return; }
    this.tweens.add({ targets: this.trainerPortrait, x: 700, duration: 300, ease: "Cubic.in" });
    this.tweens.add({ targets: this.trainerPortrait2!, x: 770, duration: 300, ease: "Cubic.in",
      onComplete: () => {
        this.trainerPortrait?.setVisible(false);
        this.trainerPortrait2?.setVisible(false);
        onDone && onDone();
      } });
  }

  /** 2人がそれぞれカプセルを投げながら、右へフェードアウトして退場する。 */
  private throwPairCapsulesD(onDone: () => void): void {
    const ports = [this.trainerPortrait, this.trainerPortrait2];
    for (const p of ports) {
      if (!p || !p.visible) continue;
      this.tweens.add({
        targets: p, x: p.x + 130, alpha: 0, duration: 520, ease: "Cubic.in",
        onComplete: () => { p.setVisible(false); p.setAlpha(1); },
      });
    }
    let pending = 0;
    this.dE.forEach((s, i) => {
      if (!s) return;
      pending++;
      const src = ports[i] && ports[i]!.visible ? ports[i]! : null;
      const fromX = src ? src.x - 20 * this.sy : 664;
      const fromY = src ? src.y - src.displayHeight * 0.55 : s.sprite.y - 90 * this.sy;
      this.throwCapsuleArc(fromX, fromY, s.sprite.x, s.sprite.y + s.sprite.displayHeight * 0.2,
        () => { if (--pending === 0) onDone(); }, i * 150);
    });
    if (pending === 0) onDone();
  }

  private revealSideD(arr: (DSlot | null)[], onDone: () => void): void {
    let pending = 0;
    arr.forEach(s => {
      if (!s) return;
      pending++;
      const flash = this.add.circle(s.sprite.x, s.sprite.y - s.sprite.displayHeight / 2, 8 * this.sy, 0xffffff).setDepth(7);
      this.tweens.add({ targets: flash, scale: 5, alpha: 0, duration: 300, ease: "Cubic.out", onComplete: () => flash.destroy() });
      const sc = s.sprite.scaleX;
      s.sprite.setVisible(true).setScale(sc * 0.1);
      this.tweens.add({ targets: s.sprite, scaleX: sc, scaleY: sc, duration: 260, ease: "Back.out",
        onComplete: () => { if (--pending === 0) onDone(); } });
    });
    this.dSetPanelsVisible(arr, true);
    if (pending === 0) onDone();
  }

  private introD(): void {
    const t = this.trainerData!;
    const eNames = this.dAliveSlots(this.dE).map(i => this.dE[i]!.mon.name);
    const pNames = this.dAliveSlots(this.dP).map(i => this.dP[i]!.mon.name);
    this.showPairPortraitsD(() => {
      this.showMessages(
        [`${t.name}が しょうぶを しかけてきた！`, t.dialogBefore],
        () => this.showMessages(
          [`2人は ${eNames.join("と ")}を くりだした！`],
          // 2人はカプセルを投げながら右へフェードアウトする
          () => this.throwPairCapsulesD(() => this.revealSideD(this.dE, () => {
            this.drawTrainerPips();
            // 主人公の後ろ姿 → 2体同時くりだし
            if (this.textures.exists(this.playerBackKey())) this.showPlayerBack();
            this.showMessages([`ゆけっ！ ${pNames.join("と ")}！`], () => {
              const bp = this.playerBackPortrait;
              if (bp && bp.visible) {
                this.tweens.add({ targets: bp, alpha: 0, x: bp.x - 60 * this.sy, duration: 380,
                  ease: "Cubic.in", onComplete: () => { bp.setVisible(false); bp.setAlpha(1); } });
              }
              this.revealSideD(this.dP, () => this.beginCommandD(0));
            });
          }))
        )
      );
    });
  }

  // ---- コマンド選択（スロットごと） ----
  private beginCommandD(fromSlot: number): void {
    const alive = this.dAliveSlots(this.dP).filter(i => i >= fromSlot);
    if (alive.length === 0) { this.queueEnemyActionsD(); this.resolveRoundD(); return; }
    this.dCmdSlot = alive[0];
    const slot = this.dP[this.dCmdSlot]!;
    this.playerMon = slot.mon;          // alias: 技メニュー等の共有UIが参照する
    this.playerInstance = slot.inst;
    this.phase = "command";
    this.selectedCommand = 0;
    this.showCommandWindow();
    this.highlightCommand(0);
    this.setCommandPromptD();
  }

  private setCommandPromptD(): void {
    const slot = this.dP[this.dCmdSlot];
    if (slot) this.setMessage(`${slot.mon.name}は どうする？`);
  }

  private executeCommandD(index: number): void {
    switch (index) {
      case 0:
        this.showMoveSelect();
        break;
      case 1:
        this.phase = "executing";
        this.hideCommandWindow();
        this.showMessages(["ダブルバトルの さいちゅうは\nどうぐを つかえない！"], () => {
          this.phase = "command"; this.showCommandWindow(); this.setCommandPromptD();
        });
        break;
      case 2:
        this.handleSwitchD();
        break;
      case 3:
        this.phase = "executing";
        this.hideCommandWindow();
        this.showMessages(["だめだ！ しょうぶの さいちゅうだ！"], () => {
          this.phase = "command"; this.showCommandWindow(); this.setCommandPromptD();
        });
        break;
    }
  }

  private chooseMoveD(move: BattleMove): void {
    this.hideMoveSelect();
    if (move.isSupport) { this.lockActionD(move, this.dCmdSlot, "p"); return; }
    const alive = this.dAliveSlots(this.dE);
    if (alive.length <= 1) { this.lockActionD(move, alive[0] ?? 0, "e"); return; }
    this.dPendingMove = move;
    this.dTargetIdx = alive[0];
    this.phase = "target_select";
    this.placeTargetMarkerD();
    this.setMessage("どの あいてに つかう？\n（←→で えらんで Aで けってい）");
  }

  private placeTargetMarkerD(): void {
    this.destroyTargetMarkerD();
    const slot = this.dE[this.dTargetIdx];
    if (!slot) return;
    const x = slot.sprite.x, y = slot.sprite.y - slot.sprite.displayHeight - Math.round(16 * this.sy);
    this.dTargetMarker = this.add.triangle(x, y, 0, 0, 18, 0, 9, 13, 0xffe14a).setDepth(9);
    this.tweens.add({ targets: this.dTargetMarker, y: y + 5, duration: 320, yoyo: true, repeat: -1, ease: "Sine.inOut" });
  }

  private destroyTargetMarkerD(): void {
    this.dTargetMarker?.destroy();
    this.dTargetMarker = undefined;
  }

  private lockActionD(move: BattleMove, targetSlot: number, targetSide: "p" | "e"): void {
    this.destroyTargetMarkerD();
    this.dPendingMove = null;
    this.dActions.push({ side: "p", slot: this.dCmdSlot, move, targetSide, targetSlot });
    const nextAlive = this.dAliveSlots(this.dP).filter(i => i > this.dCmdSlot);
    if (nextAlive.length > 0) {
      this.beginCommandD(nextAlive[0]);
    } else {
      this.queueEnemyActionsD();
      this.resolveRoundD();
    }
  }

  private queueEnemyActionsD(): void {
    for (const i of this.dAliveSlots(this.dE)) {
      const mon = this.dE[i]!.mon;
      const move = mon.moves[Math.floor(Math.random() * mon.moves.length)];
      const pAlive = this.dAliveSlots(this.dP);
      const target = pAlive[Math.floor(Math.random() * pAlive.length)] ?? 0;
      if (move.isSupport) this.dActions.push({ side: "e", slot: i, move, targetSide: "e", targetSlot: i });
      else this.dActions.push({ side: "e", slot: i, move, targetSide: "p", targetSlot: target });
    }
  }

  // ---- ラウンド解決（すばやさ順） ----
  private resolveRoundD(): void {
    this.phase = "executing";
    this.hideCommandWindow();
    const arrOf = (side: "p" | "e") => (side === "p" ? this.dP : this.dE);
    this.dActions.sort((a, b) => {
      const pa = a.move.priority ? 1 : 0, pb = b.move.priority ? 1 : 0;
      if (pa !== pb) return pb - pa;
      const sa = arrOf(a.side)[a.slot]?.mon; const sb = arrOf(b.side)[b.slot]?.mon;
      const va = (sa?.speed || 0) * (sa?.speedMod || 1);
      const vb = (sb?.speed || 0) * (sb?.speedMod || 1);
      if (va !== vb) return vb - va;
      return Math.random() < 0.5 ? -1 : 1;
    });

    const step = (i: number): void => {
      if (this.dOver) return;
      if (i >= this.dActions.length) { this.endRoundD(); return; }
      const a = this.dActions[i];
      const attacker = arrOf(a.side)[a.slot];
      if (!attacker || attacker.mon.currentHp <= 0) { step(i + 1); return; }
      // ターゲット再決定（倒れていたら同じ側の生存者へ）
      let target = arrOf(a.targetSide)[a.targetSlot];
      if (!target || target.mon.currentHp <= 0) {
        const alive = this.dAliveSlots(arrOf(a.targetSide));
        target = alive.length > 0 ? arrOf(a.targetSide)[alive[0]]! : null as unknown as DSlot;
      }
      if (!target) { step(i + 1); return; }
      this.executeActionD(attacker, a.move, target, () => {
        if (target!.mon.currentHp <= 0) {
          this.faintD(target!, a.targetSide, () => this.checkSidesD(() => step(i + 1)));
        } else {
          step(i + 1);
        }
      });
    };
    step(0);
  }

  private executeActionD(att: DSlot, move: BattleMove, tgt: DSlot, onComplete: () => void): void {
    const messages: string[] = [];
    if (move.isSupport && move.effect) {
      messages.push(`${att.mon.name}の ${move.name}！`);
      const eff = move.effect;
      if (eff.type === "heal" || eff.type === "healAndBuff") {
        const healAmount = Math.floor(att.mon.maxHp * ((eff.healPercent || 50) / 100));
        att.mon.currentHp = Math.min(att.mon.maxHp, att.mon.currentHp + healAmount);
        att.inst.currentHp = att.mon.currentHp;
        messages.push(`${att.mon.name}のHPが かいふくした！`);
      }
      if (eff.type === "statChange" || eff.type === "healAndBuff" || eff.type === "allStatsUp") {
        const subject = eff.target === "self" ? att.mon : tgt.mon;
        if (eff.type === "allStatsUp") {
          const mult = eff.multiplier || 1.2;
          subject.attackMod *= mult; subject.defenseMod *= mult; subject.speedMod *= mult;
          messages.push(`${subject.name}の のうりょくが あがった！`);
        } else if (eff.stat) {
          const mult = eff.multiplier || 1;
          switch (eff.stat) {
            case "attack": subject.attackMod *= mult; break;
            case "defense": subject.defenseMod *= mult; break;
            case "speed": subject.speedMod *= mult; break;
          }
          const statName = eff.stat === "attack" ? "こうげき" : eff.stat === "defense" ? "ぼうぎょ" : "すばやさ";
          messages.push(`${subject.name}の ${statName}が ${mult > 1 ? "あがった" : "さがった"}！`);
        }
      }
      this.showMessages(messages, () => { this.refreshPanelD(att); onComplete(); });
      return;
    }

    // 攻撃わざ
    const roll = Math.random() * 100;
    const acc = (move as BattleMove & { accuracy?: number }).accuracy || 100;
    if (roll > acc) {
      this.showMessages([`${att.mon.name}の ${move.name}！`, "しかし こうげきは はずれた！"], onComplete);
      return;
    }
    let damage = 0; let effectiveness = 1; let hitLine: string | null = null;
    if (move.effect && move.effect.type === "multiHit") {
      const hits = Phaser.Math.Between(move.effect.min || 2, move.effect.max || 5);
      for (let i = 0; i < hits; i++) damage += calculateDamage(att.mon, tgt.mon, move, this.typeChart).damage;
      hitLine = `${hits}かい あたった！`;
    } else {
      const r = calculateDamage(att.mon, tgt.mon, move, this.typeChart);
      damage = r.damage; effectiveness = r.effectiveness;
    }
    this.showMessages([`${att.mon.name}の ${move.name}！`], () => {
      tgt.mon.currentHp = Math.max(0, tgt.mon.currentHp - damage);
      tgt.inst.currentHp = tgt.mon.currentHp;
      this.blinkSprite(tgt.sprite, () => {
        this.animateHpBarD(tgt, () => {
          const extra: string[] = [];
          if (hitLine) extra.push(hitLine);
          if (effectiveness >= 2.0) extra.push("こうかは バツグンだ！");
          else if (effectiveness <= 0.5) extra.push("こうかは いまひとつ…");
          if (extra.length > 0) this.showMessages(extra, onComplete);
          else onComplete();
        });
      });
    });
  }

  private animateHpBarD(slot: DSlot, onComplete: () => void): void {
    const g = this.dBarGeom(slot);
    const targetRatio = Phaser.Math.Clamp(slot.mon.currentHp / slot.mon.maxHp, 0, 1);
    this.tweens.addCounter({
      from: 0, to: 100, duration: 380, ease: "Linear",
      onUpdate: (tw) => {
        const p = (tw.getValue() ?? 0) / 100;
        const r = Phaser.Math.Linear(Math.min(1, targetRatio + (1 - p) * 0.12), targetRatio, p);
        this.drawHpBarGraphic(slot.panel.bar, g.x, g.y, g.w, g.h, Phaser.Math.Clamp(r, 0, 1));
      },
      onComplete: () => { this.refreshPanelD(slot); onComplete(); },
    });
  }

  private faintD(slot: DSlot, side: "p" | "e", cb: () => void): void {
    const line = side === "e" ? `${slot.mon.name}を たおした！` : `${slot.mon.name}は たおれた！`;
    this.playFaintFx(slot.sprite);
    slot.panel.objs.forEach(o => (o as Phaser.GameObjects.Image).setAlpha(0.35));
    if (side === "e") { this.trainerRemaining = Math.max(0, this.trainerRemaining - 1); this.drawTrainerPips(); }
    if (side === "p") slot.inst.currentHp = 0;
    this.showMessages([line], cb);
  }

  private checkSidesD(next: () => void): void {
    const eAlive = this.dAliveSlots(this.dE).length;
    if (eAlive === 0 && this.dEReserve.length === 0) { this.victoryD(); return; }
    const pPartyAlive = this.playerState.party.some(m => m.currentHp > 0);
    if (!pPartyAlive) { this.defeatD(); return; }
    next();
  }

  /** ラウンド終了: 倒れた枠に控えを補充してから次のコマンドへ。 */
  private endRoundD(): void {
    this.dActions = [];
    const t = this.trainerData!;
    const refills: (() => void)[] = [];
    const runNext = (): void => {
      const f = refills.shift();
      if (f) { f(); return; }
      // 次ラウンドへ
      const firstAlive = this.dAliveSlots(this.dP)[0];
      if (firstAlive === undefined) { this.defeatD(); return; }
      this.beginCommandD(0);
    };

    // 敵側の補充
    this.dE.forEach((s, i) => {
      if (s && s.mon.currentHp > 0) return;
      if (this.dEReserve.length === 0) return;
      const nxt = this.dEReserve.shift()!;
      refills.push(() => {
        const inst = this.createInstance(nxt.id, nxt.level);
        this.replaceSlotD(this.dE, i, inst, false);
        markSeen(this.playerState, inst.dataId);
        const spr = this.dE[i]!.sprite;
        spr.setVisible(false);
        this.showMessages([`${t.name}は ${this.dMonName(inst)}を くりだした！`],
          () => this.capsuleRevealSprite(spr, false, runNext));
      });
    });
    // 味方側の補充（ベンチから自動で前へ）
    this.dP.forEach((s, i) => {
      if (s && s.mon.currentHp > 0) return;
      refills.push(() => {
        const activeInsts = this.dAliveSlots(this.dP).map(j => this.dP[j]!.inst);
        const bench = this.playerState.party.find(m => m.currentHp > 0 && !activeInsts.includes(m));
        if (!bench) { runNext(); return; }
        this.replaceSlotD(this.dP, i, bench, true);
        this.dParticipants.add(bench);
        const spr = this.dP[i]!.sprite;
        spr.setVisible(false);
        this.showMessages([`ゆけっ！ ${this.dMonName(bench)}！`],
          () => this.capsuleRevealSprite(spr, true, runNext));
      });
    });
    runNext();
  }

  /** 枠のモンスターを差し替えて表示を復帰させる（補充・こうたい共用）。 */
  private replaceSlotD(arr: (DSlot | null)[], i: number, inst: MonsterInstance, isPlayer: boolean): void {
    const old = arr[i];
    if (!old) return;
    // ひんし演出のトゥイーンが残っていると差し替え後もつぶれ続ける
    this.tweens.killTweensOf(old.sprite);
    old.sprite.clearTint();
    old.mon = this.instanceToBattleMonster(inst);
    old.inst = inst;
    old.sprite.setTexture(isPlayer ? this.playerTexKey(inst.dataId) : `monster-${inst.dataId}`);
    this.sizeMonsterSprite(old.sprite, isPlayer ? 106 : 92, isPlayer ? 112 : 98);
    // faint tween が y をずらしているので基準位置に戻す
    const s = this.sy;
    old.sprite.setY(isPlayer
      ? Math.round((this.PPLAT_Y + 8 + i * 7) * s)
      : Math.round((this.EPLAT_Y + 6 + i * 6) * s));
    old.sprite.setX(isPlayer
      ? this.PPLAT_X - 72 + i * 150
      : this.EPLAT_X - 74 + i * 112);
    old.sprite.setAlpha(1).setVisible(true);
    old.panel.objs.forEach(o => (o as Phaser.GameObjects.Image).setAlpha(1));
    this.refreshPanelD(old);
  }

  // ---- こうたい（そのスロットのターンを消費） ----
  private handleSwitchD(): void {
    this.hideCommandWindow();
    const activeInsts = this.dAliveSlots(this.dP).map(i => this.dP[i]!.inst);
    const aliveParty = this.playerState.party.filter(m => m.currentHp > 0 && !activeInsts.includes(m));
    if (aliveParty.length === 0) {
      this.showMessages(["こうたいできる なかまが いない！"], () => {
        this.phase = "command"; this.showCommandWindow(); this.setCommandPromptD();
      });
      return;
    }
    this.commandSlots.forEach(s => { s.bg.destroy(); s.text.destroy(); s.zone.destroy(); });
    this.commandSlots = [];
    const positions = [
      { x: 160, y: Math.round(360 * this.sy) }, { x: 480, y: Math.round(360 * this.sy) },
      { x: 160, y: Math.round(410 * this.sy) }, { x: 480, y: Math.round(410 * this.sy) },
      { x: 160, y: Math.round(455 * this.sy) }, { x: 480, y: Math.round(455 * this.sy) },
    ];
    const options = [
      ...aliveParty.map(m => `${this.dMonName(m)} Lv${m.level} HP${m.currentHp}/${m.maxHp}`),
      "もどる",
    ];
    this.phase = "switch_mon";
    this.selectedCommand = 0;
    for (let i = 0; i < options.length; i++) {
      const px = positions[i % positions.length].x;
      const py = positions[i % positions.length].y;
      const bg = this.add.graphics().setDepth(20);
      const text = this.add.text(px, py, options[i], {
        fontSize: "19px", color: "#ffffff", fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 3,
      }).setOrigin(0.5).setDepth(21);
      const zone = this.add.zone(px, py, 280, 40).setInteractive().setDepth(22).setOrigin(0.5);
      const idx = i;
      zone.on("pointerdown", () => {
        if (idx === aliveParty.length) {
          this.commandSlots.forEach(s2 => { s2.bg.destroy(); s2.text.destroy(); s2.zone.destroy(); });
          this.commandSlots = [];
          this.rebuildCommandWindow();
          this.phase = "command";
          this.showCommandWindow();
          this.setCommandPromptD();
        } else {
          this.doSwitchD(aliveParty[idx]);
        }
      });
      this.commandSlots.push({ label: options[i], x: px, y: py, bg, text, zone });
    }
    this.highlightLearnSlots(0);
    this.setMessage("だれと こうたいする？");
  }

  private doSwitchD(newMon: MonsterInstance): void {
    this.commandSlots.forEach(s => { s.bg.destroy(); s.text.destroy(); s.zone.destroy(); });
    this.commandSlots = [];
    this.rebuildCommandWindow();
    this.hideCommandWindow();
    const slot = this.dP[this.dCmdSlot]!;
    const oldName = slot.mon.name;
    this.phase = "executing";
    // もどれ！（回収）→ ゆけっ！（カプセルから登場）。こうたいは行動を消費する。
    this.showMessages([`${oldName} もどれ！`], () => {
      this.recallSprite(slot.sprite, () => {
        this.replaceSlotD(this.dP, this.dCmdSlot, newMon, true);
        this.dParticipants.add(newMon);
        this.playerMon = slot.mon;
        this.playerInstance = slot.inst;
        slot.sprite.setVisible(false);
        this.showMessages([`ゆけっ！ ${slot.mon.name}！`], () => {
          this.capsuleRevealSprite(slot.sprite, true, () => {
            const nextAlive = this.dAliveSlots(this.dP).filter(i => i > this.dCmdSlot);
            if (nextAlive.length > 0) this.beginCommandD(nextAlive[0]);
            else { this.queueEnemyActionsD(); this.resolveRoundD(); }
          });
        });
      });
    });
  }

  // ---- 勝敗 ----
  private victoryD(): void {
    this.dOver = true;
    this.phase = "victory";
    const t = this.trainerData!;
    const prize = t.prizeMoneyBase;
    this.playerState.money += prize;
    this.playerState.defeatedTrainers.push(t.id);
    this.dE.forEach(s => s && s.sprite.setVisible(false));
    this.showPairPortraitsD(() => {
      this.showMessages([t.dialogWin, `${prize}円 もらった！`], () => {
        this.hidePairPortraitsD(() => this.expFlowD(() => this.endBattle()));
      });
    });
  }

  /** 参加した生存アルモン全員に経験値（敵パーティ全体ぶん）を配る。 */
  private expFlowD(cb: () => void): void {
    const t = this.trainerData!;
    let total = 0;
    for (const e of t.party) {
      const data = this.allMonsters.find(m => m.id === e.id);
      if (data) total += getExpReward(data.baseExp, e.level);
    }
    const msgs: string[] = [];
    for (const inst of this.dParticipants) {
      if (inst.currentHp <= 0) continue;
      const data = this.allMonsters.find(m => m.id === inst.dataId)!;
      inst.exp += total;
      msgs.push(`${data.name}は ${total}けいけんちを かくとく！`);
      while (inst.level < 100 && inst.exp >= getExpForLevel(inst.level + 1)) {
        inst.level++;
        applyLevelUp(inst, this.allMonsters);
        msgs.push(`${data.name}は レベル${inst.level}に なった！`);
        const mv = getNewMoveAtLevel(data, inst.level);
        if (mv && !inst.moves.includes(mv)) {
          const mvName = this.allMoves.find(m => m.id === mv)?.name ?? mv;
          if (inst.moves.length < 4) {
            inst.moves.push(mv);
            msgs.push(`${data.name}は ${mvName}を おぼえた！`);
          } else {
            msgs.push(`${data.name}は ${mvName}を おぼえたかったが\nわざが いっぱいだった…`);
          }
        }
      }
      const evo = checkEvolution(inst, this.allMonsters);
      if (evo) {
        const idx = this.playerState.party.indexOf(inst);
        if (idx >= 0) this.pendingEvolutions.push({ partyIndex: idx, fromId: inst.dataId, toId: evo.evolvesTo });
      }
    }
    if (msgs.length === 0) { cb(); return; }
    this.showMessages(msgs, cb);
  }

  private defeatD(): void {
    this.dOver = true;
    this.phase = "defeat";
    this.showMessages(["めのまえが まっくらになった…"], () => {
      this.time.delayedCall(1200, () => this.endBattleDefeat());
    });
  }
}
