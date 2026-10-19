/**
 * One-shot JSON-RPC-style calls to the whatsapp-connector daemon over its unix
 * socket (`POST /rpc` with `{ cmd, args }`), mirroring daemon/src/rpc-client.js.
 * The daemon answers `{ ok: true, data }` or `{ ok: false, error, code }`.
 */
import { request } from "node:http";

export class DaemonError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "DaemonError";
    this.code = code;
  }
}

export interface DaemonRpcOptions {
  socketPath: string;
  /** Milliseconds before a call is given up as DAEMON_DOWN. Default 15 000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class DaemonRpc {
  private readonly socketPath: string;
  private readonly timeoutMs: number;

  constructor(opts: DaemonRpcOptions) {
    this.socketPath = opts.socketPath;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  call<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    const data = JSON.stringify({ cmd, args });
    return new Promise<T>((resolve, reject) => {
      const req = request(
        { socketPath: this.socketPath, path: "/rpc", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c: string) => { body += c; });
          res.on("end", () => {
            let parsed: { ok?: boolean; data?: T; error?: string; code?: string };
            try {
              parsed = JSON.parse(body) as typeof parsed;
            } catch {
              reject(new DaemonError(`daemon returned invalid JSON: ${body.slice(0, 120)}`, "BAD_RESPONSE"));
              return;
            }
            if (parsed.ok) resolve(parsed.data as T);
            else reject(new DaemonError(parsed.error ?? "daemon error", parsed.code ?? "ERR"));
          });
        },
      );
      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new DaemonError(`daemon did not answer within ${this.timeoutMs} ms`, "DAEMON_DOWN"));
      });
      req.on("error", (err: NodeJS.ErrnoException) => {
        if (err instanceof DaemonError) reject(err);
        else reject(new DaemonError(`daemon unreachable: ${err.message}`, "DAEMON_DOWN"));
      });
      req.write(data);
      req.end();
    });
  }
}
