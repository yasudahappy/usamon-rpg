# うさもんRPG こだわりアート生成指示書 v1

土台タイルは「Ninja Adventure Asset Pack(CC0)」を使用。
この指示書は、その上に重ねる**月面らしいこだわりパーツ**をAIで生成するためのもの。

## 共通ルール(全部の画像に共通で入れる条件)

- **形式**:見下ろし型2D(top-down / bird's-eye view)のゲーム用タイル・スプライト
- **画風**:GBA(ゲームボーイアドバンス)世代のドット絵、ルビー・サファイア風。太めの輪郭、はっきりした色、立体感のある陰影
- **解像度**:ドットがくっきりしたピクセルアート(pixel art)。1タイル=32×32ピクセル基準
- **背景**:透過(transparent background)。※タイルの場合は「上下左右つなげても継ぎ目が出ない=シームレス(seamless / tileable)」であること
- **禁止**:写実的な3D、ぼやけた絵、実写、既存キャラの流用

---

## ① 砂地タイル(砂場ルート1・エンカウント地帯)

**用途**:草むら代わりの、野生モンスターが出る地面
**イメージ**:明るいクリーム色。ベースがキラキラ光る月の砂

### 生成プロンプト(英語)
```
top-down 2D game tile, seamless tileable ground texture, moon surface sand,
bright cream-colored fine sand, subtle sparkle and glitter specks scattered on the surface,
GBA Pokemon Ruby Sapphire style pixel art, 32x32 tile, crisp pixels,
soft shading for depth, cute and bright, transparent edges seamless
```

### 生成プロンプト(日本語での意図)
明るいクリーム色の、きめ細かい月の砂。表面にキラキラした光る粒が点々と散らばる。GBAルビサファ風ドット絵。継ぎ目なくつながるタイル。立体感のある柔らかい陰影。

---

## ② クレーターの青白い砂地(先のステージ・クレーター内)

**用途**:後半ステージ、クレーターの中のエンカウント地帯
**イメージ**:青白く冷たい月の砂

### 生成プロンプト(英語)
```
top-down 2D game tile, seamless tileable ground texture, lunar crater sand,
cold pale blue-white moon dust, faint blue glow, sparkle specks,
GBA Pokemon Ruby Sapphire style pixel art, 32x32 tile, crisp pixels,
soft shading for depth, mysterious and cool tone, transparent edges seamless
```

### 意図
青白く冷たい月のダスト。ほのかに青く光り、キラキラした粒。神秘的でクールな雰囲気。①より寒色。

---

## ③ ムーンベース(基地)の建物 — グランピングドーム風

**用途**:スタート地点の基地。プレイヤーが最初に降り立つ場所
**イメージ**:グランピングみたいな、白くて丸い居心地の良さそうな未来ドーム

### 生成プロンプト(英語)
```
top-down 2D game building sprite, futuristic glamping dome habitat on the moon,
white and cream rounded dome with large glass window, cozy and inviting,
small solar panels and antenna, warm light glowing inside,
GBA Pokemon Ruby Sapphire style pixel art, crisp pixels, soft shading,
cute and bright, transparent background
```

### 意図
白〜クリーム色の丸いドーム型の建物。大きなガラス窓、中から暖かい光。小さなソーラーパネルやアンテナ。かわいくて明るい、居心地の良さそうな月面のグランピング基地。

---

## ④ 巨大望遠鏡(ランドマーク)

**用途**:基地や特定の街に置く、月面らしい大きな目印
**イメージ**:月から宇宙を眺める巨大望遠鏡

### 生成プロンプト(英語)
```
top-down 2D game structure sprite, giant white observatory telescope on the moon,
large rounded dome with an opening slit, big telescope pointing to the sky,
metallic white and silver, GBA Pokemon Ruby Sapphire style pixel art,
crisp pixels, soft shading, impressive landmark, transparent background
```

### 意図
白い巨大な天文台ドームと、空に向いた大きな望遠鏡。金属的な白・銀。街のランドマークになる存在感。

---

## ⑤ カラフルなカプセルハウス(街の家々)

**用途**:カプセルタウン(コンセプト街の1つ)の民家
**イメージ**:カラフルなカプセル型の家。色ちがいで何軒か並べる

### 生成プロンプト(英語)
```
top-down 2D game building sprite, cute capsule-shaped house on the moon,
rounded pod home with a round door and small window,
pastel colors (mint, coral, yellow, sky blue) — generate color variations,
GBA Pokemon Ruby Sapphire style pixel art, crisp pixels, soft shading,
cheerful and bright, transparent background
```

### 意図
丸いカプセル型のかわいい家。丸いドアと小さな窓。パステルカラー(ミント・コーラル・イエロー・水色)で色ちがいを複数。明るく楽しい雰囲気。

---

## 街のコンセプト案(今後の拡張用メモ)

街ごとに個性を持たせる。※名前・詳細は今後決める。
- **クレーターシティ**(既存):クレーターのふちに作られた最初の街。標準的
- **カプセルタウン(仮)**:カラフルなカプセルハウスが並ぶポップな居住区
- **オブザバトリー(仮)**:巨大望遠鏡を中心にした、天文・研究の街
- (以降、青白いクレーター地帯の先に神秘的な街…など、世界観を広げる余地あり)

---

## 生成のコツ・注意(バイブコーダー向けメモ)

1. **1個ずつ生成する**:一気に全部作らず、まず①砂地から。うまくいったら次へ
2. **「seamless / tileable」が超重要**(タイルの場合):これが抜けると、地面を並べたとき継ぎ目が出てガタガタになる
3. **色が違ったら「もっとクリーム色で」「もっと明るく」と指示して作り直す**:一発で決まらなくてOK。うさもんの3面図と同じで、何回か調整する
4. **できた画像はGitHubの assets/ フォルダに入れる**:ファイル名は英語でわかりやすく(例:sand_cream.png, dome_base.png)
5. ケンに渡すときは「この画像を○○のタイル/建物として組み込んで」と伝える
