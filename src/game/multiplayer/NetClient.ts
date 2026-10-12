import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from "../../../shared/protocol";

/** Cliente WebSocket mínimo: conecta, envía mensajes JSON y entrega los del servidor a un callback. */
export class NetClient {
  private ws: WebSocket | null = null;
  onMessage: (m: ServerMsg) => void = () => {};
  onClose: (reason: string) => void = () => {};
  /** Latencia de ida y vuelta (ms), suavizada. */
  ping = 0;
  private pingTimer = 0;
  private closedByUs = false;

  static defaultUrl(): string {
    const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_SERVER_URL;
    if (env) return env;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    // build de producción: el mismo servidor que sirve la página atiende el WebSocket (mismo origen);
    // en desarrollo (Vite en :5173) el servidor de juego corre aparte en :8080
    const prod = (import.meta as unknown as { env: { PROD?: boolean } }).env.PROD;
    return prod ? `${proto}://${location.host}` : `${proto}://${location.hostname}:8080`;
  }

  connect(url: string, name: string, idToken?: string, timeoutMs = 6000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(new Error("Dirección del servidor no válida"));
        return;
      }
      this.ws = ws;
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {
          /* ya cerrado */
        }
        reject(new Error(msg));
      };
      const timer = window.setTimeout(() => fail("Tiempo de espera agotado conectando con el servidor"), timeoutMs);
      ws.onopen = () => this.send({ t: "join", v: PROTOCOL_VERSION, name, idToken });
      ws.onerror = () => fail(`No se pudo conectar con ${url}`);
      ws.onmessage = (e) => {
        let m: ServerMsg;
        try {
          m = JSON.parse(e.data as string) as ServerMsg;
        } catch {
          return;
        }
        if (m.t === "welcome" && !settled) {
          settled = true;
          window.clearTimeout(timer);
          resolve();
        } else if (m.t === "error" && !settled) {
          fail(m.msg);
          return;
        }
        if (m.t === "pong") this.ping = this.ping === 0 ? performance.now() - m.c : this.ping * 0.8 + (performance.now() - m.c) * 0.2;
        this.onMessage(m);
      };
      ws.onclose = () => {
        window.clearTimeout(timer);
        window.clearInterval(this.pingTimer);
        if (!settled) fail("Conexión cerrada por el servidor");
        else if (!this.closedByUs) this.onClose("Conexión perdida con el servidor");
      };
      this.pingTimer = window.setInterval(() => this.send({ t: "ping", c: performance.now() }), 2000);
    });
  }

  /** URL HTTP(S) del mismo servidor a partir de la del WebSocket (para la API del ranking). */
  static httpBase(wsUrl: string): string {
    return wsUrl.replace(/^ws(s?):/i, "http$1:").replace(/\/+$/, "");
  }

  send(m: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.closedByUs = true;
    window.clearInterval(this.pingTimer);
    this.ws?.close();
  }
}
