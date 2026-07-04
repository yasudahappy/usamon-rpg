import * as Phaser from "phaser";
import { BattleMonster, BattleMove } from "../battle/types";
import { calculateDamage } from "../battle/damage";
import { TypeChart } from "../types";

type BattlePhase =
  | "intro"
  | "command"
  | "move_select"
  | "executing"
  | "victory"
  | "defeat";

interface CommandSlot {
  label: string;
  x: number;
  y: number;
  bg: Phaser.GameObjects.Graphics;
  text: Phaser.GameObjects.Text;
  zone: Phaser.GameObjects.Zone;
}

export class BattleScene extends Phaser.Scene {
  // Monsters
  private playerMon!: BattleMonster;
  private enemyMon!: BattleMonster;
  private typeChart!: TypeChart;

  // Graphics
  private playerSprite!: Phaser.GameObjects.Image;
  private enemySprite!: Phaser.GameObjects.Image;
  private playerHpBar!: Phaser.GameObjects.Graphics;
  private enemyHpBar!: Phaser.GameObjects.Graphics;
  private playerHpText!: Phaser.GameObjects.Text;
  private enemyHpText!: Phaser.GameObjects.Text;
  private playerNameText!: Phaser.GameObjects.Text;
  private enemyNameText!: Phaser.GameObjects.Text;

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

  // Return data
  private returnMapKey = "moonbase";
  private returnPlayerX = 0;
  private returnPlayerY = 0;

  constructor() {
    super({ key: "BattleScene" });
  }

  init(data: {
    mapKey?: string;
    playerX?: number;
    playerY?: number;
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
  }

  create(): void {
    this.typeChart = this.cache.json.get("types") as TypeChart;
    this.initMonsters();
    this.drawBackground();
    this.drawMonsters();
    this.drawHpBars();
    this.drawMessageWindow();
    this.drawCommandWindow();
    this.drawMoveWindow();
    this.setupInput();

    // Flash white -> fade in
    this.cameras.main.flash(500, 255, 255, 255);

    // Start intro sequence
    this.time.delayedCall(600, () => {
      this.showMessages(
        [
          `やせいの ${this.enemyMon.name} が あらわれた！`,
          `ゆけっ！ ${this.playerMon.name}！`,
        ],
        () => {
          this.phase = "command";
          this.showCommandWindow();
        }
      );
    });
  }

  private initMonsters(): void {
    this.playerMon = {
      name: "うさもん",
      type: "光",
      level: 5,
      maxHp: 45,
      currentHp: 45,
      attack: 15,
      defense: 12,
      speed: 14,
      moves: [
        {
          name: "たたく",
          type: "ノーマル",
          power: 40,
          isSupport: false,
        },
        {
          name: "かんしゃのまい",
          type: "光",
          power: 0,
          isSupport: true,
          effect: { stat: "attack", multiplier: 1.5, target: "self" },
        },
      ],
      attackMod: 1.0,
      defenseMod: 1.0,
      speedMod: 1.0,
    };

    this.enemyMon = {
      name: "レゴニャス",
      type: "影",
      level: 4,
      maxHp: 38,
      currentHp: 38,
      attack: 13,
      defense: 10,
      speed: 16,
      moves: [
        {
          name: "ひっかき",
          type: "ノーマル",
          power: 40,
          isSupport: false,
        },
        {
          name: "シャドークロー",
          type: "影",
          power: 65,
          isSupport: false,
        },
      ],
      attackMod: 1.0,
      defenseMod: 1.0,
      speedMod: 1.0,
    };
  }

  // ---- Drawing ----

  private drawBackground(): void {
    const g = this.add.graphics();
    // Dark gradient sky
    for (let y = 0; y < 160; y++) {
      const t = y / 160;
      const r = Math.floor(5 + t * 10);
      const gv = Math.floor(5 + t * 12);
      const b = Math.floor(15 + t * 20);
      g.fillStyle(Phaser.Display.Color.GetColor(r, gv, b));
      g.fillRect(0, y, 640, 1);
    }
    // Stars
    const rng = new Phaser.Math.RandomDataGenerator(["battlestars"]);
    for (let i = 0; i < 40; i++) {
      const sx = rng.between(0, 640);
      const sy = rng.between(0, 130);
      const brightness = rng.between(150, 255);
      g.fillStyle(
        Phaser.Display.Color.GetColor(brightness, brightness, brightness)
      );
      g.fillRect(sx, sy, 1, 1);
    }
    // Grey ground
    for (let y = 160; y < 240; y++) {
      const t = (y - 160) / 80;
      const c = Math.floor(40 + t * 20);
      g.fillStyle(Phaser.Display.Color.GetColor(c, c, c + 5));
      g.fillRect(0, y, 640, 1);
    }
  }

  private drawMonsters(): void {
    // Player monster (left-bottom)
    this.playerSprite = this.add
      .image(100, 180, "monster-usamon")
      .setDepth(5);
    // Enemy monster (right-top)
    this.enemySprite = this.add
      .image(480, 80, "monster-regonyas")
      .setDepth(5);
  }

  private drawHpBars(): void {
    // -- Player HP area (bottom-left of battle field) --
    this.playerNameText = this.add
      .text(30, 200, `${this.playerMon.name}  Lv${this.playerMon.level}`, {
        fontSize: "13px",
        color: "#ffffff",
        fontFamily: "monospace",
      })
      .setDepth(10);

    this.playerHpText = this.add
      .text(
        180,
        200,
        `${this.playerMon.currentHp}/${this.playerMon.maxHp}`,
        {
          fontSize: "13px",
          color: "#ffffff",
          fontFamily: "monospace",
        }
      )
      .setOrigin(1, 0)
      .setDepth(10);

    this.playerHpBar = this.add.graphics().setDepth(10);
    this.drawHpBarGraphic(
      this.playerHpBar,
      30,
      218,
      150,
      this.playerMon.currentHp / this.playerMon.maxHp
    );

    // -- Enemy HP area (top-right of battle field) --
    this.enemyNameText = this.add
      .text(400, 40, `${this.enemyMon.name}  Lv${this.enemyMon.level}`, {
        fontSize: "13px",
        color: "#ffffff",
        fontFamily: "monospace",
      })
      .setDepth(10);

    this.enemyHpText = this.add
      .text(
        600,
        40,
        `${this.enemyMon.currentHp}/${this.enemyMon.maxHp}`,
        {
          fontSize: "13px",
          color: "#ffffff",
          fontFamily: "monospace",
        }
      )
      .setOrigin(1, 0)
      .setDepth(10);

    this.enemyHpBar = this.add.graphics().setDepth(10);
    this.drawHpBarGraphic(
      this.enemyHpBar,
      400,
      58,
      200,
      this.enemyMon.currentHp / this.enemyMon.maxHp
    );
  }

  private drawHpBarGraphic(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    width: number,
    ratio: number
  ): void {
    g.clear();
    // Background
    g.fillStyle(0x333333);
    g.fillRect(x, y, width, 10);
    // HP bar
    const clampedRatio = Phaser.Math.Clamp(ratio, 0, 1);
    let color: number;
    if (clampedRatio > 0.5) color = 0x22cc44;
    else if (clampedRatio > 0.2) color = 0xcccc22;
    else color = 0xcc2222;
    g.fillStyle(color);
    g.fillRect(x, y, Math.floor(width * clampedRatio), 10);
    // Border
    g.lineStyle(1, 0x888888);
    g.strokeRect(x, y, width, 10);
  }

  private drawMessageWindow(): void {
    this.msgBg = this.add.graphics().setDepth(20);
    this.msgBg.fillStyle(0x111122, 0.95);
    this.msgBg.fillRect(0, 240, 640, 100);
    this.msgBg.lineStyle(2, 0x4488aa);
    this.msgBg.strokeRect(2, 242, 636, 96);

    this.msgText = this.add
      .text(20, 260, "", {
        fontSize: "16px",
        color: "#ffffff",
        fontFamily: "monospace",
        wordWrap: { width: 600 },
      })
      .setDepth(21);
  }

  private drawCommandWindow(): void {
    const labels = ["たたかう", "どうぐ", "交代", "にげる"];
    const positions = [
      { x: 160, y: 370 },
      { x: 480, y: 370 },
      { x: 160, y: 430 },
      { x: 480, y: 430 },
    ];

    for (let i = 0; i < 4; i++) {
      const px = positions[i].x;
      const py = positions[i].y;
      const bg = this.add.graphics().setDepth(20).setVisible(false);
      const text = this.add
        .text(px, py, labels[i], {
          fontSize: "18px",
          color: "#ffffff",
          fontFamily: "monospace",
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
      // Disable input initially
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
    const w = 280;
    const h = 50;
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

  private drawMoveWindow(): void {
    // Dynamically created when "たたかう" is selected
  }

  private showMoveSelect(): void {
    this.phase = "move_select";
    this.hideCommandWindow();
    this.selectedMove = 0;

    // Clear old move slots
    this.moveSlots.forEach((slot) => {
      slot.bg.destroy();
      slot.text.destroy();
      slot.zone.destroy();
    });
    this.moveSlots = [];

    const moves = this.playerMon.moves;
    const positions = [
      { x: 160, y: 370 },
      { x: 480, y: 370 },
      { x: 160, y: 430 },
      { x: 480, y: 430 },
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
          fontFamily: "monospace",
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
      this.enterKey = this.input.keyboard.addKey(
        Phaser.Input.Keyboard.KeyCodes.ENTER
      );
      this.spaceKey = this.input.keyboard.addKey(
        Phaser.Input.Keyboard.KeyCodes.SPACE
      );
    }

    // Touch/click on message window to advance
    this.msgBg.setInteractive(
      new Phaser.Geom.Rectangle(0, 240, 640, 100),
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
    if (!this.input.keyboard) return;

    const justUp = Phaser.Input.Keyboard.JustDown(this.cursorKeys.up);
    const justDown = Phaser.Input.Keyboard.JustDown(this.cursorKeys.down);
    const justLeft = Phaser.Input.Keyboard.JustDown(this.cursorKeys.left);
    const justRight = Phaser.Input.Keyboard.JustDown(this.cursorKeys.right);
    const justEnter = Phaser.Input.Keyboard.JustDown(this.enterKey);
    const justSpace = Phaser.Input.Keyboard.JustDown(this.spaceKey);
    const confirm = justEnter || justSpace;

    // Advance message
    if (this.waitingForInput && confirm) {
      this.waitingForInput = false;
      this.processMessageQueue();
      return;
    }

    if (this.phase === "command") {
      // 2x2 grid navigation
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
      if (
        justDown &&
        this.selectedMove < 2 &&
        this.selectedMove + 2 >= maxMoves
      ) {
        // Can't go down; stay
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
      // Escape key or back
      const escKey = this.input.keyboard!.addKey(
        Phaser.Input.Keyboard.KeyCodes.ESC
      );
      if (Phaser.Input.Keyboard.JustDown(escKey)) {
        this.hideMoveSelect();
        this.phase = "command";
        this.showCommandWindow();
        this.setMessage("");
      }
    }
  }

  // ---- Commands ----

  private executeCommand(index: number): void {
    switch (index) {
      case 0: // たたかう
        this.showMoveSelect();
        break;
      case 1: // どうぐ
        this.showMessages(["まだ もっていない！"], () => {
          this.phase = "command";
          this.showCommandWindow();
        });
        break;
      case 2: // 交代
        this.showMessages(["なかまが いない！"], () => {
          this.phase = "command";
          this.showCommandWindow();
        });
        break;
      case 3: // にげる
        this.hideCommandWindow();
        this.showMessages(["うまく にげきれた！"], () => {
          this.endBattle();
        });
        break;
    }
  }

  // ---- Turn Execution ----

  private executeTurn(playerMove: BattleMove): void {
    this.phase = "executing";
    this.hideMoveSelect();

    // Determine turn order by speed
    const playerSpeed = this.playerMon.speed * this.playerMon.speedMod;
    const enemySpeed = this.enemyMon.speed * this.enemyMon.speedMod;
    // Enemy move (random selection)
    const enemyMove =
      this.enemyMon.moves[
        Math.floor(Math.random() * this.enemyMon.moves.length)
      ];

    const playerFirst = playerSpeed >= enemySpeed;

    const firstAttacker = playerFirst ? this.playerMon : this.enemyMon;
    const firstMove = playerFirst ? playerMove : enemyMove;
    const firstTarget = playerFirst ? this.enemyMon : this.playerMon;
    const firstSprite = playerFirst ? this.enemySprite : this.playerSprite;

    const secondAttacker = playerFirst ? this.enemyMon : this.playerMon;
    const secondMove = playerFirst ? enemyMove : playerMove;
    const secondTarget = playerFirst ? this.playerMon : this.enemyMon;
    const secondSprite = playerFirst ? this.playerSprite : this.enemySprite;

    // Execute first attack
    this.executeAction(
      firstAttacker,
      firstMove,
      firstTarget,
      firstSprite,
      () => {
        // Check if target fainted
        if (firstTarget.currentHp <= 0) {
          this.checkBattleEnd();
          return;
        }
        // Execute second attack
        this.executeAction(
          secondAttacker,
          secondMove,
          secondTarget,
          secondSprite,
          () => {
            if (secondTarget.currentHp <= 0) {
              this.checkBattleEnd();
              return;
            }
            // Next turn
            this.phase = "command";
            this.showCommandWindow();
          }
        );
      }
    );
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
      // Support move
      messages.push(`${attacker.name}の ${move.name}！`);
      const eff = move.effect;
      const subject = eff.target === "self" ? attacker : target;
      switch (eff.stat) {
        case "attack":
          subject.attackMod *= eff.multiplier;
          break;
        case "defense":
          subject.defenseMod *= eff.multiplier;
          break;
        case "speed":
          subject.speedMod *= eff.multiplier;
          break;
      }
      const statName =
        eff.stat === "attack"
          ? "こうげき"
          : eff.stat === "defense"
            ? "ぼうぎょ"
            : "すばやさ";
      const direction = eff.multiplier > 1 ? "あがった" : "さがった";
      const subjectName = eff.target === "self" ? attacker.name : target.name;
      messages.push(`${subjectName}の ${statName}が ${direction}！`);

      this.showMessages(messages, onComplete);
    } else {
      // Attack move
      const { damage, effectiveness } = calculateDamage(
        attacker,
        target,
        move,
        this.typeChart
      );
      messages.push(`${attacker.name}の ${move.name}！`);

      this.showMessages(messages, () => {
        // Apply damage
        target.currentHp = Math.max(0, target.currentHp - damage);

        // Blink target
        this.blinkSprite(targetSprite, () => {
          // Animate HP bar
          const isPlayer = target === this.playerMon;
          this.animateHpBar(target, isPlayer, () => {
            const effMessages: string[] = [];
            if (effectiveness >= 2.0) {
              effMessages.push("こうかは バツグンだ！");
            } else if (effectiveness <= 0.5) {
              effMessages.push("こうかは いまひとつ…");
            }
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

  // ---- Animations ----

  private blinkSprite(
    sprite: Phaser.GameObjects.Image,
    onComplete: () => void
  ): void {
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

  private animateHpBar(
    mon: BattleMonster,
    isPlayer: boolean,
    onComplete: () => void
  ): void {
    const hpBar = isPlayer ? this.playerHpBar : this.enemyHpBar;
    const hpText = isPlayer ? this.playerHpText : this.enemyHpText;
    const x = isPlayer ? 30 : 400;
    const y = isPlayer ? 218 : 58;
    const width = isPlayer ? 150 : 200;
    const targetRatio = mon.currentHp / mon.maxHp;

    // Get current visual ratio from bar
    const startHp = mon.currentHp; // Already updated
    // Tween a dummy object
    const tweenObj = { ratio: (mon.currentHp + 1) / mon.maxHp }; // slight offset for visual

    // Actually use a smooth counter
    this.tweens.addCounter({
      from: 0,
      to: 100,
      duration: 400,
      ease: "Linear",
      onUpdate: (tween) => {
        const ratio = Phaser.Math.Clamp(targetRatio, 0, 1);
        // We'll just draw the final ratio progressively
        const progress = (tween.getValue() ?? 0) / 100;
        // Interpolate toward target
        const displayRatio = Phaser.Math.Linear(
          ratio + (1 - progress) * 0.1,
          ratio,
          progress
        );
        this.drawHpBarGraphic(
          hpBar,
          x,
          y,
          width,
          Phaser.Math.Clamp(displayRatio, 0, 1)
        );
      },
      onComplete: () => {
        this.drawHpBarGraphic(hpBar, x, y, width, targetRatio);
        hpText.setText(`${mon.currentHp}/${mon.maxHp}`);
        onComplete();
      },
    });
  }

  // ---- Messages ----

  private setMessage(text: string): void {
    this.msgText.setText(text);
  }

  private showMessages(
    texts: string[],
    onAllDone: () => void
  ): void {
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
      // Last message: wait for input then callback
      this.waitingForInput = true;
      this.time.delayedCall(300, () => {
        // Allow input
        const checkDone = () => {
          if (!this.waitingForInput) {
            msg.callback!();
          } else {
            this.time.delayedCall(50, checkDone);
          }
        };
        checkDone();
      });
    } else {
      // Auto-advance after delay, or wait for input
      this.waitingForInput = true;
      this.time.delayedCall(300, () => {
        const checkDone = () => {
          if (!this.waitingForInput) {
            this.processMessageQueue();
          } else {
            this.time.delayedCall(50, checkDone);
          }
        };
        checkDone();
      });
    }
  }

  // ---- Battle End ----

  private checkBattleEnd(): void {
    if (this.enemyMon.currentHp <= 0) {
      this.phase = "victory";
      // Hide enemy sprite
      this.tweens.add({
        targets: this.enemySprite,
        alpha: 0,
        y: this.enemySprite.y + 30,
        duration: 500,
      });
      this.showMessages(
        [`${this.enemyMon.name} を たおした！`],
        () => {
          this.time.delayedCall(1500, () => {
            this.endBattle();
          });
        }
      );
    } else if (this.playerMon.currentHp <= 0) {
      this.phase = "defeat";
      this.tweens.add({
        targets: this.playerSprite,
        alpha: 0,
        y: this.playerSprite.y + 30,
        duration: 500,
      });
      this.showMessages(
        ["めのまえが まっくらになった…"],
        () => {
          this.time.delayedCall(1500, () => {
            this.endBattleDefeat();
          });
        }
      );
    }
  }

  private endBattle(): void {
    this.cameras.main.fadeOut(500, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => {
      this.scene.start("MapScene", {
        mapKey: this.returnMapKey,
        playerX: this.returnPlayerX,
        playerY: this.returnPlayerY,
      });
    });
  }

  private endBattleDefeat(): void {
    this.cameras.main.fadeOut(500, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => {
      this.scene.start("MapScene", {
        mapKey: "moonbase",
      });
    });
  }
}
