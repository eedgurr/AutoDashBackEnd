/**
 * Minimal text WebSocket helpers (no npm deps).
 * Good enough for autodash-demo JSON lines.
 */
import crypto from "crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function acceptKey(secWebSocketKey) {
  return crypto
    .createHash("sha1")
    .update(secWebSocketKey + GUID)
    .digest("base64");
}

export function decodeTextFrame(buffer) {
  if (buffer.length < 2) return null;
  const second = buffer[1];
  const masked = (second & 0x80) !== 0;
  let len = second & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buffer.length < 4) return null;
    len = buffer.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    return null; // not needed for demo telemetry
  }
  const maskOffset = offset;
  const dataOffset = masked ? offset + 4 : offset;
  if (buffer.length < dataOffset + len) return null;
  const payload = Buffer.alloc(len);
  if (masked) {
    const mask = buffer.slice(maskOffset, maskOffset + 4);
    for (let i = 0; i < len; i += 1) {
      payload[i] = buffer[dataOffset + i] ^ mask[i % 4];
    }
  } else {
    buffer.copy(payload, 0, dataOffset, dataOffset + len);
  }
  const opcode = buffer[0] & 0x0f;
  return {
    opcode,
    payload,
    totalLength: dataOffset + len,
  };
}

export function encodeTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  }
  return Buffer.concat([header, payload]);
}

export function attachWebSocketServer(httpServer, { onConnection }) {
  httpServer.on("upgrade", (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/ws")) {
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = acceptKey(key);
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        "\r\n"
    );

    let buffer = Buffer.alloc(0);
    const client = {
      send(obj) {
        const frame = encodeTextFrame(
          typeof obj === "string" ? obj : JSON.stringify(obj)
        );
        socket.write(frame);
      },
      close() {
        socket.end();
      },
    };

    onConnection(client, req);

    if (head && head.length) buffer = Buffer.concat([buffer, head]);

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const frame = decodeTextFrame(buffer);
        if (!frame) break;
        buffer = buffer.slice(frame.totalLength);
        if (frame.opcode === 0x8) {
          socket.end();
          return;
        }
        if (frame.opcode === 0x1) {
          const text = frame.payload.toString("utf8");
          if (client.onMessage) client.onMessage(text);
        }
      }
    });

    socket.on("close", () => {
      if (client.onClose) client.onClose();
    });
    socket.on("error", () => {
      if (client.onClose) client.onClose();
    });
  });
}
