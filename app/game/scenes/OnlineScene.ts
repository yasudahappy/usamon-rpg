import * as Phaser from "phaser";
import { BattleNet } from "../net/battleNet";
import { MonsterData, MonsterInstance, PlayerState } from "../data/types";

const F = "'DotGothic16', monospace";

interface OnlineSceneData {
  playerState: PlayerState;
  mapKey: string;
  playerX?: number;
  playerY?: number;
}

interface TeamMon { n: string; lv: number; }
type Page = "home" | "host" | "keypad" | "connected" | "message";

// オンライン対戦ロビー（P1）：あいことば（4桁）で 友だちと つなぎ、
// おたがいの チームを 見せあうところまで。実バトルは P2。
// 完全に タップ操作（十字キー/AB不要）。
export class OnlineScene extends Phaser.Scene {
  private sceneData!: OnlineSceneData;
  private net = new BattleNet();
  private page: Page = "home";
  private els: Phaser.GameObjects.GameObject[] = [];
  private code = "";
  private entry = "";
  private peerName = "";
  private myTeam: TeamMon[] = [];
  private peerTeam: TeamMon[] | null = null;
  private msg = "";
  private helloSent = false;

  constructor() { super({ key: "OnlineScene" }); }

  init(data: OnlineSceneData): void {
    this.sceneData = data;
    this.page = "home";
    this.code = ""; this.entry = ""; this.peerName = "";
    this.peerTeam = null; this.msg = ""; this.helloSent = false;
    this.net = new BattleNet();
  }

  create(): void {
    this.myTeam = this.buildTeam(this.sceneData.playerState?.party || []);
    this.render();
  }

  private buildTeam(party: MonsterInstance[]): TeamMon[] {
    const all = (this.cache.json.get("monsters") || []) as MonsterData[];
    const nameOf = (id: string) => all.find((m) => m.id === id)?.name ?? id;
    return party
      .filter((m) => !m.isEgg)
      .slice(0, 6)
      .map((m) => ({ n: nameOf(m.dataId), lv: m.level }));
  }

  // ---- 描画 ----
  private clearEls(): void { this.els.forEach((e) => e.destroy()); this.els = []; }

  private render(): void {
    this.clearEls();
    const W = this.scale.width, H = this.scale.height;
    const bg = this.add.rectangle(0, 0, W, H, 0x0a1226).setOrigin(0);
    this.els.push(bg);
    this.els.push(this.add.text(W / 2, 40, "たいせん", {
      fontSize: "26px", color: "#9fd0ff", fontFamily: F, fontStyle: "bold",
      stroke: "#001028", strokeThickness: 5,
    }).setOrigin(0.5));

    if (this.page === "home") this.renderHome();
    else if (this.page === "host") this.renderHost();
    else if (this.page === "keypad") this.renderKeypad();
    else if (this.page === "connected") this.renderConnected();
    else if (this.page === "message") this.renderMessage();

    this.els.forEach((o) => { if (o instanceof Phaser.GameObjects.Text) o.setResolution(2); });
  }

  private button(cx: number, cy: number, w: number, h: number, label: string, onTap: () => void, color = 0x1b3a6b, edge = 0x5aa0ff): void {
    const g = this.add.graphics();
    g.fillStyle(color, 0.98); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 10);
    g.lineStyle(2, edge); g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 10);
    const t = this.add.text(cx, cy, label, {
      fontSize: `${Math.min(20, Math.floor(h * 0.42))}px`, color: "#ffffff", fontFamily: F, stroke: "#001028", strokeThickness: 3,
    }).setOrigin(0.5);
    const z = this.add.zone(cx - w / 2, cy - h / 2, w, h).setOrigin(0).setInteractive();
    z.on("pointerdown", onTap);
    this.els.push(g, t, z);
  }

  private renderHome(): void {
    const W = this.scale.width, cy = this.scale.height * 0.5;
    this.els.push(this.add.text(W / 2, cy - 130, "ともだちと あいことばで\nたいせん しよう！", {
      fontSize: "16px", color: "#cfe0ff", fontFamily: F, align: "center", lineSpacing: 6,
    }).setOrigin(0.5));
    this.button(W / 2, cy - 40, 300, 60, "へやを つくる", () => this.startHost());
    this.button(W / 2, cy + 40, 300, 60, "あいことばで はいる", () => { this.entry = ""; this.page = "keypad"; this.render(); });
    this.button(W / 2, cy + 130, 220, 50, "とじる", () => this.returnToMap(), 0x33405a, 0x7f93b5);
  }

  private renderHost(): void {
    const W = this.scale.width, cy = this.scale.height * 0.42;
    this.els.push(this.add.text(W / 2, cy - 120, "この あいことばを\nともだちに おしえてね", {
      fontSize: "16px", color: "#cfe0ff", fontFamily: F, align: "center", lineSpacing: 6,
    }).setOrigin(0.5));
    // code display
    const g = this.add.graphics();
    g.fillStyle(0x05264a, 1); g.fillRoundedRect(W / 2 - 140, cy - 50, 280, 90, 14);
    g.lineStyle(3, 0x6fc0ff); g.strokeRoundedRect(W / 2 - 140, cy - 50, 280, 90, 14);
    this.els.push(g);
    this.els.push(this.add.text(W / 2, cy - 4, this.code || "----", {
      fontSize: "52px", color: "#eaf6ff", fontFamily: F, fontStyle: "bold", stroke: "#001028", strokeThickness: 5,
    }).setOrigin(0.5).setLetterSpacing(10));
    this.els.push(this.add.text(W / 2, cy + 90, "あいてを まってるよ…", {
      fontSize: "17px", color: "#ffd86a", fontFamily: F, stroke: "#001028", strokeThickness: 3,
    }).setOrigin(0.5));
    this.button(W / 2, this.scale.height - 90, 220, 52, "やめる", () => { this.net.close(); this.page = "home"; this.render(); }, 0x33405a, 0x7f93b5);
  }

  private renderKeypad(): void {
    const W = this.scale.width; const top = this.scale.height * 0.16;
    this.els.push(this.add.text(W / 2, top + 6, "あいことば（4けた）を いれてね", {
      fontSize: "15px", color: "#cfe0ff", fontFamily: F,
    }).setOrigin(0.5));
    // display
    const disp = (this.entry + "").padEnd(4, "・");
    this.els.push(this.add.text(W / 2, top + 56, disp, {
      fontSize: "46px", color: "#eaf6ff", fontFamily: F, fontStyle: "bold", stroke: "#001028", strokeThickness: 5,
    }).setOrigin(0.5).setLetterSpacing(12));
    // 3x4 keypad
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"];
    const kw = 84, kh = 60, gap = 14;
    const gridW = kw * 3 + gap * 2;
    const x0 = W / 2 - gridW / 2 + kw / 2;
    const y0 = top + 130;
    keys.forEach((k, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const cx = x0 + col * (kw + gap), cyy = y0 + row * (kh + gap);
      if (k === "OK") {
        const ok = this.entry.length === 4;
        this.button(cx, cyy, kw, kh, "けってい", () => { if (ok) this.startGuest(); }, ok ? 0x1f7a4d : 0x2a3550, ok ? 0x6ff0a8 : 0x556080);
      } else if (k === "⌫") {
        this.button(cx, cyy, kw, kh, "⌫", () => { this.entry = this.entry.slice(0, -1); this.render(); }, 0x5a2b3a, 0xff9db0);
      } else {
        this.button(cx, cyy, kw, kh, k, () => { if (this.entry.length < 4) { this.entry += k; this.render(); } });
      }
    });
    this.button(W / 2, this.scale.height - 70, 200, 48, "もどる", () => { this.page = "home"; this.render(); }, 0x33405a, 0x7f93b5);
  }

  private renderConnected(): void {
    const W = this.scale.width;
    this.els.push(this.add.text(W / 2, 90, "せつぞく できた！", {
      fontSize: "22px", color: "#8bf0a8", fontFamily: F, fontStyle: "bold", stroke: "#001028", strokeThickness: 4,
    }).setOrigin(0.5));
    // two team columns
    const colY = 150, colX = [W * 0.27, W * 0.73];
    const heads = ["あなた", this.peerName || "あいて"];
    const teams = [this.myTeam, this.peerTeam];
    for (let s = 0; s < 2; s++) {
      this.els.push(this.add.text(colX[s], colY, heads[s], {
        fontSize: "17px", color: "#9fd0ff", fontFamily: F, fontStyle: "bold", stroke: "#001028", strokeThickness: 3,
      }).setOrigin(0.5));
      const list = teams[s];
      if (!list) {
        this.els.push(this.add.text(colX[s], colY + 40, "…", { fontSize: "18px", color: "#7f93b5", fontFamily: F }).setOrigin(0.5));
        continue;
      }
      list.forEach((m, i) => {
        this.els.push(this.add.text(colX[s], colY + 36 + i * 30, `${m.n} Lv${m.lv}`, {
          fontSize: "15px", color: "#ffffff", fontFamily: F, stroke: "#001028", strokeThickness: 3,
        }).setOrigin(0.5));
      });
    }
    this.els.push(this.add.text(W / 2, this.scale.height - 150, "たいせんバトルは じゅんびちゅう！\nつぎの アップデートで あそべるよ。", {
      fontSize: "15px", color: "#ffd86a", fontFamily: F, align: "center", lineSpacing: 6, stroke: "#001028", strokeThickness: 3,
    }).setOrigin(0.5));
    this.button(W / 2, this.scale.height - 70, 220, 52, "とじる", () => this.returnToMap(), 0x33405a, 0x7f93b5);
  }

  private renderMessage(): void {
    const W = this.scale.width, cy = this.scale.height * 0.44;
    this.els.push(this.add.text(W / 2, cy, this.msg, {
      fontSize: "18px", color: "#ffffff", fontFamily: F, align: "center", lineSpacing: 8, stroke: "#001028", strokeThickness: 3,
      wordWrap: { width: W - 80 },
    }).setOrigin(0.5));
    this.button(W / 2, cy + 110, 220, 52, "もどる", () => { this.net.close(); this.page = "home"; this.render(); }, 0x33405a, 0x7f93b5);
  }

  // ---- 接続 ----
  private handlers() {
    return {
      onPeerJoin: (name: string) => { this.peerName = name; this.sendHello(); this.page = "connected"; this.render(); },
      onData: (data: unknown) => this.onData(data),
      onPeerLeave: () => { this.showMessage("あいてが きれちゃった…"); },
      onFull: () => { this.showMessage("その あいことばは\nもう つかわれているよ。"); },
      onError: () => { if (this.page !== "connected") this.showMessage("サーバーに つながらなかった…\nもういちど ためしてね。"); },
      onClose: () => { /* 明示的に閉じた場合は無視。相手切断は peer-leave で扱う */ },
    };
  }

  private startHost(): void {
    this.code = String(Math.floor(1000 + Math.random() * 9000));
    this.helloSent = false;
    this.page = "host"; this.render();
    this.net.connect(this.code, this.myName(), this.handlers());
  }

  private startGuest(): void {
    this.code = this.entry;
    this.helloSent = false;
    this.showMessage("せつぞく ちゅう…");
    this.net.connect(this.code, this.myName(), this.handlers());
  }

  private sendHello(): void {
    if (this.helloSent) return;
    this.helloSent = true;
    this.net.send({ k: "hello", name: this.myName(), team: this.myTeam });
  }

  private onData(data: unknown): void {
    const d = data as { k?: string; name?: string; team?: TeamMon[] };
    if (d && d.k === "hello") {
      if (d.name) this.peerName = d.name;
      this.peerTeam = Array.isArray(d.team) ? d.team.slice(0, 6) : [];
      // 相手の hello を受けた側も 自分の hello を返す（両者そろえる）
      this.sendHello();
      this.page = "connected";
      this.render();
    }
  }

  private showMessage(m: string): void { this.msg = m; this.page = "message"; this.render(); }

  private myName(): string {
    try {
      const s = JSON.parse(localStorage.getItem("usamon-player-setup") || "{}");
      if (typeof s.playerName === "string" && s.playerName) return s.playerName.slice(0, 12);
    } catch { /* noop */ }
    return "きみ";
  }

  private returnToMap(): void {
    this.net.close();
    this.scene.start("MapScene", {
      mapKey: this.sceneData.mapKey,
      playerX: this.sceneData.playerX,
      playerY: this.sceneData.playerY,
      playerState: this.sceneData.playerState,
    });
  }
}
