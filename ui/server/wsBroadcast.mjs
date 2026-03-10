// ui/server/wsBroadcast.mjs
import { WebSocketServer } from 'ws';

let wss;
const clients = new Set();

export function initWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[ws] Client connected. Total clients: ${clients.size}`);

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[ws] Client disconnected. Total clients: ${clients.size}`);
    });

    ws.on('error', (err) => {
      console.error('[ws] Error:', err);
      clients.delete(ws);
    });
  });

  console.log('[ws] WebSocket server initialized');
}

export function broadcast(event, data) {
  if (!wss) return;
  const message = JSON.stringify({ event, data });
  for (const client of clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  }
}
