// オンライン対戦の ネットクライアント（中継サーバーへ WebSocket 接続）。
// あいことば（ルームコード）で つなぎ、{t:"relay",data} で 相手と やり取りする。
// バトル本体（P2）は この上に 乗せる。ここは 接続と 転送だけを 担う。

export type NetRole = "host" | "guest";

export interface NetHandlers {
  onOpen?: () => void;
  onJoined?: (role: NetRole) => void;
  onPeerJoin?: (name: string) => void;
  onPeerLeave?: () => void;
  onData?: (data: unknown) => void;
  onFull?: () => void;
  onError?: (msg: string) => void;
  onClose?: () => void;
}

/** 中継サーバーの URL。ビルド時の環境変数 → 既定（本番の中継）。
 *  テスト時は window.__RELAY_URL__ で 差し替え可能。 */
export function relayUrl(): string {
  if (typeof window !== "undefined") {
    const o = (window as unknown as { __RELAY_URL__?: string }).__RELAY_URL__;
    if (typeof o === "string" && o) return o;
  }
  const env = process.env.NEXT_PUBLIC_BATTLE_RELAY_URL;
  if (env) return env;
  return "wss://usamon-battle-relay.onrender.com";
}

export class BattleNet {
  private ws?: WebSocket;
  role: NetRole = "host";
  code = "";
  name = "";
  private h: NetHandlers = {};

  connect(code: string, name: string, handlers: NetHandlers): void {
    this.code = code;
    this.name = name;
    this.h = handlers;
    let ws: WebSocket;
    try {
      ws = new WebSocket(relayUrl());
    } catch {
      handlers.onError?.("connect-failed");
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.h.onOpen?.();
      ws.send(JSON.stringify({ t: "join", room: code, name }));
    };
    ws.onmessage = (ev) => {
      let m: { t?: string; role?: NetRole; name?: string; data?: unknown; msg?: string };
      try { m = JSON.parse(ev.data as string); } catch { return; }
      switch (m.t) {
        case "joined": if (m.role) this.role = m.role; this.h.onJoined?.(this.role); break;
        case "peer-join": this.h.onPeerJoin?.(m.name || ""); break;
        case "peer-leave": this.h.onPeerLeave?.(); break;
        case "full": this.h.onFull?.(); break;
        case "relay": this.h.onData?.(m.data); break;
        case "error": this.h.onError?.(m.msg || "error"); break;
        default: break;
      }
    };
    ws.onerror = () => this.h.onError?.("socket-error");
    ws.onclose = () => this.h.onClose?.();
  }

  /** 相手へ データを 送る（中継が そのまま 転送する）。 */
  send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: "relay", data }));
    }
  }

  close(): void {
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = undefined;
    this.h = {};
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}
