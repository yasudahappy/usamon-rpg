# うさもんRPG オンライン対戦 中継サーバー（battle-relay）

「あいことば（ルームコード）」で **2人を つなぎ、メッセージを 相手へ そのまま
転送する** だけの、小さな WebSocket 中継サーバーです。バトルの計算やデータは
一切 見ません（純粋な中継）。ターン制なので 低頻度・小さな JSON で足ります。

ゲーム本体（GitHub Pages の静的サイト）は今まで通り。**この中継サーバーだけ**
別ホストに置き、その **wss:// の URL** をゲーム側に設定します。

## ローカルで動かす

```bash
cd netcode/relay
npm install
PORT=8787 npm start
# → ws://localhost:8787 に接続できる
```

## プロトコル（JSON・1メッセージ=1フレーム）

| 向き | メッセージ | 意味 |
|------|-----------|------|
| C→S | `{t:"join", room:"ABCD", name?}` | ルーム参加（code は英数4〜8桁・大文字化） |
| S→C | `{t:"joined", role:"host"\|"guest", room, id}` | 参加成功。1人目=host / 2人目=guest |
| S→C | `{t:"peer-join", name?}` | 相手が入室（対戦開始できる） |
| S→C | `{t:"peer-leave"}` | 相手が退出/切断 |
| S→C | `{t:"full"}` | 満室で入れなかった（この後 切断） |
| C→S | `{t:"relay", data:<任意>}` | → 相手に `{t:"relay", data}` を転送 |
| C↔S | `{t:"ping"}` / `{t:"pong"}` | 死活監視（任意） |

- 1メッセージ上限 64KB、30秒ごとに死活監視。`GET /health` は `200` を返す。

## デプロイ（別ホスト）

`PORT` 環境変数を読むだけなので、Node が動くところなら どこでも動きます。

### Render / Railway / Fly（Node ホスト・おすすめ）
- リポジトリを連携し、**Root Directory = `netcode/relay`**、Build = `npm install`、
  Start = `npm start`。無料枠でOK（アイドルでスリープする点だけ注意）。
- 公開URLが `https://xxx.onrender.com` なら、ゲーム側の接続先は
  `wss://xxx.onrender.com` になります（`https`→`wss`）。

### PartyKit（`ws` 不要・エッジ）
`party/battle.ts` を作り、同じ振り分けを書くだけ:
```ts
export default class BattleRoom {
  constructor(readonly room: Party.Room) {}
  onConnect(conn: Party.Connection) {
    if ([...this.room.getConnections()].length > 2) { conn.close(); return; }
    // 1人目=host / 2人目=guest を conn.setState で持たせ、
    // onMessage では room 内の「相手」に そのまま broadcast(除外=送信者) する。
  }
  onMessage(msg: string, sender: Party.Connection) {
    this.room.broadcast(msg, [sender.id]); // 相手だけに転送
  }
}
```
`npx partykit deploy` で `https://<proj>.<user>.partykit.dev` が得られ、
ゲーム側は `wss://<proj>.<user>.partykit.dev/parties/battle/<roomCode>` に つなぐ。

### Cloudflare Workers + Durable Objects
Durable Object を「1ルーム」に見立て、`WebSocketPair` で 2接続を保持して
相手へ転送。ルームコードを Object 名にすると そのまま マッチングになる。

## ゲーム側に渡すもの
デプロイ後の **`wss://…` の URL** を教えてください。ゲームの
`NEXT_PUBLIC_BATTLE_RELAY_URL`（環境変数）に設定すると、対戦メニューが
有効になります（未設定なら 対戦メニューは 出しません）。
