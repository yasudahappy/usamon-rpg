import * as Phaser from "phaser";
import { MonsterData, MoveData, PlayerState } from "../data/types";
import { applyEvolution, getNewMoveAtLevel } from "../data/levelSystem";
import { markCaught } from "../data/dex";

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
            }

            this.setMsg(`おめでとう！ ${fromData.name}は ${toData.name}に しんかした！`);
            this.time.delayedCall(2200, () => this.runEvolution(i + 1));
          }
        },
      });
    });
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
