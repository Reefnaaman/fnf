import { afterEach, describe, expect, it } from "vitest";
import { DaemonError, DaemonRpc } from "../src/rpc.js";
import { startFakeDaemon, type FakeDaemon } from "./fake-daemon.js";

const daemons: FakeDaemon[] = [];
afterEach(async () => { for (const d of daemons.splice(0)) await d.close().catch(() => undefined); });

describe("DaemonRpc", () => {
  it("call returns data and maps daemon errors to DaemonError codes", async () => {
    const d = await startFakeDaemon(); daemons.push(d);
    const rpc = new DaemonRpc({ socketPath: d.socketPath });
    await expect(rpc.call("status")).resolves.toMatchObject({ ready: true });
    const failure = rpc.call("send", { chat: "nope", text: "x" });
    await expect(failure).rejects.toBeInstanceOf(DaemonError);
    await expect(failure).rejects.toMatchObject({ code: "NOT_FOUND" });
    await d.close();
    await expect(rpc.call("status")).rejects.toMatchObject({ code: "DAEMON_DOWN" });
  });

  it("a slow daemon times out as DAEMON_DOWN", async () => {
    const d = await startFakeDaemon(); daemons.push(d);
    d.delayMs = 200;
    const rpc = new DaemonRpc({ socketPath: d.socketPath, timeoutMs: 20 });
    await expect(rpc.call("status")).rejects.toMatchObject({ code: "DAEMON_DOWN" });
  });
});
