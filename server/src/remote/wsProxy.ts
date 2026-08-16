import net from "node:net";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Request, RequestHandler, Response } from "express";
import WebSocket, { WebSocketServer } from "ws";
import { getWorkstation } from "../workstation/repository.js";

const VNC_WS_PATH_RE = /^\/ws\/vnc\/(\d+)$/;

// Browser never supplies a host/IP — only a workstationId in the URL.
// The target IP:port is resolved here from the database. See
// docs/ARCHITECTURE.md and docs/SECURITY.md.
//
// sessionMiddleware is the same instance the Express app uses. This
// upgrade handler runs outside Express's normal request pipeline (raw
// http "upgrade" event, no res object), but express-session only reads
// req.headers.cookie and attaches req.session — it works fine invoked
// directly like this. That's why req/res below are cast through unknown
// rather than typed as IncomingMessage/{}: they don't structurally match
// Express's Request/Response, but express-session only touches the
// subset of properties that actually exist here.
export function setupVncProxy(server: HttpServer, sessionMiddleware: RequestHandler): void {
  // perMessageDeflate off: VNC framebuffer updates are frequent and often
  // already compressed by the RFB encoding (Tight/ZRLE); re-deflating them
  // on a LAN (bandwidth is not the bottleneck) only adds CPU + latency.
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    const match = VNC_WS_PATH_RE.exec(path);
    if (!match) {
      socket.destroy();
      return;
    }

    const sessionReq = req as unknown as Request;
    sessionMiddleware(sessionReq, {} as unknown as Response, () => {
      if (!sessionReq.session?.userId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const id = Number(match[1]);
      const workstation = getWorkstation(id);
      if (!workstation || !workstation.enabled) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      // Nagle's algorithm is on by default and can hold small interactive
      // packets (mouse/keyboard, small framebuffer deltas) for tens of ms
      // before sending — disable it on both legs of the bridge. Node's
      // "upgrade" event types `socket` as the generic `stream.Duplex`
      // (shared with HTTP/2, where it wouldn't be a raw TCP socket), but
      // this is a plain http.Server, so it's always actually a net.Socket.
      (socket as net.Socket).setNoDelay(true);

      wss.handleUpgrade(req, socket, head, (ws) => {
        bridgeToVnc(ws, workstation.ip, workstation.vnc_port);
      });
    });
  });
}

function bridgeToVnc(ws: WebSocket, host: string, port: number): void {
  const tcpSocket = net.connect(port, host);
  tcpSocket.setNoDelay(true);
  let tcpReady = false;
  const pending: Buffer[] = [];

  tcpSocket.on("connect", () => {
    tcpReady = true;
    for (const chunk of pending.splice(0)) {
      tcpSocket.write(chunk);
    }
  });

  tcpSocket.on("data", (data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  });

  ws.on("message", (data) => {
    // ws's RawData can be Buffer | ArrayBuffer | Buffer[]; Buffer.from
    // handles all three at runtime, so the cast is safe here.
    const chunk = Buffer.from(data as Buffer);
    if (tcpReady) {
      tcpSocket.write(chunk);
    } else {
      pending.push(chunk);
    }
  });

  const cleanup = () => {
    tcpSocket.destroy();
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
      ws.close();
    }
  };

  tcpSocket.on("error", cleanup);
  tcpSocket.on("close", cleanup);
  ws.on("error", cleanup);
  ws.on("close", cleanup);
}
