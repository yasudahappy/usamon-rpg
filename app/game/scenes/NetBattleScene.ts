import * as Phaser from "phaser";
import { BattleNet } from "../net/battleNet";
import { calculateDamage } from "../battle/damage";
import { BattleMonster, BattleMove } from "../battle/types";
import { MonsterData, MoveData, MonsterInstance, PlayerState } from "../data/types";
import { TypeChart } from "../types";
import { calculateStats } from "../data/levelSystem";

const F = "'DotGothic16', monospace";

interface RetInfo { mapKey: string; playerX?: number; playerY?: number; playerState: PlayerState; }
interface NetBattleData {
  net: BattleNet;
  isHost: boolean;
  peerName: string;
  myParty: MonsterInstance[];
  levelCap?: number | null;   // 指定があれば その レベルに そろえて 対戦（フェア）
  ret: RetInfo;
}
// ネットワーク上を流れる モンスター（自分の1体を 相手へ渡す）。
interface WireMon {
  dataId: string; name: string; type: string; level: number;
  maxHp: number; currentHp: number; attack: number; defense: number; speed: number;
  moves: BattleMove[];
}
type Side = "host" | "guest";
interface TurnEvent {
  by: Side; moveName: string; kind: "hit" | "status";
  dmg?: number; crit?: boolean; eff?: number; defSide?: Side; defHp?: number;
}

// オンライン対戦バトル（P2・ホスト権威の 1対1）。
// ホストが 乱数と計算を にぎり、結果イベントを ゲストへ 流して 両者で 同じ演出。
export class NetBattleScene extends Phaser.Scene {
  private d!: NetBattleData;
  private net!: BattleNet;
  private side!: Side;
  private typeChart!: TypeChart;
  private hostMon!: BattleMonster & { dataId: string };
  private guestMon!: BattleMonster & { dataId: string };
  private started = false;
  private turn = 0;
  private busy = false;         // 演出中は 入力を止める
  private hostAction: number | null = null;  // host側のみ使用
  private guestAction: number | null = null;
  private ended = false;

  private els: Phaser.GameObjects.GameObject[] = [];
  private oppSprite?: Phaser.GameObjects.Image;
  private mySprite?: Phaser.GameObjects.Image;
  private msgText?: Phaser.GameObjects.Text;
  private hpEls: Phaser.GameObjects.GameObject[] = [];

  constructor() { super({ key: "NetBattleScene" }); }

  init(data: NetBattleData): void {
    this.d = data;
    this.net = data.net;
    this.side = data.isHost ? "host" : "guest";
    this.started = false; this.turn = 0; this.busy = false; this.ended = false;
    this.hostAction = null; this.guestAction = null;
  }

  create(): void {
    this.typeChart = this.cache.json.get("types") as TypeChart;
    this.drawArena();
    this.setMessage("あいての じゅんびを まってるよ…");

    const myMon = this.buildMon(this.pickLead(this.d.myParty));
    if (this.d.isHost) this.hostMon = myMon; else this.guestMon = myMon;
    this.myWire = this.serialize(myMon);

    this.net.setHandlers({
      onData: (data) => this.onData(data),
      onPeerLeave: () => this.onPeerLeave(),
      onError: () => { /* 対戦中の一時エラーは無視（切断はpeer-leave） */ },
    });
    // 自分の1体を 相手へ。相手が まだロビーにいて 取りこぼす場合に そなえ、
    // 両者がバトルに入るまで 何度か 送りなおす（順番ズレ対策）。
    this.net.send({ k: "mon", mon: this.myWire });
    let tries = 0;
    this.monRetry = this.time.addEvent({ delay: 600, loop: true, callback: () => {
      if (this.started || tries++ > 12) { this.monRetry?.remove(); return; }
      this.net.send({ k: "mon", mon: this.myWire });
    } });
    this.maybeStart();
  }

  private myWire!: WireMon;
  private monRetry?: Phaser.Time.TimerEvent;

  // ---- セットアップ ----
  private pickLead(party: MonsterInstance[]): MonsterInstance {
    return party.find((m) => !m.isEgg && (m.currentHp ?? 1) > 0) || party.find((m) => !m.isEgg) || party[0];
  }

  private buildMon(inst: MonsterInstance): BattleMonster & { dataId: string } {
    const all = (this.cache.json.get("monsters") || []) as MonsterData[];
    const data = all.find((m) => m.id === inst.dataId);
    const allMoves = (this.cache.json.get("moves") || []) as MoveData[];
    // レベルルール：cap 指定があれば その レベルで 能力を そろえる。
    const level = this.d.levelCap ? this.d.levelCap : inst.level;
    const st = data ? calculateStats(data, level) : { hp: 20, attack: 10, defense: 10, speed: 10 };
    const ids = inst.moves && inst.moves.length ? inst.moves : ["tataku"];
    const moves: BattleMove[] = ids.slice(0, 4).map((id) => {
      const m = allMoves.find((x) => x.id === id) || { name: "たたく", type: "ノーマル", power: 40, isSupport: false, pp: 20 } as MoveData;
      return { name: m.name, type: m.type, power: m.power, isSupport: m.isSupport, pp: m.pp, maxPp: m.pp };
    });
    return {
      dataId: inst.dataId, name: data?.name ?? inst.dataId, type: data?.type ?? "ノーマル",
      level, maxHp: st.hp, currentHp: st.hp, attack: st.attack, defense: st.defense, speed: st.speed,
      moves, attackMod: 1, defenseMod: 1, speedMod: 1,
    };
  }

  private serialize(m: BattleMonster & { dataId: string }): WireMon {
    return {
      dataId: m.dataId, name: m.name, type: m.type, level: m.level,
      maxHp: m.maxHp, currentHp: m.currentHp, attack: m.attack, defense: m.defense, speed: m.speed,
      moves: m.moves,
    };
  }

  private onData(data: unknown): void {
    const d = data as { k?: string; mon?: WireMon; turn?: number; move?: number; events?: TurnEvent[]; hostHp?: number; guestHp?: number; winner?: Side | null };
    if (!d || !d.k) return;
    if (d.k === "mon" && d.mon) {
      const wm = d.mon;
      const built: BattleMonster & { dataId: string } = { ...wm, attackMod: 1, defenseMod: 1, speedMod: 1 };
      if (this.d.isHost) this.guestMon = built; else this.hostMon = built;
      this.maybeStart();
    } else if (d.k === "act" && this.d.isHost) {
      // ゲストの行動が届いた（ホストだけが解決する）
      if (d.turn === this.turn) { this.guestAction = d.move ?? 0; this.tryResolve(); }
    } else if (d.k === "resolve" && !this.d.isHost) {
      // ホストの解決結果を 再生
      this.playResolve(d.events || [], d.hostHp ?? this.hostMon.currentHp, d.guestHp ?? this.guestMon.currentHp, d.winner ?? null);
    }
  }

  private maybeStart(): void {
    if (this.started || !this.hostMon || !this.guestMon) return;
    this.started = true;
    this.renderMons();
    this.turn = 1;
    this.setMessage(`${this.myMon().name}と ${this.oppMon().name}の たいせん！`);
    this.time.delayedCall(900, () => this.beginTurn());
  }

  private myMon(): BattleMonster & { dataId: string } { return this.d.isHost ? this.hostMon : this.guestMon; }
  private oppMon(): BattleMonster & { dataId: string } { return this.d.isHost ? this.guestMon : this.hostMon; }

  // ---- ターン ----
  private beginTurn(): void {
    if (this.ended) return;
    this.busy = false;
    this.hostAction = null; this.guestAction = null;
    this.setMessage("わざを えらんでね");
    this.drawMoveMenu();
  }

  private chooseMove(idx: number): void {
    if (this.busy || this.ended) return;
    this.busy = true;
    this.clearMoveMenu();
    this.setMessage("あいての こうどうを まってる…");
    if (this.d.isHost) { this.hostAction = idx; this.tryResolve(); }
    else { this.net.send({ k: "act", turn: this.turn, move: idx }); }
  }

  private tryResolve(): void {
    if (!this.d.isHost || this.hostAction === null || this.guestAction === null) return;
    const hAct = this.hostAction, gAct = this.guestAction;
    this.hostAction = null; this.guestAction = null;

    const events: TurnEvent[] = [];
    // すばやさ順（同速は ホスト先攻を すこしランダムに）
    const first: Side = this.hostMon.speed !== this.guestMon.speed
      ? (this.hostMon.speed > this.guestMon.speed ? "host" : "guest")
      : (Math.random() < 0.5 ? "host" : "guest");
    const order: Side[] = first === "host" ? ["host", "guest"] : ["guest", "host"];
    let winner: Side | null = null;
    for (const side of order) {
      const attacker = side === "host" ? this.hostMon : this.guestMon;
      const defender = side === "host" ? this.guestMon : this.hostMon;
      const defSide: Side = side === "host" ? "guest" : "host";
      if (attacker.currentHp <= 0) continue;
      const mv = attacker.moves[side === "host" ? hAct : gAct] || attacker.moves[0];
      if (!mv || mv.isSupport || mv.power <= 0) {
        events.push({ by: side, moveName: mv?.name ?? "ようす見", kind: "status" });
        continue;
      }
      const r = calculateDamage(attacker, defender, mv, this.typeChart);
      defender.currentHp = Math.max(0, defender.currentHp - r.damage);
      events.push({ by: side, moveName: mv.name, kind: "hit", dmg: r.damage, crit: r.crit, eff: r.effectiveness, defSide, defHp: defender.currentHp });
      if (defender.currentHp <= 0) { winner = side; break; }
    }
    this.net.send({ k: "resolve", turn: this.turn, events, hostHp: this.hostMon.currentHp, guestHp: this.guestMon.currentHp, winner });
    this.playResolve(events, this.hostMon.currentHp, this.guestMon.currentHp, winner);
  }

  private playResolve(events: TurnEvent[], hostHp: number, guestHp: number, winner: Side | null): void {
    this.busy = true;
    let i = 0;
    const step = () => {
      if (i >= events.length) {
        // 最終HPを 権威値に そろえる
        this.hostMon.currentHp = hostHp; this.guestMon.currentHp = guestHp;
        this.updateHpBars();
        if (winner) { this.time.delayedCall(500, () => this.endBattle(winner)); }
        else { this.turn++; this.time.delayedCall(500, () => this.beginTurn()); }
        return;
      }
      const ev = events[i++];
      const byName = ev.by === this.side ? this.myMon().name : this.oppMon().name;
      if (ev.kind === "status") {
        this.setMessage(`${byName}は ようすを みている…`);
        this.time.delayedCall(900, step);
      } else {
        // HP反映（この時点の値）
        if (ev.defSide === "host") this.hostMon.currentHp = ev.defHp ?? this.hostMon.currentHp;
        else this.guestMon.currentHp = ev.defHp ?? this.guestMon.currentHp;
        this.updateHpBars();
        let line = `${byName}の ${ev.moveName}！`;
        if (ev.crit) line += "\nきゅうしょに あたった！";
        else if ((ev.eff ?? 1) >= 2) line += "\nこうかは バツグンだ！";
        else if ((ev.eff ?? 1) <= 0.5) line += "\nこうかは いまひとつ…";
        this.setMessage(line);
        const fainted = (ev.defHp ?? 1) <= 0;
        this.time.delayedCall(fainted ? 1100 : 950, step);
      }
    };
    step();
  }

  private endBattle(winner: Side): void {
    this.ended = true;
    this.clearMoveMenu();
    const iWon = winner === this.side;
    this.setMessage(iWon ? `やった！ ${this.myMon().name}の かち！` : `${this.oppMon().name}に まけちゃった…`);
    this.button(this.scale.width / 2, this.scale.height * 0.9, 220, 52, "とじる", () => this.returnToMap());
  }

  private onPeerLeave(): void {
    if (this.ended) return;
    this.ended = true;
    this.clearMoveMenu();
    this.setMessage("あいてが きれちゃった…");
    this.button(this.scale.width / 2, this.scale.height * 0.9, 220, 52, "とじる", () => this.returnToMap());
  }

  private returnToMap(): void {
    this.net.close();
    this.scene.start("MapScene", {
      mapKey: this.d.ret.mapKey, playerX: this.d.ret.playerX, playerY: this.d.ret.playerY, playerState: this.d.ret.playerState,
    });
  }

  // ---- 描画 ----
  private drawArena(): void {
    const W = this.scale.width, H = this.scale.height;
    const g = this.add.graphics();
    g.fillStyle(0x0b1020, 1); g.fillRect(0, 0, W, H * 0.62);
    g.fillStyle(0x18203a, 1); g.fillRect(0, H * 0.62, W, H * 0.38);
    // ほのかな星
    for (let i = 0; i < 40; i++) {
      const rx = (i * 97 % W), ry = (i * 53 % Math.floor(H * 0.55));
      g.fillStyle(0xffffff, 0.5 * ((i % 3) / 2 + 0.3)); g.fillRect(rx, ry, 2, 2);
    }
    this.els.push(g);
    this.msgText = this.add.text(24, H - 96, "", {
      fontSize: "17px", color: "#ffffff", fontFamily: F, lineSpacing: 5, wordWrap: { width: W - 48 },
    });
    this.els.push(this.msgText);
  }

  private setMessage(s: string): void { this.msgText?.setText(s); }

  private renderMons(): void {
    const W = this.scale.width, H = this.scale.height;
    const opp = this.oppMon(), mine = this.myMon();
    // platforms
    const g = this.add.graphics();
    g.fillStyle(0x2a3560, 0.6); g.fillEllipse(W * 0.72, H * 0.30, 190, 44);
    g.fillStyle(0x2a3560, 0.6); g.fillEllipse(W * 0.28, H * 0.56, 210, 50);
    this.els.push(g);
    // opp (front)
    const oppTex = this.texFor(opp.dataId, false);
    if (oppTex) { this.oppSprite = this.add.image(W * 0.72, H * 0.30, oppTex).setOrigin(0.5, 1); this.fit(this.oppSprite, 150); this.els.push(this.oppSprite); }
    // me (back)
    const myTex = this.texFor(mine.dataId, true);
    if (myTex) { this.mySprite = this.add.image(W * 0.28, H * 0.56, myTex).setOrigin(0.5, 1); this.fit(this.mySprite, 190); this.els.push(this.mySprite); }
    this.updateHpBars();
  }

  private texFor(dataId: string, back: boolean): string | null {
    if (back && this.textures.exists(`monster-${dataId}-back`)) return `monster-${dataId}-back`;
    if (this.textures.exists(`monster-${dataId}`)) return `monster-${dataId}`;
    return null;
  }

  private fit(img: Phaser.GameObjects.Image, box: number): void {
    const src = this.textures.get(img.texture.key).getSourceImage() as { width: number; height: number };
    img.setScale(box / Math.max(src.width, src.height));
  }

  private updateHpBars(): void {
    this.hpEls.forEach((e) => e.destroy()); this.hpEls = [];
    const W = this.scale.width, H = this.scale.height;
    const opp = this.oppMon(), mine = this.myMon();
    this.hpBar(W * 0.06, H * 0.10, opp, false);
    this.hpBar(W * 0.52, H * 0.66, mine, true);
  }

  private hpBar(x: number, y: number, m: BattleMonster, mine: boolean): void {
    const W = this.scale.width, bw = W * 0.42;
    const g = this.add.graphics();
    g.fillStyle(0x0a1226, 0.9); g.fillRoundedRect(x, y, bw, 52, 8);
    g.lineStyle(2, 0x6f8fd0); g.strokeRoundedRect(x, y, bw, 52, 8);
    this.hpEls.push(g);
    this.hpEls.push(this.add.text(x + 12, y + 6, `${m.name}`, { fontSize: "15px", color: "#ffffff", fontFamily: F }));
    this.hpEls.push(this.add.text(x + bw - 12, y + 6, `Lv${m.level}`, { fontSize: "13px", color: "#cfe0ff", fontFamily: F }).setOrigin(1, 0));
    const frac = Math.max(0, m.currentHp) / m.maxHp;
    const barX = x + 12, barY = y + 30, barW = bw - 24;
    const bg = this.add.graphics();
    bg.fillStyle(0x223052, 1); bg.fillRoundedRect(barX, barY, barW, 12, 6);
    const col = frac > 0.5 ? 0x4fd07a : frac > 0.2 ? 0xf0c04a : 0xe0604a;
    bg.fillStyle(col, 1); bg.fillRoundedRect(barX, barY, Math.max(3, barW * frac), 12, 6);
    this.hpEls.push(bg);
    if (mine) this.hpEls.push(this.add.text(barX + barW, barY + 16, `${Math.max(0, m.currentHp)}/${m.maxHp}`, { fontSize: "12px", color: "#cfe0ff", fontFamily: F }).setOrigin(1, 0));
  }

  // move menu
  private menuEls: Phaser.GameObjects.GameObject[] = [];
  private focus: { cx: number; cy: number; w: number; h: number; onTap: () => void }[] = [];
  private focusIdx = 0;
  private navCols = 1;
  private hlG?: Phaser.GameObjects.Graphics;
  private clearMoveMenu(): void {
    this.menuEls.forEach((e) => e.destroy()); this.menuEls = [];
    this.focus = []; this.hlG?.destroy(); this.hlG = undefined;
  }
  private drawMoveMenu(): void {
    this.clearMoveMenu();
    const W = this.scale.width, H = this.scale.height;
    const moves = this.myMon().moves;
    const bw = (W - 60) / 2, bh = 52, gap = 12;
    const x0 = 24 + bw / 2, y0 = H - 130;
    moves.slice(0, 4).forEach((mv, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const cx = x0 + col * (bw + gap), cy = y0 - (1 - row) * (bh + gap) + (bh + gap);
      this.moveButton(cx, cy, bw, bh, `${mv.name}`, () => this.chooseMove(i));
    });
    this.navCols = 2; this.focusIdx = 0; this.drawHighlight();
  }

  private moveButton(cx: number, cy: number, w: number, h: number, label: string, onTap: () => void): void {
    const g = this.add.graphics();
    g.fillStyle(0x2b4a86, 0.98); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 8);
    g.lineStyle(2, 0x6f9fe0); g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 8);
    const t = this.add.text(cx, cy, label, { fontSize: "16px", color: "#ffffff", fontFamily: F, fontStyle: "bold" }).setOrigin(0.5);
    const z = this.add.zone(cx - w / 2, cy - h / 2, w, h).setOrigin(0).setInteractive();
    z.on("pointerdown", onTap);
    this.menuEls.push(g, t, z);
    this.focus.push({ cx, cy, w, h, onTap });
  }

  private button(cx: number, cy: number, w: number, h: number, label: string, onTap: () => void): void {
    const g = this.add.graphics();
    g.fillStyle(0x33405a, 0.98); g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 10);
    g.lineStyle(2, 0x8fa6cf); g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 10);
    const t = this.add.text(cx, cy, label, { fontSize: "18px", color: "#ffffff", fontFamily: F, fontStyle: "bold" }).setOrigin(0.5);
    const z = this.add.zone(cx - w / 2, cy - h / 2, w, h).setOrigin(0).setInteractive();
    z.on("pointerdown", onTap);
    this.els.push(g, t, z);
    this.focus.push({ cx, cy, w, h, onTap });
    this.navCols = 1; this.focusIdx = this.focus.length - 1; this.drawHighlight();
  }

  private drawHighlight(): void {
    const f = this.focus[this.focusIdx];
    this.hlG?.destroy(); this.hlG = undefined;
    if (!f) return;
    this.hlG = this.add.graphics();
    this.hlG.lineStyle(3, 0xffd23f); this.hlG.strokeRoundedRect(f.cx - f.w / 2 - 4, f.cy - f.h / 2 - 4, f.w + 8, f.h + 8, 10);
  }

  // 十字キー / A ボタン ナビゲーション。
  update(): void {
    const gp = (typeof window !== "undefined") ? (window as unknown as { __gamepad?: { dpad: string | null; dpadJust: string | null; aJust: boolean; bJust: boolean; menuJust: boolean } }).__gamepad : null;
    if (!gp) return;
    if (this.focus.length === 0) { gp.aJust = false; gp.bJust = false; gp.menuJust = false; gp.dpadJust = null; return; }
    const dj = gp.dpadJust; gp.dpadJust = null;
    if (dj) {
      const n = this.focus.length, cols = Math.max(1, this.navCols);
      if (dj === "right") this.focusIdx = Math.min(n - 1, this.focusIdx + 1);
      else if (dj === "left") this.focusIdx = Math.max(0, this.focusIdx - 1);
      else if (dj === "down") this.focusIdx = Math.min(n - 1, this.focusIdx + cols);
      else if (dj === "up") this.focusIdx = Math.max(0, this.focusIdx - cols);
      this.drawHighlight();
    }
    if (gp.aJust) { gp.aJust = false; const f = this.focus[this.focusIdx]; if (f) f.onTap(); }
    gp.bJust = false; gp.menuJust = false;
  }
}
