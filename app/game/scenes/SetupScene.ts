import * as Phaser from "phaser";

interface PlayerSetup {
  gender: "boy" | "girl";
  suitColor: string;
  playerName: string;
}

const SUIT_COLORS = ["white", "blue", "orange", "pink", "black"];
const SUIT_LABELS = ["ホワイト", "ブルー", "オレンジ", "ピンク", "ブラック"];
const SUIT_HEX = ["#e0e0e8", "#6488d0", "#e8a850", "#e0a0c0", "#505058"];

const MAX_NAME_LENGTH = 8;

// Name-input character pages (Pokémon style): ひらがな / カタカナ / 英数字
interface KanaPage {
  label: string; // shown on the mode-switch cell as「→ラベル」
  rows: string[][];
}
const KANA_PAGES: KanaPage[] = [
  {
    label: "かな",
    rows: [
      ["あ", "い", "う", "え", "お", "か", "き", "く", "け", "こ"],
      ["さ", "し", "す", "せ", "そ", "た", "ち", "つ", "て", "と"],
      ["な", "に", "ぬ", "ね", "の", "は", "ひ", "ふ", "へ", "ほ"],
      ["ま", "み", "む", "め", "も", "や", "ゆ", "よ", "ら", "り"],
      ["る", "れ", "ろ", "わ", "を", "ん", "ー", "・", "", ""],
    ],
  },
  {
    label: "カナ",
    rows: [
      ["ア", "イ", "ウ", "エ", "オ", "カ", "キ", "ク", "ケ", "コ"],
      ["サ", "シ", "ス", "セ", "ソ", "タ", "チ", "ツ", "テ", "ト"],
      ["ナ", "ニ", "ヌ", "ネ", "ノ", "ハ", "ヒ", "フ", "ヘ", "ホ"],
      ["マ", "ミ", "ム", "メ", "モ", "ヤ", "ユ", "ヨ", "ラ", "リ"],
      ["ル", "レ", "ロ", "ワ", "ヲ", "ン", "ー", "・", "", ""],
    ],
  },
  {
    label: "英数",
    rows: [
      ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
      ["K", "L", "M", "N", "O", "P", "Q", "R", "S", "T"],
      ["U", "V", "W", "X", "Y", "Z", "!", "?", "-", "."],
      ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
    ],
  },
];
// Control row:「小」is also the case toggle (A↔a) on the 英数 page,
// and「モード」cycles pages (its label shows the NEXT page, e.g.「→カナ」)
const CONTROL_ROW = ["゛", "゜", "小", "けす", "モード", "おわり"];
const CTRL_MODE = 4;

// Toggle maps for diacritics / small kana (applied to the last input char)
const DAKUTEN_MAP: Record<string, string> = {
  か: "が", き: "ぎ", く: "ぐ", け: "げ", こ: "ご",
  さ: "ざ", し: "じ", す: "ず", せ: "ぜ", そ: "ぞ",
  た: "だ", ち: "ぢ", つ: "づ", て: "で", と: "ど",
  は: "ば", ひ: "び", ふ: "ぶ", へ: "べ", ほ: "ぼ",
  う: "ゔ",
  カ: "ガ", キ: "ギ", ク: "グ", ケ: "ゲ", コ: "ゴ",
  サ: "ザ", シ: "ジ", ス: "ズ", セ: "ゼ", ソ: "ゾ",
  タ: "ダ", チ: "ヂ", ツ: "ヅ", テ: "デ", ト: "ド",
  ハ: "バ", ヒ: "ビ", フ: "ブ", ヘ: "ベ", ホ: "ボ",
  ウ: "ヴ",
};
const HANDAKUTEN_MAP: Record<string, string> = {
  は: "ぱ", ひ: "ぴ", ふ: "ぷ", へ: "ぺ", ほ: "ぽ",
  ハ: "パ", ヒ: "ピ", フ: "プ", ヘ: "ペ", ホ: "ポ",
};
const SMALL_MAP: Record<string, string> = {
  あ: "ぁ", い: "ぃ", う: "ぅ", え: "ぇ", お: "ぉ",
  や: "ゃ", ゆ: "ゅ", よ: "ょ", つ: "っ", わ: "ゎ",
  ア: "ァ", イ: "ィ", ウ: "ゥ", エ: "ェ", オ: "ォ",
  ヤ: "ャ", ユ: "ュ", ヨ: "ョ", ツ: "ッ", ワ: "ヮ",
};

function toggleByMap(ch: string, map: Record<string, string>): string | null {
  if (map[ch]) return map[ch];
  for (const [plain, marked] of Object.entries(map)) {
    if (marked === ch) return plain;
  }
  return null;
}

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

  // Gamepad polling state
  private prevDpad: string | null = null;
  private dpadHeldMs = 0;

  private finished = false;

  // Kana grid state (name step)
  private kanaPage = 0;
  private kanaCursorRow = 0;
  private kanaCursorCol = 0;
  private kanaCursorGfx: Phaser.GameObjects.Graphics | null = null;
  private kanaCellPos: { x: number; y: number; w: number; h: number }[][] = [];

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

    // Clear stale gamepad presses carried over from a previous scene
    if (typeof window !== "undefined" && (window as unknown as { __gamepad?: { dpad: string | null; aJust: boolean; bJust: boolean; menuJust: boolean } }).__gamepad) {
      const gp = (window as unknown as { __gamepad: { dpad: string | null; aJust: boolean; bJust: boolean; menuJust: boolean } }).__gamepad;
      gp.aJust = false; gp.bJust = false; gp.menuJust = false;
    }
    this.prevDpad = null;
    this.dpadHeldMs = 0;
    this.finished = false;

    this.showGenderStep();

    // Keyboard input
    if (this.input.keyboard) {
      this.input.keyboard.on("keydown", (event: KeyboardEvent) => {
        this.handleKeydown(event);
      });
    }
  }

  // Poll the on-screen gamepad every frame (same pattern as MapScene)
  update(_time: number, delta: number): void {
    if (this.finished) return;
    if (typeof window === "undefined") return;
    const gp = (window as unknown as { __gamepad?: { dpad: string | null; aJust: boolean; bJust: boolean; menuJust: boolean } }).__gamepad;
    if (!gp) return;

    let a = false;
    let b = false;
    if (gp.aJust) { a = true; gp.aJust = false; }
    if (gp.bJust) { b = true; gp.bJust = false; }

    // D-pad edge detection + hold-to-repeat (for the kana grid)
    let dir: string | null = null;
    if (gp.dpad) {
      if (gp.dpad !== this.prevDpad) {
        dir = gp.dpad;
        this.dpadHeldMs = 0;
      } else {
        this.dpadHeldMs += delta;
        if (this.dpadHeldMs > 350) {
          dir = gp.dpad;
          this.dpadHeldMs = 350 - 130; // repeat every ~130ms
        }
      }
    } else {
      this.dpadHeldMs = 0;
    }
    this.prevDpad = gp.dpad;

    if (this.step === "gender") {
      if (dir === "left") { this.selectedGender = "boy"; this.highlightGender(); }
      else if (dir === "right") { this.selectedGender = "girl"; this.highlightGender(); }
      if (a) this.showSuitStep();
    } else if (this.step === "suit") {
      if (dir === "left") {
        this.selectedSuit = Math.max(0, this.selectedSuit - 1);
        this.highlightSuit();
        this.updatePreview();
      } else if (dir === "right") {
        this.selectedSuit = Math.min(SUIT_COLORS.length - 1, this.selectedSuit + 1);
        this.highlightSuit();
        this.updatePreview();
      }
      if (a) this.showNameStep();
      else if (b) this.showGenderStep();
    } else if (this.step === "name") {
      if (dir) this.moveKanaCursor(dir);
      if (a) this.activateKanaCell();
      else if (b) this.deleteNameChar();
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
    this.instructionText.setText("←→で えらんで Aボタンで けってい");
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
    this.instructionText.setText("←→で えらんで A:けってい B:もどる");
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

  // ---- Step 3: Name (kana grid, Pokémon style) ----
  private showNameStep(): void {
    this.step = "name";
    this.clearUI();
    this.promptText.setText("なまえを いれてね");
    this.instructionText.setText("十字キーで えらぶ A:いれる B:けす");
    this.playerName = "";
    this.nameText.setVisible(true);
    this.updateNameDisplay();

    this.kanaPage = 0;
    this.kanaCursorRow = 0;
    this.kanaCursorCol = 0;
    this.buildKanaGrid();
    this.drawKanaCursor();
  }

  private pageRows(): string[][] {
    return KANA_PAGES[this.kanaPage].rows;
  }

  private buildKanaGrid(): void {
    const w = this.scale.width;   // 640
    const H = this.scale.height;

    this.kanaCellPos = [];

    const gridTop = Math.round(H * 0.46);
    const cellW = 56;
    const cellH = Math.max(40, Math.min(52, Math.round(H * 0.055)));
    const startX = (w - cellW * 10) / 2;
    const rows = this.pageRows();

    // Character rows (10 cols x 4-5 rows depending on page)
    rows.forEach((row, r) => {
      const rowPos: { x: number; y: number; w: number; h: number }[] = [];
      row.forEach((ch, c) => {
        const cx = startX + c * cellW + cellW / 2;
        const cy = gridTop + r * cellH + cellH / 2;
        rowPos.push({ x: cx, y: cy, w: cellW, h: cellH });
        if (ch === "") return;

        const bg = this.add.graphics().setDepth(10);
        bg.fillStyle(0x223344, 0.7);
        bg.fillRoundedRect(cx - cellW / 2 + 2, cy - cellH / 2 + 2, cellW - 4, cellH - 4, 6);
        const text = this.add.text(cx, cy, ch, {
          fontSize: "20px",
          color: "#ffffff",
          fontFamily: "'DotGothic16', monospace",
          stroke: "#000000", strokeThickness: 3,
        }).setOrigin(0.5).setDepth(11);

        // Tapping a cell also works: move cursor there and input
        const zone = this.add.zone(cx, cy, cellW, cellH)
          .setInteractive().setDepth(12).setOrigin(0.5);
        zone.on("pointerdown", () => {
          this.kanaCursorRow = r;
          this.kanaCursorCol = c;
          this.drawKanaCursor();
          this.activateKanaCell();
        });
        this.uiElements.push(bg, text, zone);
      });
      this.kanaCellPos.push(rowPos);
    });

    // Control row (6 wide cells)
    const ctrlW = 100;
    const ctrlStartX = (w - ctrlW * CONTROL_ROW.length) / 2;
    const ctrlY = gridTop + rows.length * cellH + Math.round(cellH * 0.25) + cellH / 2;
    const ctrlPos: { x: number; y: number; w: number; h: number }[] = [];
    const nextPageLabel = KANA_PAGES[(this.kanaPage + 1) % KANA_PAGES.length].label;
    CONTROL_ROW.forEach((label, c) => {
      const cx = ctrlStartX + c * ctrlW + ctrlW / 2;
      ctrlPos.push({ x: cx, y: ctrlY, w: ctrlW, h: cellH });

      const isDone = label === "おわり";
      const isMode = c === CTRL_MODE;
      const display = isMode ? `→${nextPageLabel}` : label;
      const bg = this.add.graphics().setDepth(10);
      bg.fillStyle(isDone ? 0x2255aa : isMode ? 0x225544 : 0x223344, isDone || isMode ? 0.9 : 0.7);
      bg.fillRoundedRect(cx - ctrlW / 2 + 3, ctrlY - cellH / 2 + 2, ctrlW - 6, cellH - 4, 6);
      if (isDone) {
        bg.lineStyle(2, 0x66aaff);
        bg.strokeRoundedRect(cx - ctrlW / 2 + 3, ctrlY - cellH / 2 + 2, ctrlW - 6, cellH - 4, 6);
      } else if (isMode) {
        bg.lineStyle(2, 0x66ccaa);
        bg.strokeRoundedRect(cx - ctrlW / 2 + 3, ctrlY - cellH / 2 + 2, ctrlW - 6, cellH - 4, 6);
      }
      const text = this.add.text(cx, ctrlY, display, {
        fontSize: "16px",
        color: "#ffffff",
        fontFamily: "'DotGothic16', monospace",
        stroke: "#000000", strokeThickness: 3,
      }).setOrigin(0.5).setDepth(11);

      const zone = this.add.zone(cx, ctrlY, ctrlW, cellH)
        .setInteractive().setDepth(12).setOrigin(0.5);
      zone.on("pointerdown", () => {
        this.kanaCursorRow = rows.length;
        this.kanaCursorCol = c;
        this.drawKanaCursor();
        this.activateKanaCell();
      });
      this.uiElements.push(bg, text, zone);
    });
    this.kanaCellPos.push(ctrlPos);

    // Cursor graphics (drawn on top of cells)
    this.kanaCursorGfx = this.add.graphics().setDepth(13);
    this.uiElements.push(this.kanaCursorGfx);
  }

  private drawKanaCursor(): void {
    if (!this.kanaCursorGfx) return;
    const pos = this.kanaCellPos[this.kanaCursorRow]?.[this.kanaCursorCol];
    if (!pos) return;
    this.kanaCursorGfx.clear();
    this.kanaCursorGfx.lineStyle(3, 0xffdd44);
    this.kanaCursorGfx.strokeRoundedRect(
      pos.x - pos.w / 2 + 1, pos.y - pos.h / 2 + 1, pos.w - 2, pos.h - 2, 6
    );
  }

  private isEmptyKanaCell(row: number, col: number): boolean {
    const rows = this.pageRows();
    return row < rows.length && (rows[row][col] ?? "") === "";
  }

  /** Step left from col until a non-empty cell is found */
  private snapToFilled(row: number, col: number): number {
    let c = col;
    while (c > 0 && this.isEmptyKanaCell(row, c)) c--;
    return c;
  }

  private moveKanaCursor(dir: string): void {
    const rows = this.pageRows();
    const lastKanaRow = rows.length - 1;
    const ctrlRow = rows.length;
    const ctrlCols = CONTROL_ROW.length;
    let r = this.kanaCursorRow;
    let c = this.kanaCursorCol;

    if (dir === "left" || dir === "right") {
      const cols = r === ctrlRow ? ctrlCols : 10;
      const step = dir === "left" ? -1 : 1;
      do {
        c = (c + step + cols) % cols;
      } while (this.isEmptyKanaCell(r, c));
    } else if (dir === "up") {
      if (r === ctrlRow) {
        // Control row → bottom kana row (map wide cells onto 10 cols)
        r = lastKanaRow;
        c = this.snapToFilled(r, Math.min(9, Math.floor((c * 10) / ctrlCols)));
      } else if (r > 0) {
        r--;
        c = this.snapToFilled(r, c);
      } else {
        r = ctrlRow;
        c = Math.min(ctrlCols - 1, Math.floor((c * ctrlCols) / 10));
      }
    } else if (dir === "down") {
      if (r === ctrlRow) {
        r = 0;
        c = this.snapToFilled(r, c === 0 ? 0 : Math.min(9, Math.floor((c * 10) / ctrlCols)));
      } else if (r < lastKanaRow) {
        r++;
        c = this.snapToFilled(r, c);
      } else {
        r = ctrlRow;
        c = Math.min(ctrlCols - 1, Math.floor((c * ctrlCols) / 10));
      }
    }

    this.kanaCursorRow = r;
    this.kanaCursorCol = c;
    this.drawKanaCursor();
  }

  private switchKanaPage(): void {
    this.kanaPage = (this.kanaPage + 1) % KANA_PAGES.length;
    // Rebuild the grid; keep the cursor on the mode cell so repeated
    // presses cycle pages comfortably
    this.clearUI();
    this.buildKanaGrid();
    this.kanaCursorRow = this.pageRows().length;
    this.kanaCursorCol = CTRL_MODE;
    this.drawKanaCursor();
  }

  private activateKanaCell(): void {
    const rows = this.pageRows();
    const r = this.kanaCursorRow;
    const c = this.kanaCursorCol;

    if (r < rows.length) {
      const ch = rows[r][c];
      if (ch && this.playerName.length < MAX_NAME_LENGTH) {
        this.playerName += ch;
        this.updateNameDisplay();
      }
      return;
    }

    // Control row
    const action = CONTROL_ROW[Math.min(c, CONTROL_ROW.length - 1)];
    if (action === "゛" || action === "゜" || action === "小") {
      if (this.playerName.length === 0) return;
      const last = this.playerName[this.playerName.length - 1];
      let replaced: string | null = null;
      if (action === "小" && /[A-Za-z]/.test(last)) {
        // On the alphanumeric page,「小」toggles letter case
        replaced = last === last.toLowerCase() ? last.toUpperCase() : last.toLowerCase();
      } else {
        const map = action === "゛" ? DAKUTEN_MAP : action === "゜" ? HANDAKUTEN_MAP : SMALL_MAP;
        replaced = toggleByMap(last, map);
      }
      if (replaced) {
        this.playerName = this.playerName.slice(0, -1) + replaced;
        this.updateNameDisplay();
      }
    } else if (action === "けす") {
      this.deleteNameChar();
    } else if (action === "モード") {
      this.switchKanaPage();
    } else if (action === "おわり") {
      if (this.playerName.length > 0) this.finishSetup();
    }
  }

  private deleteNameChar(): void {
    if (this.playerName.length > 0) {
      this.playerName = this.playerName.slice(0, -1);
      this.updateNameDisplay();
    }
  }

  private updateNameDisplay(): void {
    this.nameText.setText(this.playerName.length > 0 ? this.playerName : "▌");
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
      if (event.key === "ArrowLeft") this.moveKanaCursor("left");
      else if (event.key === "ArrowRight") this.moveKanaCursor("right");
      else if (event.key === "ArrowUp") this.moveKanaCursor("up");
      else if (event.key === "ArrowDown") this.moveKanaCursor("down");
      else if (event.key === "Enter" || event.key === " ") this.activateKanaCell();
      else if (event.key === "Backspace") this.deleteNameChar();
      else if (/^[A-Za-z0-9!?.-]$/.test(event.key) && this.playerName.length < MAX_NAME_LENGTH) {
        // Direct typing of alphanumerics from a physical keyboard
        this.playerName += event.key;
        this.updateNameDisplay();
      }
    }
  }

  // ---- Finish ----
  private finishSetup(): void {
    if (this.finished) return;
    this.finished = true;
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
      // Story starts in the player's own home with the wake-up cutscene (序章).
      this.scene.start("MapScene", { mapKey: "player_home", intro: true });
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
