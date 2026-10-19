import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { FylgjaError } from "../src/fylgja/errors";
import { createHttp } from "../src/fylgja/http";

interface Seen {
  method: string;
  url: string;
  rawHeaders: string[];
  body: string;
}

interface Loopback {
  server: Server;
  port: number;
  seen: Seen[];
}

const servers: { server: Server; sockets: Set<Socket> }[] = [];

/** A server on 127.0.0.1:0 that records each request and answers through `handler` (no answer when it returns). */
async function start(handler: (req: IncomingMessage, res: ServerResponse, port: number) => void): Promise<Loopback> {
  const seen: Seen[] = [];
  const sockets = new Set<Socket>();
  let port = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", rawHeaders: req.rawHeaders, body });
      handler(req, res, port);
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  servers.push({ server, sockets });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  return { server, port, seen };
}

function close(entry: { server: Server; sockets: Set<Socket> }): Promise<void> {
  for (const socket of entry.sockets) socket.destroy();
  entry.server.closeAllConnections();
  return new Promise((resolve) => (entry.server.listening ? entry.server.close(() => resolve()) : resolve()));
}

async function closeAll(): Promise<void> {
  await Promise.all(servers.splice(0).map(close));
}

afterEach(closeAll);
afterAll(closeAll);

function answerJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function http(port: number) {
  return createHttp({
    baseUrl: `http://127.0.0.1:${port}`,
    secretFile: "/s/api-secret",
    fetch: (url, init) => fetch(url, init),
    readFile: async () => "abc\n",
    homedir: () => "/home/x",
  });
}

/** The values of header `name` as they came over the wire (case-insensitive, duplicates kept). */
function headerValues(seen: Seen, name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < seen.rawHeaders.length; i += 2) {
    if (seen.rawHeaders[i].toLowerCase() === name) values.push(seen.rawHeaders[i + 1]);
  }
  return values;
}

async function failure(promise: Promise<unknown>): Promise<FylgjaError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(FylgjaError);
    return err as FylgjaError;
  }
  throw new Error("expected a FylgjaError");
}

describe("the request core over a real loopback socket", () => {
  it("sends a GET without authorization or origin and with the loopback Host", async () => {
    const daemon = await start((_req, res) => answerJson(res, 200, { schema: "fylgja.items/1" }));
    const answer = await http(daemon.port).get("/items", { open: true });
    expect(answer).toEqual({ status: 200, json: { schema: "fylgja.items/1" } });
    expect(daemon.seen).toHaveLength(1);
    const [request] = daemon.seen;
    expect(request.method).toBe("GET");
    expect(request.url).toBe("/items?open=true");
    expect(headerValues(request, "authorization")).toEqual([]);
    expect(headerValues(request, "origin")).toEqual([]);
    expect(headerValues(request, "host")).toEqual([`127.0.0.1:${daemon.port}`]);
    expect(request.body).toBe("");
  });

  it("sends a POST with one bearer, one JSON content type, no origin and the body {}", async () => {
    const daemon = await start((_req, res) => answerJson(res, 200, { focused: "window", via: "aerospace" }));
    const answer = await http(daemon.port).send("POST", "/focus/window/1");
    expect(answer.status).toBe(200);
    const [request] = daemon.seen;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/focus/window/1");
    expect(headerValues(request, "authorization")).toEqual(["Bearer abc"]);
    expect(headerValues(request, "content-type")).toEqual(["application/json"]);
    expect(headerValues(request, "origin")).toEqual([]);
    expect(headerValues(request, "host")).toEqual([`127.0.0.1:${daemon.port}`]);
    expect(request.body).toBe("{}");
  });

  it("reports a closed port as daemon_down", async () => {
    const gone = await start((_req, res) => answerJson(res, 200, {}));
    await closeAll();
    const err = await failure(http(gone.port).get("/items"));
    expect(err.kind).toBe("daemon_down");
    expect(err.message).toBe(`The Fylgja daemon is not running on 127.0.0.1:${gone.port}`);
  });

  it("refuses a redirect, so the bearer never reaches the target", async () => {
    const target = await start((_req, res) => answerJson(res, 200, {}));
    const daemon = await start((_req, res) => {
      res.writeHead(307, { location: `http://127.0.0.1:${target.port}/focus/window/1`, "content-length": 0 });
      res.end();
    });
    for (const call of [
      () => http(daemon.port).send("POST", "/focus/window/1"),
      () => http(daemon.port).get("/items"),
    ]) {
      const err = await failure(call());
      expect(err.kind).toBe("bad_response");
    }
    expect(daemon.seen).toHaveLength(2);
    expect(target.seen).toHaveLength(0);
  });

  it("times out on a server that never answers and leaves no open handle", async () => {
    const daemon = await start(() => undefined);
    const started = Date.now();
    const err = await failure(http(daemon.port).get("/items", {}, { timeoutMs: 300 }));
    expect(err.kind).toBe("timeout");
    expect(err.message).toBe("Fylgja did not answer within 0.3 s");
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(daemon.seen).toHaveLength(1);
  });
});
