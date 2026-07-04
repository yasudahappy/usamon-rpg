# うさもんRPG

月面を舞台にしたモンスター収集RPG。Next.js + TypeScript + Phaser 3 で構築。

## セットアップ

```bash
npm install
npm run dev
```

ブラウザで http://localhost:3000 を開く。

## 操作方法

- **PC**: 矢印キー or WASD で移動
- **スマホ**: 画面左下の仮想十字キーで移動

## プロジェクト構成

```
app/
  game/
    config.ts         # Phaser 設定
    types.ts          # TypeScript 型定義
    PhaserGame.tsx    # Phaser ホスティングコンポーネント
    scenes/
      BootScene.ts    # アセット生成・ロード
      MapScene.ts     # マップ表示・移動
  page.tsx            # メインページ
  layout.tsx          # レイアウト
public/
  data/
    maps/             # マップデータ (JSON)
    monsters/         # モンスターデータ (JSON)
    moves/            # 技データ (JSON)
    types.json        # タイプ相性データ
```

## タイプ相性

8タイプ、2サイクル構成:
- **サイクルA**: 炎→氷→ガス→砂→炎
- **サイクルB**: 光→影→電→金属→光
- サイクル内: 攻撃側→被攻撃側で2.0倍、逆で0.5倍
- サイクル間: 常に1.0倍
