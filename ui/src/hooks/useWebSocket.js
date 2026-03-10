import { useEffect, useRef, useState } from 'react';

export function useWebSocket(onMessage) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const retryCountRef = useRef(0);
  const onMessageRef = useRef(onMessage);

  // Keep ref in sync so the stable WS handler always calls the latest callback
  onMessageRef.current = onMessage;

  const connect = () => {
    // API is on port 8091 (UI is on 8090)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') {
      console.log('[ws] Remote environment detected, skipping WebSocket. Falling back to polling.');
      setConnected(false);
      return;
    }

    const port = 8091;

    console.log(`[ws] Connecting to ${protocol}//${host}:${port}...`);
    const socket = new WebSocket(`${protocol}//${host}:${port}`);

    socket.onopen = () => {
      console.log('[ws] Connected');
      setConnected(true);
      retryCountRef.current = 0;
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (onMessageRef.current) onMessageRef.current(msg);
      } catch (err) {
        console.error('[ws] Failed to parse message:', err);
      }
    };

    socket.onclose = () => {
      console.log('[ws] Disconnected');
      setConnected(false);
      socketRef.current = null;

      // Exponential backoff
      const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
      retryCountRef.current++;
      console.log(`[ws] Reconnecting in ${delay}ms...`);
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    socket.onerror = (err) => {
      console.error('[ws] Error:', err);
      socket.close();
    };

    socketRef.current = socket;
  };

  useEffect(() => {
    connect();
    return () => {
      if (socketRef.current) socketRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, []);

  return connected;
}
