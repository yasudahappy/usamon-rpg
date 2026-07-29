// あいことば（ルームコード）で 2人を つなぐ ための、トランスポート非依存の
// ルーム管理。テストしやすいように WebSocket などには 直接 依存しない。
// client は { id, room?, role?, send(obj) } を満たすオブジェクト。

export class Rooms {
  constructor() {
    /** code -> client[]（最大2） */
    this.rooms = new Map();
  }

  /** ルームに参加。1人目=host、2人目=guest。満室なら {ok:false}。 */
  join(code, client) {
    let arr = this.rooms.get(code);
    if (!arr) { arr = []; this.rooms.set(code, arr); }
    if (arr.length >= 2) return { ok: false, reason: "full" };
    const role = arr.length === 0 ? "host" : "guest";
    client.room = code;
    client.role = role;
    arr.push(client);
    return { ok: true, role, peers: arr.filter((c) => c !== client) };
  }

  /** 退出。残った相手（配列）を返す。ルームが空になったら破棄。 */
  leave(client) {
    if (!client || !client.room) return [];
    const arr = this.rooms.get(client.room);
    if (!arr) return [];
    const i = arr.indexOf(client);
    if (i >= 0) arr.splice(i, 1);
    const peers = arr.slice();
    if (arr.length === 0) this.rooms.delete(client.room);
    return peers;
  }

  /** 同室のもう片方（いなければ null）。 */
  peerOf(client) {
    if (!client || !client.room) return null;
    const arr = this.rooms.get(client.room);
    if (!arr) return null;
    return arr.find((c) => c !== client) || null;
  }

  get roomCount() { return this.rooms.size; }
}

/** ルームコードの正規化＆検証（英数4〜8桁・大文字化）。 */
export function normalizeCode(raw) {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9]{4,8}$/.test(code) ? code : null;
}
