import * as Phaser from "phaser";
import { MonsterData, MoveData, PlayerState } from "../data/types";
import { applyEvolution, getNewMoveAtLevel } from "../data/levelSystem";
import { markCaught } from "../data/dex";
import { restorePP } from "../data/movePP";

interface EvoItem {
  partyIndex: number;
  fromId: string;
  toId: string;
}

interface EvoSceneData {
  evolutions: EvoItem[];
  playerState: PlayerState;
  mapKey: string;
  playerX: number;
  playerY: number;
  trainerDefeated?: string;
}

/**
 * Post-battle evolution cutscene. Plays on a clean, neutral screen (no battle
 * UI) after the battle has fully ended, then returns to the overworld. Auto
 * advances (tap / A also skips ahead).
 */
export class EvolutionScene extends Phaser.Scene {
  private allMonsters: MonsterData[] = [];
  private allMoves: MoveData[] = [];
  private evoData!: EvoSceneData;
  private sprite!: Phaser.GameObjects.Image;
  private msgText!: Phaser.GameObjects.Text;
  private box!: Phaser.GameObjects.Graphics;
  private celebObjs: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super({ key: "EvolutionScene" });
  }

  init(data: EvoSceneData): void {
    this.evoData = data;
  }

  create(): void {
    this.allMonsters = this.cache.json.get("monsters") as MonsterData[];
    this.allMoves = this.cache.json.get("moves") as MoveData[];

    const W = this.scale.width;
    const H = this.scale.height;

    // Neutral starry background (RSE evolution screen vibe).
    const bg = this.add.graphics().setDepth(0);
    bg.fillStyle(0x0e1526, 1);
    bg.fillRect(0, 0, W, H);
    bg.fillStyle(0x162238, 1);
    bg.fillRect(0, 0, W, Math.floor(H * 0.62));
    let s = 12345;
    const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    bg.fillStyle(0x8fa8d8, 0.9);
    for (let i = 0; i < 70; i++) {
      bg.fillRect(rand() * W, rand() * H * 0.6, rand() < 0.2 ? 2 : 1, 1);
    }

    // Evolving monster, centered on a soft platform.
    const cx = W / 2;
    const cy = Math.floor(H * 0.34);
    const plat = this.add.graphics().setDepth(1);
    plat.fillStyle(0x2a3a2a, 0.6);
    plat.fillEllipse(cx, cy + Math.floor(H * 0.10), Math.floor(W * 0.34), Math.floor(H * 0.05));

    this.sprite = this.add
      .image(cx, cy, `monster-${this.evoData.evolutions[0].fromId}`)
      .setOrigin(0.5, 0.5)
      .setDepth(2);
    this.fitSprite(this.sprite);

    // Message box.
    const boxH = Math.floor(H * 0.18);
    const box = this.add.graphics().setDepth(5);
    box.fillStyle(0x0a1120, 0.95);
    box.fillRoundedRect(12, H - boxH - 12, W - 24, boxH, 10);
    box.lineStyle(3, 0x5f7fb0, 1);
    box.strokeRoundedRect(12, H - boxH - 12, W - 24, boxH, 10);
    this.box = box;
    this.msgText = this.add
      .text(34, H - boxH + 6, "", {
        fontSize: "22px",
        color: "#ffffff",
        fontFamily: "'DotGothic16', monospace",
        wordWrap: { width: W - 64 },
        lineSpacing: 6,
      })
      .setDepth(6);

    this.cameras.main.fadeIn(300, 0, 0, 0);
    this.runEvolution(0);
  }

  private fitSprite(sprite: Phaser.GameObjects.Image): void {
    const w = sprite.width || 64;
    const h = sprite.height || 64;
    const maxW = this.scale.width * 0.5;
    const maxH = this.scale.height * 0.24;
    sprite.setScale(Math.min(maxW / w, maxH / h));
  }

  private setMsg(text: string): void {
    this.msgText.setText(text);
  }

  private runEvolution(i: number): void {
    if (i >= this.evoData.evolutions.length) {
      this.finish();
      return;
    }
    const evo = this.evoData.evolutions[i];
    const fromData = this.allMonsters.find((m) => m.id === evo.fromId)!;
    const toData = this.allMonsters.find((m) => m.id === evo.toId)!;

    // 前の しんか演出のお祝いを片づけ、暗い変身画面に戻す。
    this.clearCeleb();
    this.box.setVisible(true);
    this.msgText.setVisible(true);

    this.sprite.setTexture(`monster-${evo.fromId}`);
    this.sprite.setAlpha(1);
    this.fitSprite(this.sprite);
    this.setMsg(`おや…？ ${fromData.name}の ようすが…？`);

    this.time.delayedCall(1600, () => {
      let n = 0;
      this.time.addEvent({
        delay: 150,
        repeat: 11,
        callback: () => {
          n++;
          this.sprite.setAlpha(n % 2 === 0 ? 1 : 0.3);
          if (n >= 12) {
            this.sprite.setAlpha(1);
            this.sprite.setTexture(`monster-${evo.toId}`);
            this.fitSprite(this.sprite);
            this.cameras.main.flash(400, 255, 255, 255);

            // Commit the evolution to the party instance.
            const inst = this.evoData.playerState.party[evo.partyIndex];
            if (inst) {
              applyEvolution(inst, evo.toId, this.allMonsters, this.allMoves);
              markCaught(this.evoData.playerState, evo.toId); // ずかん: register the evolved form

              const mv = getNewMoveAtLevel(toData, inst.level);
              if (mv && !inst.moves.includes(mv) && inst.moves.length < 4) {
                inst.moves.push(mv);
              }
              restorePP(inst, this.allMoves);   // しんか時にPP全回復
            }

            this.showCeleb(fromData.name, toData.name);
            this.time.delayedCall(2800, () => this.runEvolution(i + 1));
          }
        },
      });
    });
  }

  /** しんか完了のお祝い演出。画面を明るい白っぽい背景にして、
   *  大きく「おめでとう！」＋ しんかした！のパネル＋キラキラを出す。 */
  private showCeleb(fromName: string, toName: string): void {
    const W = this.scale.width;
    const H = this.scale.height;
    // 暗い枠は隠して、お祝いのレイヤーに切り替える。
    this.box.setVisible(false);
    this.msgText.setVisible(false);

    const cx = W / 2;
    const cy = Math.floor(H * 0.34);

    // 明るい 白っぽい 背景（お祝いムード）。スプライト(2)より下の深度に置く。
    const bg = this.add.graphics().setDepth(0.9);
    bg.fillGradientStyle(0xffffff, 0xffffff, 0xffe7c0, 0xffdcef, 1);
    bg.fillRect(0, 0, W, H);
    this.celebObjs.push(bg);

    // スプライトの後ろの やわらかい ひかり。
    const glow = this.add.graphics().setDepth(1);
    glow.fillStyle(0xfff4c2, 0.55);
    glow.fillCircle(cx, cy, Math.floor(W * 0.32));
    this.celebObjs.push(glow);

    // でかい「おめでとう！」。
    const big = this.add.text(cx, Math.floor(H * 0.11), "おめでとう！", {
      fontSize: "52px", color: "#ff7a1a", fontFamily: "'DotGothic16', monospace",
      fontStyle: "bold", stroke: "#ffffff", strokeThickness: 9,
    }).setOrigin(0.5).setDepth(7);
    this.celebObjs.push(big);
    this.tweens.add({ targets: big, scale: { from: 0.3, to: 1 }, ease: "Back.out", duration: 500 });

    // しんかした！ の 明るいパネル。
    const boxH = Math.floor(H * 0.16);
    const panelY = H - boxH - 16;
    const panel = this.add.graphics().setDepth(6);
    panel.fillStyle(0xffffff, 0.92);
    panel.fillRoundedRect(16, panelY, W - 32, boxH, 14);
    panel.lineStyle(3, 0xffb84d, 1);
    panel.strokeRoundedRect(16, panelY, W - 32, boxH, 14);
    this.celebObjs.push(panel);
    const pText = this.add.text(cx, panelY + boxH / 2, `${fromName}は ${toName}に\nしんかした！`, {
      fontSize: "23px", color: "#3a2a10", fontFamily: "'DotGothic16', monospace",
      fontStyle: "bold", align: "center", lineSpacing: 6,
    }).setOrigin(0.5).setDepth(7);
    this.celebObjs.push(pText);

    // キラキラが はじける。
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const st = this.add.star(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20, 5, 5, 11, 0xffdf6e).setDepth(6);
      this.celebObjs.push(st);
      this.tweens.add({
        targets: st,
        x: cx + Math.cos(a) * (W * 0.36),
        y: cy + Math.sin(a) * (H * 0.22),
        alpha: { from: 1, to: 0 }, scale: { from: 1.2, to: 0.3 }, angle: 180,
        duration: 950, ease: "Cubic.out",
      });
    }

    // 進化後スプライトを ぽん と 弾ませる。
    const sc = this.sprite.scale;
    this.tweens.add({ targets: this.sprite, scale: { from: sc * 0.82, to: sc }, ease: "Back.out", duration: 500 });
  }

  private clearCeleb(): void {
    this.celebObjs.forEach((o) => o.destroy());
    this.celebObjs = [];
  }

  private finish(): void {
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => {
      this.scene.start("MapScene", {
        mapKey: this.evoData.mapKey,
        playerX: this.evoData.playerX,
        playerY: this.evoData.playerY,
        playerState: this.evoData.playerState,
        trainerDefeated: this.evoData.trainerDefeated,
      });
    });
  }
}
