// うさもんRPG オンライン対戦 中継サーバー（WebSocket リレー）。
//
// 役割は「あいことば（ルームコード）で 2人を つなぎ、メッセージを 相手へ
// そのまま 転送する」だけ。バトルの計算やデータは 一切 見ない（中継のみ）。
// ターン制なので 低頻度・小さな JSON で足りる。
//
// ローカル起動:  PORT=8787 node server.mjs
// 本番:          Render / Railway / Fly など Node ホストで `npm start`
//                （PORT は 環境変数で 与えられる）。
//
// プロトコル（JSON・1メッセージ=1フレーム）:
//   C->S {t:"join", room:"ABCD", name?:"..."}   ルーム参加
//   S->C {t:"joined", role:"host"|"guest", room, id}
//   S->C {t:"peer-join", name?}                 相手が入室（対戦開始可）
//   S->C {t:"peer-leave"}                        相手が退出/切断
//   S->C {t:"full"}                              満室で入れなかった（この後 切断）
//   S->C {t:"error", msg}
//   C->S {t:"relay", data:<任意>}   -> S->C {t:"relay", data:<任意>}（相手へ転送）
//   C<->S {t:"ping"} / {t:"pong"}                死活監視（任意）

import http from "node:http";
import { WebSocketServer } from "ws";
import { Rooms, normalizeCode } from "./rooms.mjs";

const PORT = Number(process.env.PORT) || 8787;
const MAX_MSG_BYTES = 64 * 1024; // 1メッセージ上限（暴走・悪用よけ）
const rooms = new Rooms();
let nextId = 1;

// ヘルスチェック用の HTTP（Render 等は ポート待受＋200 が要る）。
const httpServer = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("usamon-battle-relay ok");
  } else {
    res.writeHead(404); res.end();
  }
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MSG_BYTES });

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

wss.on("connection", (ws) => {
  const client = { id: nextId++, room: null, role: null, send: (obj) => send(ws, obj) };
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.t !== "string") return;

    switch (msg.t) {
      case "join": {
        if (client.room) { client.send({ t: "error", msg: "already-in-room" }); return; }
        const code = normalizeCode(msg.room);
        if (!code) { client.send({ t: "error", msg: "bad-code" }); return; }
        const r = rooms.join(code, client);
        if (!r.ok) { client.send({ t: "full" }); ws.close(); return; }
        client.name = typeof msg.name === "string" ? msg.name.slice(0, 24) : "";
        client.send({ t: "joined", role: r.role, room: code, id: client.id });
        // すでに 相手がいれば 両者に 開始を通知
        for (const peer of r.peers) {
          peer.send({ t: "peer-join", name: client.name });
          client.send({ t: "peer-join", name: peer.name || "" });
        }
        break;
      }
      case "relay": {
        const peer = rooms.peerOf(client);
        if (peer) peer.send({ t: "relay", data: msg.data });
        break;
      }
      case "ping": client.send({ t: "pong" }); break;
      case "pong": break;
      default: break;
    }
  });

  ws.on("close", () => {
    const peers = rooms.leave(client);
    for (const peer of peers) peer.send({ t: "peer-leave" });
  });
  ws.on("error", () => { try { ws.close(); } catch { /* noop */ } });
});

// 30秒ごとに 死活監視（無反応は 切断）。
const hb = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* noop */ }
  }
}, 30000);
wss.on("close", () => clearInterval(hb));

httpServer.listen(PORT, () => {
  console.log(`[relay] listening on :${PORT}`);
});
