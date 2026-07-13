import * as Phaser from "phaser";

/**
 * どうぐ一覧（バトル／フィールド）で名前の先頭に出す、アイテムの
 * ミニアイコンを canvas に手描きする。32px 基準・ドット絵調（補間なし）。
 * id ごとに色や形を変え、未知の id は category からフォールバックする。
 */
export function drawItemIcon(
  ctx: CanvasRenderingContext2D,
  id: string,
  category: string | undefined,
  s = 32
): void {
  ctx.clearRect(0, 0, s, s);
  ctx.imageSmoothingEnabled = false;
  const cx = s / 2;
  const cy = s / 2;

  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  const circle = (x: number, y: number, rad: number) => {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.closePath();
  };

  // ボール型カプセル（上半分の色＋中央バンド＋ボタン）。
  const drawBall = (topColor: string, mark: "moon" | "star") => {
    const rad = 12;
    // 下地（白）
    ctx.fillStyle = "#eef2f6";
    circle(cx, cy, rad);
    ctx.fill();
    // 上半分
    ctx.save();
    circle(cx, cy, rad);
    ctx.clip();
    ctx.fillStyle = topColor;
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad);
    // マーク
    if (mark === "moon") {
      ctx.fillStyle = "#fdfdff";
      circle(cx + 1, cy - 6, 4);
      ctx.fill();
      ctx.fillStyle = topColor;
      circle(cx + 3, cy - 7, 4);
      ctx.fill();
    } else {
      drawStar(ctx, cx, cy - 6, 4.5, 2, "#fff6cf");
    }
    ctx.restore();
    // バンド
    ctx.fillStyle = "#2b3140";
    ctx.fillRect(cx - rad, cy - 2, rad * 2, 4);
    // 中央ボタン
    ctx.fillStyle = "#ffffff";
    circle(cx, cy, 3.2);
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "#2b3140";
    circle(cx, cy, 3.2);
    ctx.stroke();
    // 外周
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#2b3140";
    circle(cx, cy, rad);
    ctx.stroke();
  };

  // 回復ジェルのボトル（中の液体色を変える）。
  const drawBottle = (liquid: string) => {
    // フタ
    ctx.fillStyle = "#c9ccd2";
    rr(cx - 4, cy - 13, 8, 4, 1.5);
    ctx.fill();
    // 首
    ctx.fillStyle = "#dfe6ee";
    ctx.fillRect(cx - 3, cy - 10, 6, 3);
    // 胴
    ctx.fillStyle = "#eef3f8";
    rr(cx - 8, cy - 8, 16, 19, 5);
    ctx.fill();
    // 液体
    ctx.save();
    rr(cx - 8, cy - 8, 16, 19, 5);
    ctx.clip();
    ctx.fillStyle = liquid;
    ctx.fillRect(cx - 8, cy - 1, 16, 12);
    ctx.restore();
    // 枠
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#2b3140";
    rr(cx - 8, cy - 8, 16, 19, 5);
    ctx.stroke();
    // ハイライト
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(cx - 5, cy - 5, 2, 11);
  };

  switch (id) {
    case "moon_capsule":
      drawBall("#5aa0e6", "moon");
      return;
    case "star_capsule":
      drawBall("#f3c33f", "star");
      return;
    case "repair_gel":
      drawBottle("#5fd06b");
      return;
    case "hi_repair_gel":
      drawBottle("#4aa8f0");
      return;
    case "full_repair_gel":
      drawBottle("#b06be0");
      return;
    case "moon_honey":
      drawBottle("#f0a92e");
      return;
    case "revive_star":
      drawStar(ctx, cx, cy, 12, 5.5, "#ffd94a");
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "#c98a12";
      drawStarPath(ctx, cx, cy, 12, 5.5);
      ctx.stroke();
      return;
    case "moon_sand": {
      // 砂の山
      ctx.fillStyle = "#e0cf9a";
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy + 9);
      ctx.quadraticCurveTo(cx, cy - 10, cx + 12, cy + 9);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#c9b477";
      for (const [dx, dy] of [[-4, 4], [3, 6], [0, 1], [6, 7]] as [number, number][]) {
        circle(cx + dx, cy + dy, 1.1);
        ctx.fill();
      }
      return;
    }
    case "debris_fragment": {
      // 金属片
      ctx.fillStyle = "#9aa4ad";
      ctx.beginPath();
      ctx.moveTo(cx - 9, cy + 6);
      ctx.lineTo(cx - 3, cy - 9);
      ctx.lineTo(cx + 8, cy - 4);
      ctx.lineTo(cx + 9, cy + 8);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = "#5c6670";
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillRect(cx - 3, cy - 6, 2, 8);
      return;
    }
    default:
      // フォールバック：カテゴリで判断。
      if (category === "capsule") drawBall("#5aa0e6", "moon");
      else if (category === "recovery") drawBottle("#5fd06b");
      else {
        // 汎用ポーチ
        ctx.fillStyle = "#b5793f";
        rr(cx - 9, cy - 6, 18, 15, 5);
        ctx.fill();
        ctx.fillStyle = "#8a5a2b";
        ctx.fillRect(cx - 9, cy - 6, 18, 4);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = "#5c3a17";
        rr(cx - 9, cy - 6, 18, 15, 5);
        ctx.stroke();
      }
      return;
  }
}

function drawStarPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number
): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  color: string
): void {
  drawStarPath(ctx, cx, cy, outer, inner);
  ctx.fillStyle = color;
  ctx.fill();
}

/** アイテムアイコンのテクスチャを（無ければ）生成して key を返す。 */
export function ensureItemIconTexture(
  scene: Phaser.Scene,
  id: string,
  category?: string
): string {
  const key = `itemicon-${id}`;
  if (scene.textures.exists(key)) return key;
  const S = 32;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  drawItemIcon(ctx, id, category, S);
  scene.textures.addCanvas(key, c);
  return key;
}
