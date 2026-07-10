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
  private step: "gender" | "name" = "gender";
  private selectedGender: "boy" | "girl" = "boy";
  private selectedSuit = 0;
  private playerName = "";
  private previewSprite!: Phaser.GameObjects.Image;
  private nameText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private instructionText!: Phaser.GameObjects.Text;
  private uiElements: Phaser.GameObjects.GameObject[] = [];
  private genderImgs: Phaser.GameObjects.Image[] = [];
  private genderFrames: Phaser.GameObjects.Graphics[] = [];
  private htmlInput: HTMLInputElement | null = null;
  // When launched from the title screen's せってい, editing returns to the title
  // and does NOT wipe the save or restart the prologue.
  private settingsMode = false;

  constructor() {
    super({ key: "SetupScene" });
  }

  init(data: { settingsMode?: boolean }): void {
    this.settingsMode = !!data?.settingsMode;
    // Prefill the current character setup so せってい starts from existing values.
    this.selectedGender = "boy";
    this.selectedSuit = 0;
    this.playerName = "";
    if (this.settingsMode) {
      try {
        const setup = JSON.parse(localStorage.getItem("usamon-player-setup") || "{}");
        if (setup.gender === "boy" || setup.gender === "girl") this.selectedGender = setup.gender;
        const si = SUIT_COLORS.indexOf(setup.suitColor);
        if (si >= 0) this.selectedSuit = si;
        if (typeof setup.playerName === "string") this.playerName = setup.playerName;
      } catch { /* ignore */ }
    }
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

  update(): void {
    if (!this.settingsMode) return;
    const gp = typeof window !== "undefined" ? (window as unknown as { __gamepad?: { bJust: boolean } }).__gamepad : null;
    if (gp && gp.bJust) { gp.bJust = false; this.backToTitle(); }
  }

  private backToTitle(): void {
    this.removeHtmlInput();
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => this.scene.start("TitleScene"));
  }

  private clearUI(): void {
    this.uiElements.forEach((el) => el.destroy());
    this.uiElements = [];
  }

  // ---- Step 1: Gender (5-頭身 illustrations) ----
  private showGenderStep(): void {
    this.step = "gender";
    this.clearUI();
    this.promptText.setText("せいべつを えらんでね");
    this.instructionText.setText("← → で選択  けってい で決定");
    this.nameText.setVisible(false);
    this.previewSprite.setVisible(false);

    const w = this.scale.width;
    const H = this.scale.height;
    const cy = Math.round(H * 0.44);
    const targetH = Math.round(H * 0.42);
    const opts = [
      { key: "select-boy", value: "boy" as const, label: "おとこのこ", x: w / 2 - 108 },
      { key: "select-girl", value: "girl" as const, label: "おんなのこ", x: w / 2 + 108 },
    ];

    this.genderImgs = [];
    this.genderFrames = [];
    opts.forEach((opt) => {
      const frame = this.add.graphics().setDepth(10);
      const img = this.add.image(
        opt.x, cy, this.textures.exists(opt.key) ? opt.key : "player-frame-0"
      ).setDepth(11);
      if (img.height) img.setScale(targetH / img.height);
      const lbl = this.add.text(opt.x, cy + targetH / 2 + 24, opt.label, {
        fontSize: "16px", color: "#ffffff", fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 3,
      }).setOrigin(0.5).setDepth(11);
      const zone = this.add.zone(opt.x, cy, Math.max(120, img.displayWidth + 24), targetH + 24)
        .setInteractive().setDepth(12).setOrigin(0.5);
      zone.on("pointerdown", () => { this.selectedGender = opt.value; this.highlightGender(); });
      this.genderImgs.push(img);
      this.genderFrames.push(frame);
      this.uiElements.push(frame, img, lbl, zone);
    });

    this.highlightGender();

    // Confirm button → straight to the name step (suit-color step removed)
    const confirmY = Math.round(H * 0.86);
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
    gZone.on("pointerdown", () => this.showNameStep());
    this.uiElements.push(gBg, gTxt, gZone);
  }

  private highlightGender(): void {
    const w = this.scale.width;
    const H = this.scale.height;
    const cy = Math.round(H * 0.44);
    const xs = [w / 2 - 108, w / 2 + 108];
    this.genderFrames.forEach((frame, idx) => {
      const img = this.genderImgs[idx];
      const hw = img.displayWidth / 2 + 12;
      const hh = img.displayHeight / 2 + 12;
      const sel = (idx === 0 && this.selectedGender === "boy") ||
                  (idx === 1 && this.selectedGender === "girl");
      frame.clear();
      if (sel) {
        frame.fillStyle(0x2255aa, 0.35);
        frame.fillRoundedRect(xs[idx] - hw, cy - hh, hw * 2, hh * 2, 10);
        frame.lineStyle(3, 0x66aaff);
        frame.strokeRoundedRect(xs[idx] - hw, cy - hh, hw * 2, hh * 2, 10);
        img.setAlpha(1);
      } else {
        frame.lineStyle(1, 0x445566);
        frame.strokeRoundedRect(xs[idx] - hw, cy - hh, hw * 2, hh * 2, 10);
        img.setAlpha(0.55);
      }
    });
  }

  // ---- Step 3: Name ----
  private showNameStep(): void {
    this.step = "name";
    this.clearUI();
    this.promptText.setText("なまえを いれてね");
    this.instructionText.setText(this.settingsMode ? "タップして入力  Bボタンでもどる" : "タップして入力  けっていで確定");
    if (!this.settingsMode) this.playerName = "";
    this.nameText.setVisible(true);
    this.nameText.setText(this.playerName.length > 0 ? this.playerName : "▌");

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
    if (this.playerName) input.value = this.playerName;

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
    if (this.settingsMode && event.key === "Escape") { this.backToTitle(); return; }
    if (this.step === "gender") {
      if (event.key === "ArrowLeft" || event.key === "a") {
        this.selectedGender = "boy";
        this.highlightGender();
      } else if (event.key === "ArrowRight" || event.key === "d") {
        this.selectedGender = "girl";
        this.highlightGender();
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
      // Suit-colour selection was removed; the boy uses a fixed white suit and
      // the girl her own art. Kept in the type for save-compat.
      suitColor: "white",
      playerName: this.playerName,
    };

    // Save to localStorage
    try {
      localStorage.setItem("usamon-player-setup", JSON.stringify(setup));
    } catch (e) {
      // ignore
    }

    // Build the overworld walk frames for the chosen gender
    this.generatePlayerFrames(setup.gender);

    // Transition
    this.cameras.main.fadeOut(500, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => {
      if (this.settingsMode) {
        // Just updating settings: return to the title screen, save intact.
        this.scene.start("TitleScene");
      } else {
        // Story starts in the player's own home with the wake-up cutscene (序章).
        this.scene.start("MapScene", { mapKey: "player_home", intro: true });
      }
    });
  }

  private static DIR_FRAMES: Record<string, [number, number]> = {
    down: [0, 1], up: [4, 5], left: [8, 9], right: [12, 13],
  };

  private generatePlayerFrames(gender: "boy" | "girl"): void {
    if (gender === "girl") {
      // Girl: build frames from her overworld directions (frame 1 bobs up 1px).
      for (const dir of ["down", "up", "left", "right"]) {
        const srcKey = `player-girl-${dir}`;
        if (!this.textures.exists(srcKey)) continue;
        const img = this.textures.get(srcKey).getSourceImage() as HTMLImageElement;
        for (let i = 0; i < 2; i++) {
          const canvas = document.createElement("canvas");
          canvas.width = 32; canvas.height = 32;
          const ctx = canvas.getContext("2d")!;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, 0, i === 1 ? -1 : 0, 32, 32);
          const key = `player-${dir}-${i}`;
          if (this.textures.exists(key)) this.textures.remove(key);
          this.textures.addCanvas(key, canvas);
        }
      }
    } else {
      const suitKey = "player-white";
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
    }
    // Legacy compat: player-frame-0/1 = down-0/1
    for (let i = 0; i < 2; i++) {
      const key = `player-frame-${i}`;
      const srcKey = `player-down-${i}`;
      if (!this.textures.exists(srcKey)) continue;
      if (this.textures.exists(key)) this.textures.remove(key);
      this.textures.addCanvas(key, this.textures.get(srcKey).getSourceImage() as HTMLCanvasElement);
    }
  }
}
