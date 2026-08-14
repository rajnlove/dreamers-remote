import net from "node:net";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { getWorkstation } from "../workstation/repository.js";

const VNC_WS_PATH_RE = /^\/ws\/vnc\/(\d+)$/;

// Browser never supplies a host/IP — only a workstationId in the URL.
// The target IP:port is resolved here from the database. See
// docs/ARCHITECTURE.md and docs/SECURITY.md.
export function setupVncProxy(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    const match = VNC_WS_PATH_RE.exec(path);
    if (!match) {
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

    wss.handleUpgrade(req, socket, head, (ws) => {
      bridgeToVnc(ws, workstation.ip, workstation.vnc_port);
    });
  });
}

function bridgeToVnc(ws: WebSocket, host: string, port: number): void {
  const tcpSocket = net.connect(port, host);
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
