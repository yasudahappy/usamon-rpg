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
  private myReady = false;
  private peerReady = false;

  constructor() { super({ key: "OnlineScene" }); }

  init(data: OnlineSceneData): void {
    this.sceneData = data;
    this.page = "home";
    this.code = ""; this.entry = ""; this.peerName = "";
    this.peerTeam = null; this.msg = ""; this.helloSent = false;
    this.myReady = false; this.peerReady = false;
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

  // ---- 描画（ライトテーマ・中央そろえで余白を バランス） ----
  private clearEls(): void { this.els.forEach((e) => e.destroy()); this.els = []; }

  private render(): void {
    this.clearEls();
    const W = this.scale.width, H = this.scale.height;
    // 明るい背景（うすい空色のグラデーション風・2段）
    const bg = this.add.graphics();
    bg.fillStyle(0xeaf2fc, 1); bg.fillRect(0, 0, W, H);
    bg.fillStyle(0xdfeaf9, 1); bg.fillRect(0, H * 0.62, W, H * 0.38);
    this.els.push(bg);
    // 見出し帯
    this.els.push(this.add.text(W / 2, 42, "たいせん", {
      fontSize: "26px", color: "#2b4a7e", fontFamily: F, fontStyle: "bold",
    }).setOrigin(0.5));
    this.els.push(this.add.text(W / 2, 70, "ともだちと あいことばで たいせん", {
      fontSize: "12px", color: "#6b7ea0", fontFamily: F,
    }).setOrigin(0.5));

    if (this.page === "home") this.renderHome();
    else if (this.page === "host") this.renderHost();
    else if (this.page === "keypad") this.renderKeypad();
    else if (this.page === "connected") this.renderConnected();
    else if (this.page === "message") this.renderMessage();

    this.els.forEach((o) => { if (o instanceof Phaser.GameObjects.Text) o.setResolution(2); });
  }

  /** 白いカード（コンテンツを囲って 余白を『意図した余白』に見せる）。 */
  private card(cx: number, cy: number, w: number, h: number): void {
    const g = this.add.graphics();
    g.fillStyle(0x0a1a33, 0.06); g.fillRoundedRect(cx - w / 2 + 3, cy - h / 2 + 5, w, h, 16); // やわらかい影
    g.fillStyle(0xffffff, 1); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 16);
    g.lineStyle(2, 0xc9d6ee); g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 16);
    this.els.push(g);
  }

  private button(cx: number, cy: number, w: number, h: number, label: string, onTap: () => void, kind: "primary" | "secondary" | "ok" | "okoff" | "del" = "primary"): void {
    const style: Record<string, { fill: number; edge: number; tc: string }> = {
      primary: { fill: 0x3f86e0, edge: 0x2c66b8, tc: "#ffffff" },
      secondary: { fill: 0xeef3fb, edge: 0xb9c8e6, tc: "#3a4c70" },
      ok: { fill: 0x28a06a, edge: 0x1c7a50, tc: "#ffffff" },
      okoff: { fill: 0xe2e8f2, edge: 0xcbd5e6, tc: "#9aa7c0" },
      del: { fill: 0xfbe7ec, edge: 0xe6a9b6, tc: "#b0344f" },
    };
    const s = style[kind];
    const g = this.add.graphics();
    g.fillStyle(s.fill, 1); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 10);
    g.lineStyle(2, s.edge); g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 10);
    const t = this.add.text(cx, cy, label, {
      fontSize: `${Math.min(20, Math.floor(h * 0.42))}px`, color: s.tc, fontFamily: F, fontStyle: "bold",
    }).setOrigin(0.5);
    const z = this.add.zone(cx - w / 2, cy - h / 2, w, h).setOrigin(0).setInteractive();
    z.on("pointerdown", onTap);
    this.els.push(g, t, z);
  }

  private renderHome(): void {
    const W = this.scale.width, cy = this.scale.height * 0.5;
    const cardH = 336;
    this.card(W / 2, cy, 380, cardH);
    this.els.push(this.add.text(W / 2, cy - cardH / 2 + 26, "あそびかたを えらんでね", {
      fontSize: "15px", color: "#6b7ea0", fontFamily: F,
    }).setOrigin(0.5));
    this.button(W / 2, cy - 70, 300, 62, "へやを つくる", () => this.startHost(), "primary");
    this.button(W / 2, cy + 6, 300, 62, "あいことばで はいる", () => { this.entry = ""; this.page = "keypad"; this.render(); }, "primary");
    // あなたの てもち（カードの下段を うめる・確認にもなる）
    const div = this.add.graphics();
    div.lineStyle(1, 0xe1e8f4); div.lineBetween(W / 2 - 150, cy + 56, W / 2 + 150, cy + 56);
    this.els.push(div);
    this.els.push(this.add.text(W / 2, cy + 74, "あなたの てもち", {
      fontSize: "12px", color: "#8b9abb", fontFamily: F,
    }).setOrigin(0.5));
    const names = this.myTeam.length ? this.myTeam.map((m) => m.n).join("・") : "（いません）";
    this.els.push(this.add.text(W / 2, cy + 100, names, {
      fontSize: "14px", color: "#3a4c70", fontFamily: F, align: "center", lineSpacing: 4,
      wordWrap: { width: 330 },
    }).setOrigin(0.5));
    this.button(W / 2, cy + cardH / 2 + 40, 200, 48, "とじる", () => this.returnToMap(), "secondary");
  }

  private renderHost(): void {
    const W = this.scale.width, cy = this.scale.height * 0.5;
    this.card(W / 2, cy, 360, 250);
    this.els.push(this.add.text(W / 2, cy - 92, "この あいことばを\nともだちに おしえてね", {
      fontSize: "15px", color: "#6b7ea0", fontFamily: F, align: "center", lineSpacing: 5,
    }).setOrigin(0.5));
    // code display
    const g = this.add.graphics();
    g.fillStyle(0xeaf2fc, 1); g.fillRoundedRect(W / 2 - 130, cy - 45, 260, 88, 12);
    g.lineStyle(2, 0x9cc0f0); g.strokeRoundedRect(W / 2 - 130, cy - 45, 260, 88, 12);
    this.els.push(g);
    this.els.push(this.add.text(W / 2, cy - 1, this.code || "----", {
      fontSize: "50px", color: "#2b4a7e", fontFamily: F, fontStyle: "bold",
    }).setOrigin(0.5).setLetterSpacing(10));
    this.els.push(this.add.text(W / 2, cy + 78, "あいてを まってるよ…", {
      fontSize: "16px", color: "#c9702a", fontFamily: F, fontStyle: "bold",
    }).setOrigin(0.5));
    this.button(W / 2, cy + 165, 200, 48, "やめる", () => { this.net.close(); this.page = "home"; this.render(); }, "secondary");
  }

  private renderKeypad(): void {
    const W = this.scale.width;
    const kw = 82, kh = 58, gap = 12;
    const gridW = kw * 3 + gap * 2, gridH = kh * 4 + gap * 3;
    // カード内に「見出し＋表示＋キーパッド」をまとめる
    const cardH = 90 + gridH + 40;
    const cy = this.scale.height * 0.5;
    this.card(W / 2, cy, gridW + 60, cardH);
    const top = cy - cardH / 2 + 24;
    this.els.push(this.add.text(W / 2, top, "あいことば（4けた）を いれてね", {
      fontSize: "14px", color: "#6b7ea0", fontFamily: F,
    }).setOrigin(0.5));
    const disp = (this.entry + "").padEnd(4, "・");
    this.els.push(this.add.text(W / 2, top + 40, disp, {
      fontSize: "42px", color: "#2b4a7e", fontFamily: F, fontStyle: "bold",
    }).setOrigin(0.5).setLetterSpacing(12));
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"];
    const x0 = W / 2 - gridW / 2 + kw / 2;
    const y0 = top + 92;
    keys.forEach((k, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const cx = x0 + col * (kw + gap), cyy = y0 + row * (kh + gap);
      if (k === "OK") {
        const ok = this.entry.length === 4;
        this.button(cx, cyy, kw, kh, "けってい", () => { if (ok) this.startGuest(); }, ok ? "ok" : "okoff");
      } else if (k === "⌫") {
        this.button(cx, cyy, kw, kh, "⌫", () => { this.entry = this.entry.slice(0, -1); this.render(); }, "del");
      } else {
        this.button(cx, cyy, kw, kh, k, () => { if (this.entry.length < 4) { this.entry += k; this.render(); } }, "secondary");
      }
    });
    this.button(W / 2, cy + cardH / 2 + 40, 180, 46, "もどる", () => { this.page = "home"; this.render(); }, "secondary");
  }

  private renderConnected(): void {
    const W = this.scale.width, H = this.scale.height;
    const cardW = W - 48, cardH = 300, cy = H * 0.5;
    this.card(W / 2, cy, cardW, cardH);
    this.els.push(this.add.text(W / 2, cy - cardH / 2 + 28, "せつぞく できた！", {
      fontSize: "22px", color: "#1a9a5a", fontFamily: F, fontStyle: "bold",
    }).setOrigin(0.5));
    // たての しきり線
    const div = this.add.graphics();
    div.lineStyle(2, 0xd7e0f0); div.lineBetween(W / 2, cy - cardH / 2 + 56, W / 2, cy + cardH / 2 - 20);
    this.els.push(div);
    this.els.push(this.add.text(W / 2, cy - 6, "VS", {
      fontSize: "18px", color: "#b7c2d8", fontFamily: F, fontStyle: "bold",
    }).setOrigin(0.5));
    const headY = cy - cardH / 2 + 78, colX = [W * 0.28, W * 0.72];
    const heads = ["あなた", this.peerName || "あいて"];
    const teams = [this.myTeam, this.peerTeam];
    for (let s = 0; s < 2; s++) {
      this.els.push(this.add.text(colX[s], headY, heads[s], {
        fontSize: "17px", color: "#2b4a7e", fontFamily: F, fontStyle: "bold",
      }).setOrigin(0.5));
      const list = teams[s];
      if (!list) {
        this.els.push(this.add.text(colX[s], headY + 44, "…", { fontSize: "18px", color: "#9aa7c0", fontFamily: F }).setOrigin(0.5));
        continue;
      }
      list.forEach((m, i) => {
        this.els.push(this.add.text(colX[s], headY + 40 + i * 30, `${m.n} Lv${m.lv}`, {
          fontSize: "15px", color: "#3a4c70", fontFamily: F,
        }).setOrigin(0.5));
      });
    }
    // じゅんびOK ボタン（両者が おすと たいせん開始）
    const statusY = cy + cardH / 2 + 30;
    if (this.myReady) {
      this.els.push(this.add.text(W / 2, statusY, this.peerReady ? "はじまるよ！" : "あいての じゅんびを まってる…", {
        fontSize: "15px", color: "#1a9a5a", fontFamily: F, fontStyle: "bold",
      }).setOrigin(0.5));
      this.button(W / 2, statusY + 46, 200, 48, "とじる", () => this.returnToMap(), "secondary");
    } else {
      if (this.peerReady) {
        this.els.push(this.add.text(W / 2, statusY, "あいては じゅんびOK！", {
          fontSize: "14px", color: "#c9702a", fontFamily: F,
        }).setOrigin(0.5));
      }
      this.button(W / 2, statusY + (this.peerReady ? 30 : 8), 240, 56, "たいせん スタート", () => this.onReady(), "primary");
      this.button(W / 2, statusY + (this.peerReady ? 96 : 74), 180, 44, "とじる", () => this.returnToMap(), "secondary");
    }
  }

  private onReady(): void {
    if (this.myReady) return;
    this.myReady = true;
    this.net.send({ k: "ready" });
    if (this.peerReady) this.startBattle();
    else this.render();
  }

  private startBattle(): void {
    this.scene.start("NetBattleScene", {
      net: this.net,
      isHost: this.net.role === "host",
      peerName: this.peerName,
      myParty: this.sceneData.playerState?.party || [],
      ret: {
        mapKey: this.sceneData.mapKey,
        playerX: this.sceneData.playerX,
        playerY: this.sceneData.playerY,
        playerState: this.sceneData.playerState,
      },
    });
  }

  private renderMessage(): void {
    const W = this.scale.width, cy = this.scale.height * 0.5;
    this.card(W / 2, cy, 360, 200);
    this.els.push(this.add.text(W / 2, cy - 20, this.msg, {
      fontSize: "18px", color: "#3a4c70", fontFamily: F, align: "center", lineSpacing: 8,
      wordWrap: { width: 300 },
    }).setOrigin(0.5));
    this.button(W / 2, cy + 60, 200, 48, "もどる", () => { this.net.close(); this.page = "home"; this.render(); }, "secondary");
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
    } else if (d && d.k === "ready") {
      this.peerReady = true;
      if (this.myReady) this.startBattle();
      else if (this.page === "connected") this.render();
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
