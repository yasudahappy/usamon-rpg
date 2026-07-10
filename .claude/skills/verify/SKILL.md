---
name: verify
description: usamon-rpg をローカルで起動して実際に操作・スクリーンショット検証する手順
---

# usamon-rpg の動作検証手順

Next.js の静的エクスポート（`output: "export"` + `basePath: "/usamon-rpg"`）なので
`next start` は使えない。以下の手順で検証する。

## ビルドと起動

```bash
npm run build                 # out/ に静的エクスポートが生成される
mkdir -p /tmp/site && ln -sfn "$PWD/out" /tmp/site/usamon-rpg
cd /tmp/site && python3 -m http.server 3210 &
# → http://localhost:3210/usamon-rpg/ を開く（basePath 必須。ルート直下だと 404 になる）
```

## 操作の駆動（Playwright）

- ビューポートはモバイル縦（例 390x844）。canvas（Phaser）が上 7 割、下 3 割が React 製ゲームパッド。
- ゲームパッドは DOM 要素: 十字キーは「▲▼◀▶」のテキストを持つ div（mousedown/mouseup）、
  A/B/MENU は pointerdown。**十字キーは mousedown を 100ms 以上ホールド**しないと
  Phaser のフレームが取りこぼす。
- シーン側は `window.__gamepad`（dpad / aJust / bJust / menuJust）をポーリングする方式。
- 初回ロードは BootScene → SetupScene に約 2.5 秒かかる。セーブがあると SetupScene を
  スキップするので、初期化するには `localStorage.removeItem("usamon-player-setup")`。
- 進行確認は canvas のスクリーンショット + `localStorage.getItem("usamon-player-setup")`。

## 注意

- ブラウザは `/opt/pw-browsers/chromium` を `executablePath` に指定（playwright-core で可）。
- Google Fonts (DotGothic16) が落ちてこない環境でも代替フォントで描画されるので検証は可能。
