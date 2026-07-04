import * as Phaser from "phaser";
import { MapData } from "../types";

type Direction = "up" | "down" | "left" | "right";

interface SceneData {
  mapKey?: string;
  playerX?: number;
  playerY?: number;
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
  private gridX = 0;
  private gridY = 0;
  // Virtual d-pad
  private dpadState: Direction | null = null;
  // Map transition
  private currentMapKey = "moonbase";
  private spawnX?: number;
  private spawnY?: number;
  // Battle
  private battleKey?: Phaser.Input.Keyboard.Key;
  private startingBattle = false;

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
    this.dpadState = null;
    this.animFrame = 0;
    this.animTimer = 0;
    this.startingBattle = false;
  }

  create(): void {
    this.mapData = this.cache.json.get(
      `map-${this.currentMapKey}`
    ) as MapData;
    this.tileSize = this.mapData.tileSize;

    this.drawMap();
    this.createPlayer();
    this.setupInput();
    this.setupDpad();
    this.setupCamera();
    this.setupBattleKey();

    // Fade in
    this.cameras.main.fadeIn(300, 0, 0, 0);

    // Show map name overlay
    this.showMapName(this.mapData.name);
  }

  private drawMap(): void {
    const { width, height, layers, tileSize } = this.mapData;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tileId = layers.floor[y][x];
        const key = `tile-${tileId}`;
        this.add.image(
          x * tileSize + tileSize / 2,
          y * tileSize + tileSize / 2,
          key
        );
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
    }
  }

  private setupDpad(): void {
    const btnSize = 52;
    const gap = 4;
    const baseX = 90;
    const baseY = this.scale.height - 100;

    const dpadContainer = this.add
      .container(0, 0)
      .setDepth(100)
      .setScrollFactor(0);

    // Semi-transparent background circle
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.3);
    bg.fillCircle(baseX, baseY, 85);
    dpadContainer.add(bg);

    const buttons: {
      dir: Direction;
      x: number;
      y: number;
      label: string;
    }[] = [
      { dir: "up", x: baseX, y: baseY - btnSize - gap, label: "▲" },
      { dir: "down", x: baseX, y: baseY + btnSize + gap, label: "▼" },
      { dir: "left", x: baseX - btnSize - gap, y: baseY, label: "◀" },
      { dir: "right", x: baseX + btnSize + gap, y: baseY, label: "▶" },
    ];

    buttons.forEach(({ dir, x, y, label }) => {
      const btnBg = this.add.graphics();
      btnBg.fillStyle(0x444455, 0.6);
      btnBg.fillRoundedRect(
        x - btnSize / 2,
        y - btnSize / 2,
        btnSize,
        btnSize,
        8
      );
      dpadContainer.add(btnBg);

      const text = this.add
        .text(x, y, label, {
          fontSize: "22px",
          color: "#aabbcc",
          fontFamily: "monospace",
        })
        .setOrigin(0.5);
      dpadContainer.add(text);

      // Interactive zone
      const zone = this.add
        .zone(x, y, btnSize, btnSize)
        .setInteractive()
        .setScrollFactor(0)
        .setDepth(101);

      zone.on("pointerdown", () => {
        this.dpadState = dir;
        btnBg.clear();
        btnBg.fillStyle(0x6688aa, 0.8);
        btnBg.fillRoundedRect(
          x - btnSize / 2,
          y - btnSize / 2,
          btnSize,
          btnSize,
          8
        );
      });
      zone.on("pointerup", () => {
        this.dpadState = null;
        btnBg.clear();
        btnBg.fillStyle(0x444455, 0.6);
        btnBg.fillRoundedRect(
          x - btnSize / 2,
          y - btnSize / 2,
          btnSize,
          btnSize,
          8
        );
      });
      zone.on("pointerout", () => {
        this.dpadState = null;
        btnBg.clear();
        btnBg.fillStyle(0x444455, 0.6);
        btnBg.fillRoundedRect(
          x - btnSize / 2,
          y - btnSize / 2,
          btnSize,
          btnSize,
          8
        );
      });
    });
  }

  private setupCamera(): void {
    const worldWidth = this.mapData.width * this.tileSize;
    const worldHeight = this.mapData.height * this.tileSize;
    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
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

  private startBattle(): void {
    if (this.startingBattle || this.isWarping) return;
    this.startingBattle = true;
    this.moveQueue = null;

    this.scene.start("BattleScene", {
      mapKey: this.currentMapKey,
      playerX: this.gridX,
      playerY: this.gridY,
    });
  }

  private checkRandomEncounter(): void {
    if (this.startingBattle || this.isWarping) return;
    if (this.currentMapKey !== "sand_route_1") return;

    // Check if current tile is sand (tileId === 5)
    const { layers } = this.mapData;
    const tileId = layers.floor[this.gridY]?.[this.gridX];
    if (tileId !== 5) return;

    // 15% chance per step
    if (Math.random() < 0.15) {
      this.startBattle();
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
    // D-pad takes priority for mobile
    if (this.dpadState) return this.dpadState;

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

    // Movement input
    const dir = this.getInputDirection();
    if (dir) {
      this.tryMove(dir);
    }
  }
}
