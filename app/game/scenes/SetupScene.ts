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
  private step: "gender" | "name" = "gender";
  private selectedGender: "boy" | "girl" = "boy";
  private selectedSuit = 0;
  private playerName = "";
  private previewSprite!: Phaser.GameObjects.Image;
  private nameText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private instructionText!: Phaser.GameObjects.Text;
  private uiElements: Phaser.GameObjects.GameObject[] = [];

  // Gender step: 5-頭身 illustrations
  private genderImgs: Phaser.GameObjects.Image[] = [];
  private genderFrames: Phaser.GameObjects.Graphics[] = [];

  // When launched from the title screen's せってい, editing returns to the title
  // and does NOT wipe the save or restart the prologue.
  private settingsMode = false;

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

    // Character preview (center) — hidden during the gender step (illustrations
    // replace it) and the name step (kana grid needs the room).
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
      if (a) this.showNameStep();
      else if (b && this.settingsMode) this.backToTitle();
    } else if (this.step === "name") {
      if (dir) this.moveKanaCursor(dir);
      if (a) this.activateKanaCell();
      else if (b) this.deleteNameChar();
    }
  }

  private backToTitle(): void {
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
    this.instructionText.setText(this.settingsMode ? "←→で えらんで A:けってい B:もどる" : "←→で えらんで Aボタンで けってい");
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

  // ---- Step 2: Name (kana grid, Pokémon style) ----
  private showNameStep(): void {
    this.step = "name";
    this.clearUI();
    this.promptText.setText("なまえを いれてね");
    this.instructionText.setText("十字キーで えらぶ A:いれる B:けす");
    this.previewSprite.setVisible(false);
    if (!this.settingsMode) this.playerName = "";
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
