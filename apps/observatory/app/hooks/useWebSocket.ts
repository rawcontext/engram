/**
 * Re-export WebSocket hook from @engram/websocket package
 *
 * This hook is now maintained in the shared websocket package for reuse
 * across Observatory, Console, and other apps.
 */

export type {
	HeartbeatOptions,
	UseWebSocketOptions,
	UseWebSocketReturn,
	WebSocketStatus,
} from "@engram/websocket/client";
export { useWebSocket } from "@engram/websocket/client";
