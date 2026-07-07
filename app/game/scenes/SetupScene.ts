import * as Phaser from "phaser";

interface PlayerSetup {
  gender: "boy" | "girl";
  suitColor: string;
  playerName: string;
}

const SUIT_COLORS = ["white", "blue", "orange", "pink", "black"];
const SUIT_LABELS = ["ホワイト", "ブルー", "オレンジ", "ピンク", "ブラック"];
const SUIT_HEX = ["#e0e0e8", "#6488d0", "#e8a850", "#e0a0c0", "#505058"];

export class SetupScene extends Phaser.Scene {
  private step: "gender" | "suit" | "name" = "gender";
  private selectedGender: "boy" | "girl" = "boy";
  private selectedSuit = 0;
  private playerName = "";
  private previewSprite!: Phaser.GameObjects.Image;
  private nameText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private instructionText!: Phaser.GameObjects.Text;
  private uiElements: Phaser.GameObjects.GameObject[] = [];
  private htmlInput: HTMLInputElement | null = null;

  constructor() {
    super({ key: "SetupScene" });
  }

  create(): void {
    const w = this.scale.width;   // 640
    const H = this.scale.height;  // dynamic

    // Background: dark navy with stars
    const bg = this.add.graphics();
    for (let y = 0; y < H; y++) {
      const t = y / H;
      const r = Math.floor(10 + t * 15);
      const g = Math.floor(12 + t * 20);
      const b = Math.floor(30 + t * 40);
      bg.fillStyle(Phaser.Display.Color.GetColor(r, g, b));
      bg.fillRect(0, y, w, 1);
    }
    // Stars
    const rng = new Phaser.Math.RandomDataGenerator(["setupstars"]);
    for (let i = 0; i < 80; i++) {
      const sx = rng.between(0, w);
      const sy = rng.between(0, H);
      const bright = rng.between(180, 255);
      bg.fillStyle(Phaser.Display.Color.GetColor(bright, bright, bright));
      bg.fillRect(sx, sy, rng.between(1, 2), rng.between(1, 2));
    }

    // Title
    this.add.text(w / 2, Math.round(H * 0.05), "うさもんの大冒険", {
      fontSize: "28px",
      color: "#ffffff",
      fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 3,
      fontStyle: "bold",
      }).setOrigin(0.5);

    this.add.text(w / 2, Math.round(H * 0.085), "〜月面探索編〜", {
      fontSize: "16px",
      color: "#88aacc",
      fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5);

    // Prompt text (changes per step)
    this.promptText = this.add.text(w / 2, Math.round(H * 0.14), "", {
      fontSize: "18px",
      color: "#ffffff",
      fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5).setDepth(10);

    // Instruction text
    this.instructionText = this.add.text(w / 2, H - 40, "", {
      fontSize: "12px",
      color: "#ffffff",
      fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5).setDepth(10);

    // Character preview (center)
    this.previewSprite = this.add.image(
      w / 2,
      Math.round(H * 0.28),
      this.textures.exists("cast-char0-down") ? "cast-char0-down" : "player-frame-0"
    )
      .setDepth(10)
      .setScale(3);

    // Name text (for name step)
    this.nameText = this.add.text(w / 2, Math.round(H * 0.40), "", {
      fontSize: "24px",
      color: "#ffffff",
      fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 3,
      backgroundColor: "#223344",
      padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setDepth(10).setVisible(false);

    this.showGenderStep();

    // Keyboard input
    if (this.input.keyboard) {
      this.input.keyboard.on("keydown", (event: KeyboardEvent) => {
        this.handleKeydown(event);
      });
    }
  }

  private clearUI(): void {
    this.uiElements.forEach((el) => el.destroy());
    this.uiElements = [];
  }

  // ---- Step 1: Gender ----
  private showGenderStep(): void {
    this.step = "gender";
    this.clearUI();
    this.promptText.setText("せいべつを えらんでね");
    this.instructionText.setText("← → で選択  Enter で決定");
    this.nameText.setVisible(false);

    const w = this.scale.width;
    const H = this.scale.height;
    const optY = Math.round(H * 0.42);
    const options = [
      { label: "おとこのこ", value: "boy", x: w / 2 - 100 },
      { label: "おんなのこ", value: "girl", x: w / 2 + 100 },
    ];

    options.forEach((opt) => {
      const bg = this.add.graphics().setDepth(10);
      const text = this.add.text(opt.x, optY, opt.label, {
        fontSize: "18px",
        color: "#ffffff",
        fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 3,
      }).setOrigin(0.5).setDepth(11);

      const zone = this.add.zone(opt.x, optY, 160, 50)
        .setInteractive().setDepth(12).setOrigin(0.5);
      zone.on("pointerdown", () => {
        this.selectedGender = opt.value as "boy" | "girl";
        this.highlightGender();
      });

      this.uiElements.push(bg, text, zone);
    });

    this.highlightGender();

    // Confirm button
    const confirmY = Math.round(H * 0.53);
    const gBg = this.add.graphics().setDepth(10);
    gBg.fillStyle(0x2255aa, 0.9);
    gBg.fillRoundedRect(w / 2 - 60, confirmY - 20, 120, 40, 8);
    gBg.lineStyle(2, 0x66aaff);
    gBg.strokeRoundedRect(w / 2 - 60, confirmY - 20, 120, 40, 8);
    const gTxt = this.add.text(w / 2, confirmY, "けってい", {
      fontSize: "16px", color: "#ffffff", fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5).setDepth(11);
    const gZone = this.add.zone(w / 2, confirmY, 120, 40)
      .setInteractive().setDepth(12).setOrigin(0.5);
    gZone.on("pointerdown", () => this.showSuitStep());
    this.uiElements.push(gBg, gTxt, gZone);
  }

  private highlightGender(): void {
    const isLeft = this.selectedGender === "boy";
    const w = this.scale.width;
    const H = this.scale.height;
    const optY = Math.round(H * 0.42);
    const positions = [w / 2 - 100, w / 2 + 100];

    let idx = 0;
    for (let i = 0; i < this.uiElements.length - 3; i += 3) {
      const bg = this.uiElements[i] as Phaser.GameObjects.Graphics;
      const text = this.uiElements[i + 1] as Phaser.GameObjects.Text;
      const x = positions[idx];
      bg.clear();
      if ((idx === 0 && isLeft) || (idx === 1 && !isLeft)) {
        bg.fillStyle(0x2255aa, 0.9);
        bg.fillRoundedRect(x - 80, optY - 25, 160, 50, 8);
        bg.lineStyle(2, 0x66aaff);
        bg.strokeRoundedRect(x - 80, optY - 25, 160, 50, 8);
        text.setColor("#ffffff");
      } else {
        bg.fillStyle(0x223344, 0.7);
        bg.fillRoundedRect(x - 80, optY - 25, 160, 50, 8);
        bg.lineStyle(1, 0x445566);
        bg.strokeRoundedRect(x - 80, optY - 25, 160, 50, 8);
        text.setColor("#888888");
      }
      idx++;
    }
  }

  // ---- Step 2: Suit Color ----
  private showSuitStep(): void {
    this.step = "suit";
    this.clearUI();
    this.promptText.setText("うちゅうふくの いろを えらんでね");
    this.instructionText.setText("← → で選択  Enter で決定");
    this.nameText.setVisible(false);
    this.updatePreview();

    const w = this.scale.width;
    const H = this.scale.height;
    const swatchY = Math.round(H * 0.44);
    const labelY = swatchY + 30;
    const startX = w / 2 - (SUIT_COLORS.length - 1) * 55 / 2;

    SUIT_COLORS.forEach((color, i) => {
      const x = startX + i * 55;
      const bg = this.add.graphics().setDepth(10);
      const swatch = this.add.graphics().setDepth(11);

      const hex = Phaser.Display.Color.HexStringToColor(SUIT_HEX[i]).color;
      swatch.fillStyle(hex);
      swatch.fillCircle(x, swatchY, 18);

      const label = this.add.text(x, labelY, SUIT_LABELS[i], {
        fontSize: "10px",
        color: "#ffffff",
        fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 3,
      }).setOrigin(0.5).setDepth(11);

      const zone = this.add.zone(x, swatchY + 5, 50, 60)
        .setInteractive().setDepth(12).setOrigin(0.5);
      zone.on("pointerdown", () => {
        this.selectedSuit = i;
        this.highlightSuit();
        this.updatePreview();
      });

      this.uiElements.push(bg, swatch, label, zone);
    });

    this.highlightSuit();

    // Confirm button
    const confirmY = Math.round(H * 0.55);
    const scBg = this.add.graphics().setDepth(10);
    scBg.fillStyle(0x2255aa, 0.9);
    scBg.fillRoundedRect(w / 2 - 60, confirmY - 20, 120, 40, 8);
    scBg.lineStyle(2, 0x66aaff);
    scBg.strokeRoundedRect(w / 2 - 60, confirmY - 20, 120, 40, 8);
    const scTxt = this.add.text(w / 2, confirmY, "けってい", {
      fontSize: "16px", color: "#ffffff", fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5).setDepth(11);
    const scZone = this.add.zone(w / 2, confirmY, 120, 40)
      .setInteractive().setDepth(12).setOrigin(0.5);
    scZone.on("pointerdown", () => this.showNameStep());
    this.uiElements.push(scBg, scTxt, scZone);
  }

  private highlightSuit(): void {
    const H = this.scale.height;
    const swatchY = Math.round(H * 0.44);
    const w = this.scale.width;
    const startX = w / 2 - (SUIT_COLORS.length - 1) * 55 / 2;

    let idx = 0;
    for (let i = 0; i < this.uiElements.length - 3; i += 4) {
      const bg = this.uiElements[i] as Phaser.GameObjects.Graphics;
      const x = startX + idx * 55;
      bg.clear();
      if (idx === this.selectedSuit) {
        bg.lineStyle(3, 0x66aaff);
        bg.strokeCircle(x, swatchY, 22);
      }
      idx++;
    }
  }

  private updatePreview(): void {
    // The protagonist is the hand-drawn astronaut, so the preview shows it
    // regardless of the (legacy) suit-color selection.
    if (this.textures.exists("cast-char0-down")) {
      this.previewSprite.setTexture("cast-char0-down");
      return;
    }
    const suitKey = `player-${SUIT_COLORS[this.selectedSuit]}`;
    if (this.textures.exists(suitKey)) {
      const frame = this.textures.getFrame(suitKey, 0);
      if (frame) {
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          frame.source.image as HTMLImageElement,
          frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight,
          0, 0, 16, 16
        );
        const key = "setup-preview";
        if (this.textures.exists(key)) this.textures.remove(key);
        this.textures.addCanvas(key, canvas);
        this.previewSprite.setTexture(key);
      }
    }
  }

  // ---- Step 3: Name ----
  private showNameStep(): void {
    this.step = "name";
    this.clearUI();
    this.promptText.setText("なまえを いれてね");
    this.instructionText.setText("タップして入力  けっていで確定");
    this.playerName = "";
    this.nameText.setVisible(true);
    this.nameText.setText("▌");

    // Create HTML input for mobile keyboard support
    this.createHtmlInput();

    const w = this.scale.width;
    const H = this.scale.height;
    const nameY = Math.round(H * 0.40);
    const confirmY = Math.round(H * 0.50);

    // Tap on name text area to focus the HTML input
    const tapZone = this.add.zone(w / 2, nameY, 240, 50)
      .setInteractive().setDepth(12).setOrigin(0.5);
    tapZone.on("pointerdown", () => {
      if (this.htmlInput) this.htmlInput.focus();
    });
    this.uiElements.push(tapZone);

    // Confirm button
    const okBg = this.add.graphics().setDepth(10);
    okBg.fillStyle(0x2255aa, 0.9);
    okBg.fillRoundedRect(w / 2 - 60, confirmY - 20, 120, 40, 8);
    okBg.lineStyle(2, 0x66aaff);
    okBg.strokeRoundedRect(w / 2 - 60, confirmY - 20, 120, 40, 8);

    const okText = this.add.text(w / 2, confirmY, "けってい", {
      fontSize: "16px",
      color: "#ffffff",
      fontFamily: "'DotGothic16', monospace",
      stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5).setDepth(11);

    const okZone = this.add.zone(w / 2, confirmY, 120, 40)
      .setInteractive().setDepth(12).setOrigin(0.5);
    okZone.on("pointerdown", () => {
      if (this.playerName.length > 0) {
        this.removeHtmlInput();
        this.finishSetup();
      }
    });

    this.uiElements.push(okBg, okText, okZone);
  }

  // ---- HTML Input for mobile keyboard ----
  private createHtmlInput(): void {
    this.removeHtmlInput();

    const canvas = this.game.canvas;
    const parent = canvas.parentElement;
    if (!parent) return;

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 8;
    input.placeholder = "なまえ";
    input.autocomplete = "off";
    input.autocapitalize = "off";
    input.setAttribute("enterkeyhint", "done");

    const H = this.scale.height;
    const nameYRatio = 0.40; // matches nameText position

    // Position over the name text area in the canvas
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / this.scale.width;
    const scaleY = rect.height / H;
    const inputW = 220 * scaleX;
    const inputH = 44 * scaleY;
    const inputX = rect.left + (this.scale.width / 2) * scaleX - inputW / 2;
    const inputY = rect.top + (H * nameYRatio) * scaleY - inputH / 2;

    Object.assign(input.style, {
      position: "fixed",
      left: `${inputX}px`,
      top: `${inputY}px`,
      width: `${inputW}px`,
      height: `${inputH}px`,
      fontSize: `${Math.max(16, 20 * scaleY)}px`,
      textAlign: "center",
      background: "rgba(34, 51, 68, 0.95)",
      color: "#ffffff",
      border: "2px solid #66aaff",
      borderRadius: "8px",
      outline: "none",
      fontFamily: "'DotGothic16', monospace",
      zIndex: "1000",
      caretColor: "#ffffff",
      padding: "0 8px",
      boxSizing: "border-box",
    });

    // Sync input to Phaser text
    input.addEventListener("input", () => {
      this.playerName = input.value.slice(0, 8);
      input.value = this.playerName;
      this.nameText.setText(this.playerName.length > 0 ? this.playerName : "▌");
    });

    // Enter key = confirm
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.playerName.length > 0) {
        this.removeHtmlInput();
        this.finishSetup();
      }
    });

    // Reposition on resize
    const reposition = () => {
      const r = canvas.getBoundingClientRect();
      const sx = r.width / this.scale.width;
      const sy2 = r.height / H;
      const w2 = 220 * sx;
      const h2 = 44 * sy2;
      input.style.left = `${r.left + (this.scale.width / 2) * sx - w2 / 2}px`;
      input.style.top = `${r.top + (H * nameYRatio) * sy2 - h2 / 2}px`;
      input.style.width = `${w2}px`;
      input.style.height = `${h2}px`;
      input.style.fontSize = `${Math.max(16, 20 * sy2)}px`;
    };
    window.addEventListener("resize", reposition);
    (input as unknown as Record<string, unknown>).__resizeHandler = reposition;

    document.body.appendChild(input);
    this.htmlInput = input;

    // Hide Phaser name text (HTML input replaces it visually)
    this.nameText.setVisible(false);

    // Auto-focus after a short delay (helps on mobile)
    setTimeout(() => input.focus(), 150);
  }

  private removeHtmlInput(): void {
    if (this.htmlInput) {
      const handler = (this.htmlInput as unknown as Record<string, unknown>).__resizeHandler;
      if (typeof handler === "function") {
        window.removeEventListener("resize", handler as EventListener);
      }
      this.htmlInput.remove();
      this.htmlInput = null;
    }
  }

  // ---- Input ----
  private handleKeydown(event: KeyboardEvent): void {
    if (this.step === "gender") {
      if (event.key === "ArrowLeft" || event.key === "a") {
        this.selectedGender = "boy";
        this.highlightGender();
      } else if (event.key === "ArrowRight" || event.key === "d") {
        this.selectedGender = "girl";
        this.highlightGender();
      } else if (event.key === "Enter" || event.key === " ") {
        this.showSuitStep();
      }
    } else if (this.step === "suit") {
      if (event.key === "ArrowLeft" || event.key === "a") {
        this.selectedSuit = Math.max(0, this.selectedSuit - 1);
        this.highlightSuit();
        this.updatePreview();
      } else if (event.key === "ArrowRight" || event.key === "d") {
        this.selectedSuit = Math.min(SUIT_COLORS.length - 1, this.selectedSuit + 1);
        this.highlightSuit();
        this.updatePreview();
      } else if (event.key === "Enter" || event.key === " ") {
        this.showNameStep();
      }
    } else if (this.step === "name") {
      // Name input is handled by the HTML input element
    }
  }

  // ---- Finish ----
  private finishSetup(): void {
    this.removeHtmlInput();
    const setup: PlayerSetup = {
      gender: this.selectedGender,
      suitColor: SUIT_COLORS[this.selectedSuit],
      playerName: this.playerName,
    };

    // Save to localStorage
    try {
      localStorage.setItem("usamon-player-setup", JSON.stringify(setup));
    } catch (e) {
      // ignore
    }

    // Generate player frames from selected suit
    this.generatePlayerFrames(setup.suitColor);

    // Transition to game
    this.cameras.main.fadeOut(500, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => {
      // Story starts in the player's own home (序章).
      this.scene.start("MapScene", { mapKey: "player_home" });
    });
  }

  private static DIR_FRAMES: Record<string, [number, number]> = {
    down: [0, 1], up: [4, 5], left: [8, 9], right: [12, 13],
  };

  private generatePlayerFrames(suitColor: string): void {
    const suitKey = `player-${suitColor}`;
    if (!this.textures.exists(suitKey)) return;

    for (const [dir, [f0, f1]] of Object.entries(SetupScene.DIR_FRAMES)) {
      for (let i = 0; i < 2; i++) {
        const srcFrame = this.textures.getFrame(suitKey, i === 0 ? f0 : f1);
        if (!srcFrame) continue;
        const canvas = document.createElement("canvas");
        canvas.width = 32; canvas.height = 32;
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          srcFrame.source.image as HTMLImageElement,
          srcFrame.cutX, srcFrame.cutY, srcFrame.cutWidth, srcFrame.cutHeight,
          0, 0, 32, 32
        );
        const key = `player-${dir}-${i}`;
        if (this.textures.exists(key)) this.textures.remove(key);
        this.textures.addCanvas(key, canvas);
      }
    }
    // Legacy compat
    for (let i = 0; i < 2; i++) {
      const key = `player-frame-${i}`;
      if (this.textures.exists(key)) this.textures.remove(key);
      const src = this.textures.get(`player-down-${i}`).getSourceImage() as HTMLCanvasElement;
      this.textures.addCanvas(key, src);
    }
  }
}
