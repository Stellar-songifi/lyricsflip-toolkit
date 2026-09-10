import { io, Socket } from 'socket.io-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

let socket: Socket | null = null;

/**
 * Connects to the backend's `/game` Socket.IO namespace (see
 * backend/src/modules/game/game.gateway.ts). Lazily created and reused
 * across the app — call `getGameSocket()` wherever a live session needs it.
 */
export function getGameSocket(): Socket {
  if (!socket) {
    socket = io(`${API_URL}/game`, {
      autoConnect: true,
      transports: ['websocket'],
    });
  }
  return socket;
}

export function disconnectGameSocket(): void {
  socket?.disconnect();
  socket = null;
}
