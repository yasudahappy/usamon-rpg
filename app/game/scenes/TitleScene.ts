import * as Phaser from "phaser";

const F = "'DotGothic16', monospace";

interface SaveReport {
  name: string;
  playSeconds: number;
  caught: number;
  trainers: number;
  hasSave: boolean;
}

// Boot-time title / continue screen (ポケモン風のつづき画面).
// Shown when a saved game (レポート) exists. Options:
//   0: つづきから はじめる  — resume from the save (shows a report panel)
//   1: さいしょから はじめる — wipe the save after a confirmation, then re-create
//   2: せっていを かえる     — re-open character setup without touching the save
export class TitleScene extends Phaser.Scene {
  private sel = 0;
  private page: "start" | "menu" | "confirm" = "start";
  private prevDpad: string | null = null;
  private els: Phaser.GameObjects.GameObject[] = [];
  private report!: SaveReport;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyEnter?: Phaser.Input.Keyboard.Key;
  private keySpace?: Phaser.Input.Keyboard.Key;
  private keyEsc?: Phaser.Input.Keyboard.Key;
  private busy = false;

  constructor() {
    super({ key: "TitleScene" });
  }

  create(): void {
    this.sel = 0;
    this.page = "start";
    this.prevDpad = null;
    this.busy = false;
    this.report = this.loadReport();

    const W = this.scale.width;
    const H = this.scale.height;

    // Dark base so any letterboxing reads as space, not white.
    this.add.rectangle(0, 0, W, H, 0x080b18).setOrigin(0).setDepth(0);

    // Key art, scaled to COVER the canvas and centred.
    if (this.textures.exists("title-art")) {
      const src = this.textures.get("title-art").getSourceImage() as { width: number; height: number };
      const scale = Math.max(W / src.width, H / src.height);
      this.add.image(W / 2, H / 2, "title-art").setOrigin(0.5).setScale(scale).setDepth(1);
    } else {
      // Fallback title text if the art failed to load.
      this.add.text(W / 2, H * 0.16, "うさもんの大冒険", {
        fontSize: "34px", color: "#ffffff", fontFamily: F, fontStyle: "bold",
        stroke: "#000000", strokeThickness: 4,
      }).setOrigin(0.5).setDepth(2);
    }

    // Input
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.keyEnter = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
      this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      this.keyEsc = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    }

    this.cameras.main.fadeIn(320, 0, 0, 0);
    this.drawStart();
  }

  // ---- Page 1: title thumbnail + START button ----
  private drawStart(): void {
    this.clearEls();
    this.page = "start";
    const W = this.scale.width;
    const H = this.scale.height;

    // Light scrim just behind the button so it stays readable over the art.
    const g = this.add.graphics().setDepth(9);
    g.fillStyle(0x05070f, 0.42);
    g.fillRect(0, Math.round(H * 0.72), W, Math.round(H * 0.28));
    this.els.push(g);

    const bw = 220, bh = 58;
    const bx = W / 2 - bw / 2;
    const by = Math.round(H * 0.80);
    const btn = this.add.graphics().setDepth(10);
    btn.fillStyle(0x11326a, 0.95);
    btn.fillRoundedRect(bx, by, bw, bh, 14);
    btn.lineStyle(3, 0x8fd0ff);
    btn.strokeRoundedRect(bx, by, bw, bh, 14);
    this.els.push(btn);

    this.mkText(W / 2, by + bh / 2, "▶ スタート", 24, "#ffffff", 0.5).setStyle({ fontStyle: "bold" });
    const hint = this.mkText(W / 2, by + bh + 26, "おして はじめる", 13, "#cfe0f5", 0.5);
    this.tweens.add({ targets: hint, alpha: 0.25, duration: 750, yoyo: true, repeat: -1, ease: "Sine.inOut" });

    const zone = this.add.zone(bx, by, bw, bh).setOrigin(0, 0).setInteractive().setDepth(12);
    zone.on("pointerdown", () => this.gotoMenu());
    this.els.push(zone);
  }

  private gotoMenu(): void {
    if (this.busy) return;
    this.sel = this.report.hasSave ? 0 : 1;   // skip greyed-out つづき when no save
    this.drawMenu();
  }

  // ---- Data ----
  private loadReport(): SaveReport {
    let name = "???";
    let playSeconds = 0;
    let caught = 0;
    let trainers = 0;
    let hasSave = false;
    try {
      const setup = JSON.parse(localStorage.getItem("usamon-player-setup") || "{}");
      if (setup.playerName) name = setup.playerName;
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem("usamon-save-data");
      if (raw) {
        hasSave = true;
        const s = JSON.parse(raw);
        const ps = s.playerState || {};
        playSeconds = ps.playSeconds || 0;
        const ids = new Set<string>();
        (ps.party || []).forEach((m: { dataId: string }) => ids.add(m.dataId));
        (ps.box || []).forEach((m: { dataId: string }) => ids.add(m.dataId));
        caught = ids.size;
        trainers = (ps.defeatedTrainers || []).length;
      }
    } catch { /* ignore */ }
    return { name, playSeconds, caught, trainers, hasSave };
  }

  private formatTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}:${String(m).padStart(2, "0")}`;
  }

  // ---- Rendering ----
  private clearEls(): void {
    this.els.forEach(e => e.destroy());
    this.els = [];
  }

  private mkText(x: number, y: number, s: string, size: number, color: string, origin = 0): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, s, {
      fontSize: `${size}px`, color, fontFamily: F, stroke: "#000000", strokeThickness: 3,
    }).setDepth(11).setResolution(2);
    t.setOrigin(origin, 0.5);
    this.els.push(t);
    return t;
  }

  private drawMenu(): void {
    this.clearEls();
    this.page = "menu";
    const W = this.scale.width;
    const H = this.scale.height;

    // Scrim over the lower portion so the menu text stays readable over the art.
    const scrim = this.add.graphics().setDepth(9);
    scrim.fillStyle(0x05070f, 0.62);
    scrim.fillRect(0, H * 0.52, W, H * 0.48);
    scrim.fillStyle(0x05070f, 0.35);
    scrim.fillRect(0, H * 0.46, W, H * 0.06);
    this.els.push(scrim);

    const margin = 44;
    const boxX = margin;
    const boxW = W - margin * 2;
    const contH = 132;
    const rowH = 50;
    const gap = 14;
    const totalH = contH + gap + rowH + gap + rowH;
    const startY = Math.round(H - totalH - 30);

    const rects = [
      { y: startY, h: contH },
      { y: startY + contH + gap, h: rowH },
      { y: startY + contH + gap + rowH + gap, h: rowH },
    ];

    // Boxes + highlight
    const g = this.add.graphics().setDepth(10);
    this.els.push(g);
    rects.forEach((r, i) => {
      const on = i === this.sel;
      g.fillStyle(on ? 0x11326a : 0x0d1a33, on ? 0.94 : 0.86);
      g.fillRoundedRect(boxX, r.y, boxW, r.h, 10);
      g.lineStyle(on ? 3 : 2, on ? 0x8fd0ff : 0x3a5680);
      g.strokeRoundedRect(boxX, r.y, boxW, r.h, 10);
      // selection caret
      if (on) {
        g.fillStyle(0x8fd0ff, 1);
        const cy = r.y + (i === 0 ? 22 : r.h / 2);
        g.fillTriangle(boxX + 12, cy - 8, boxX + 12, cy + 8, boxX + 24, cy);
      }
    });

    // --- Continue box contents (report) ---
    const c = rects[0];
    const leftX = boxX + 34;
    const rightX = boxX + Math.round(boxW * 0.52);
    const r = this.report;
    if (r.hasSave) {
      this.mkText(leftX, c.y + 24, "つづきから はじめる", 21, this.sel === 0 ? "#ffffff" : "#d6e4f5").setStyle({ fontStyle: "bold" });
      const t = this.formatTime(r.playSeconds);
      this.mkText(leftX, c.y + 62, `しゅじんこう  ${r.name}`, 15, "#c9d8ec");
      this.mkText(rightX, c.y + 62, `プレイじかん  ${t}`, 15, "#c9d8ec");
      this.mkText(leftX, c.y + 92, `ずかん  ${r.caught} しゅるい`, 15, "#c9d8ec");
      this.mkText(rightX, c.y + 92, `トレーナー  ${r.trainers} 人`, 15, "#c9d8ec");
    } else {
      // No save yet: greyed-out, not selectable.
      this.mkText(leftX, c.y + 24, "つづきから はじめる", 21, "#5b6a80").setStyle({ fontStyle: "bold" });
      this.mkText(leftX, c.y + 74, "きろくが ありません", 15, "#7a8aa0");
    }

    // --- New game / settings rows ---
    this.mkText(boxX + 34, rects[1].y + rects[1].h / 2, "さいしょから はじめる", 18, this.sel === 1 ? "#ffffff" : "#d6e4f5");
    this.mkText(boxX + 34, rects[2].y + rects[2].h / 2, "せっていを かえる", 18, this.sel === 2 ? "#ffffff" : "#d6e4f5");

    // Footer hint
    this.mkText(W / 2, H - 14, "▲▼でせんたく  Aボタンできめる", 12, "#9fb4cc", 0.5);

    // Tap zones (mobile): tap a row to select + activate it.
    rects.forEach((rr, i) => {
      const zone = this.add.zone(boxX, rr.y, boxW, rr.h).setOrigin(0, 0).setInteractive().setDepth(12);
      zone.on("pointerdown", () => {
        if (this.busy || this.page !== "menu") return;
        this.sel = i;
        this.drawMenu();
        this.activate(i);
      });
      this.els.push(zone);
    });
  }

  private drawConfirm(): void {
    this.clearEls();
    const W = this.scale.width;
    const H = this.scale.height;

    const dim = this.add.graphics().setDepth(20);
    dim.fillStyle(0x03050c, 0.8);
    dim.fillRect(0, 0, W, H);
    this.els.push(dim);

    const pw = Math.min(460, W - 60);
    const ph = 200;
    const px = W / 2 - pw / 2;
    const py = H / 2 - ph / 2;
    const panel = this.add.graphics().setDepth(21);
    panel.fillStyle(0x2a1020, 0.97);
    panel.fillRoundedRect(px, py, pw, ph, 14);
    panel.lineStyle(3, 0xcc5566);
    panel.strokeRoundedRect(px, py, pw, ph, 14);
    this.els.push(panel);

    const title = this.add.text(W / 2, py + 46, "さいしょから はじめますか？", {
      fontSize: "18px", color: "#ffffff", fontFamily: F, fontStyle: "bold",
      stroke: "#000000", strokeThickness: 3, align: "center",
    }).setOrigin(0.5).setDepth(22).setResolution(2);
    this.els.push(title);

    const warn = this.add.text(W / 2, py + 96, "いままでの きろくは すべて\nきえてしまいます。ほんとうに いいですか？", {
      fontSize: "14px", color: "#ffc0c8", fontFamily: F,
      stroke: "#000000", strokeThickness: 3, align: "center", lineSpacing: 6,
    }).setOrigin(0.5).setDepth(22).setResolution(2);
    this.els.push(warn);

    const hint = this.add.text(W / 2, py + ph - 30, "Aボタン: はい  /  Bボタン: いいえ", {
      fontSize: "13px", color: "#ffd0d0", fontFamily: F,
      stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5).setDepth(22).setResolution(2);
    this.els.push(hint);
  }

  // ---- Actions ----
  private activate(i: number): void {
    if (this.busy) return;
    if (i === 0) { if (this.report.hasSave) this.doContinue(); }   // no save → not selectable
    else if (i === 1) {
      if (this.report.hasSave) { this.page = "confirm"; this.drawConfirm(); }
      else this.doNewGame();   // nothing to erase → skip the confirmation
    }
    else this.doSettings();
  }

  private doContinue(): void {
    this.busy = true;
    let data: Record<string, unknown> = { mapKey: "player_home", intro: true };
    try {
      const raw = localStorage.getItem("usamon-save-data");
      if (raw) {
        const s = JSON.parse(raw);
        if (s.mapKey) {
          data = { mapKey: s.mapKey, playerX: s.gridX, playerY: s.gridY, playerState: s.playerState };
        }
      }
    } catch { /* ignore */ }
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => this.scene.start("MapScene", data));
  }

  private doSettings(): void {
    this.busy = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => this.scene.start("SetupScene", { settingsMode: true }));
  }

  private doNewGame(): void {
    this.busy = true;
    try {
      localStorage.removeItem("usamon-save-data");
      localStorage.removeItem("usamon-player-setup");
    } catch { /* ignore */ }
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => this.scene.start("SetupScene"));
  }

  // ---- Input ----
  update(): void {
    if (this.busy) return;
    const gp = typeof window !== "undefined" ? (window as unknown as { __gamepad?: { dpad: string | null; dpadJust: string | null; aJust: boolean; bJust: boolean; menuJust: boolean } }).__gamepad : null;
    let a = false, b = false;
    let dpadJust: string | null = null;
    if (gp) {
      if (gp.aJust) { a = true; gp.aJust = false; }
      if (gp.bJust) { b = true; gp.bJust = false; }
      if (gp.menuJust) { gp.menuJust = false; }
      if (gp.dpadJust) { dpadJust = gp.dpadJust; gp.dpadJust = null; }
    }

    let kUp = false, kDown = false, kConfirm = false, kBack = false;
    if (this.input.keyboard && this.cursors) {
      kUp = Phaser.Input.Keyboard.JustDown(this.cursors.up);
      kDown = Phaser.Input.Keyboard.JustDown(this.cursors.down);
      if (this.keyEnter && Phaser.Input.Keyboard.JustDown(this.keyEnter)) kConfirm = true;
      if (this.keySpace && Phaser.Input.Keyboard.JustDown(this.keySpace)) kConfirm = true;
      if (this.keyEsc && Phaser.Input.Keyboard.JustDown(this.keyEsc)) kBack = true;
    }

    // Page 1: title thumbnail — any confirm advances to the menu.
    if (this.page === "start") {
      if (a || kConfirm) this.gotoMenu();
      return;
    }

    if (this.page === "confirm") {
      if (a || kConfirm) { this.doNewGame(); return; }
      if (b || kBack) { this.page = "menu"; this.drawMenu(); return; }
      return;
    }

    // Menu navigation. Use the one-shot d-pad tap latch (dpadJust) plus held-edge
    // detection so both quick taps and holds move the cursor exactly one step.
    const held = gp?.dpad ?? null;
    const goUp = dpadJust === "up" || (held === "up" && this.prevDpad !== "up") || kUp;
    const goDown = dpadJust === "down" || (held === "down" && this.prevDpad !== "down") || kDown;
    this.prevDpad = held;

    if (goUp) this.sel = (this.sel + 2) % 3;
    else if (goDown) this.sel = (this.sel + 1) % 3;
    // Skip the greyed-out つづき row when there is no save.
    if ((goUp || goDown) && !this.report.hasSave && this.sel === 0) this.sel = goUp ? 2 : 1;
    if (goUp || goDown) this.drawMenu();

    // B on the menu returns to the title thumbnail.
    if (b || kBack) { this.drawStart(); return; }

    if (a || kConfirm) this.activate(this.sel);
  }
}
