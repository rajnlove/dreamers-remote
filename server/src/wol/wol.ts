import dgram from "node:dgram";

const DEFAULT_WOL_PORT = 9;
const DEFAULT_BROADCAST_ADDRESS = "255.255.255.255";

function macToBytes(mac: string): Buffer {
  const hex = mac.replace(/[:-]/g, "");
  if (!/^[0-9A-Fa-f]{12}$/.test(hex)) {
    throw new Error(`Invalid MAC address: ${mac}`);
  }
  return Buffer.from(hex, "hex");
}

export function buildMagicPacket(mac: string): Buffer {
  const macBytes = macToBytes(mac);
  const header = Buffer.alloc(6, 0xff);
  return Buffer.concat([header, ...Array<Buffer>(16).fill(macBytes)]);
}

export function sendMagicPacket(
  mac: string,
  broadcastAddress: string = DEFAULT_BROADCAST_ADDRESS,
  port: number = DEFAULT_WOL_PORT,
): Promise<void> {
  const packet = buildMagicPacket(mac);

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", (err) => {
      socket.close();
      reject(err);
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, port, broadcastAddress, (err) => {
        socket.close();
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });
}
