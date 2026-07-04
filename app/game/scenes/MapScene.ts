import * as Phaser from "phaser";
import { MapData } from "../types";

type Direction = "up" | "down" | "left" | "right";

export class MapScene extends Phaser.Scene {
  private mapData!: MapData;
  private player!: Phaser.GameObjects.Image;
  private tileSize!: number;
  private isMoving = false;
  private moveQueue: Direction | null = null;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private animFrame = 0;
  private animTimer = 0;
  private gridX = 0;
  private gridY = 0;
  // Virtual d-pad
  private dpadState: Direction | null = null;

  constructor() {
    super({ key: "MapScene" });
  }

  create(): void {
    this.mapData = this.cache.json.get("map-moonbase") as MapData;
    this.tileSize = this.mapData.tileSize;

    this.drawMap();
    this.createPlayer();
    this.setupInput();
    this.setupDpad();
    this.setupCamera();
  }

  private drawMap(): void {
    const { width, height, layers, tileSize } = this.mapData;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tileId = layers.floor[y][x];
        const key = `tile-${tileId}`;
        this.add.image(x * tileSize + tileSize / 2, y * tileSize + tileSize / 2, key);
      }
    }
  }

  private createPlayer(): void {
    const { playerStart, tileSize } = this.mapData;
    this.gridX = playerStart.x;
    this.gridY = playerStart.y;

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
      this.gridX * tileSize + tileSize / 2,
      this.gridY * tileSize + tileSize / 2,
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

    const dpadContainer = this.add.container(0, 0).setDepth(100).setScrollFactor(0);

    // Semi-transparent background circle
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.3);
    bg.fillCircle(baseX, baseY, 85);
    dpadContainer.add(bg);

    const buttons: { dir: Direction; x: number; y: number; label: string }[] = [
      { dir: "up", x: baseX, y: baseY - btnSize - gap, label: "▲" },
      { dir: "down", x: baseX, y: baseY + btnSize + gap, label: "▼" },
      { dir: "left", x: baseX - btnSize - gap, y: baseY, label: "◀" },
      { dir: "right", x: baseX + btnSize + gap, y: baseY, label: "▶" },
    ];

    buttons.forEach(({ dir, x, y, label }) => {
      const bg = this.add.graphics();
      bg.fillStyle(0x444455, 0.6);
      bg.fillRoundedRect(x - btnSize / 2, y - btnSize / 2, btnSize, btnSize, 8);
      dpadContainer.add(bg);

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
        bg.clear();
        bg.fillStyle(0x6688aa, 0.8);
        bg.fillRoundedRect(x - btnSize / 2, y - btnSize / 2, btnSize, btnSize, 8);
      });
      zone.on("pointerup", () => {
        this.dpadState = null;
        bg.clear();
        bg.fillStyle(0x444455, 0.6);
        bg.fillRoundedRect(x - btnSize / 2, y - btnSize / 2, btnSize, btnSize, 8);
      });
      zone.on("pointerout", () => {
        this.dpadState = null;
        bg.clear();
        bg.fillStyle(0x444455, 0.6);
        bg.fillRoundedRect(x - btnSize / 2, y - btnSize / 2, btnSize, btnSize, 8);
      });
    });
  }

  private setupCamera(): void {
    const worldWidth = this.mapData.width * this.tileSize;
    const worldHeight = this.mapData.height * this.tileSize;
    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
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
    if (this.isMoving) {
      this.moveQueue = dir;
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
        // Process queued move
        if (this.moveQueue) {
          const queued = this.moveQueue;
          this.moveQueue = null;
          this.tryMove(queued);
        }
      },
    });
  }

  update(_time: number, delta: number): void {
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
