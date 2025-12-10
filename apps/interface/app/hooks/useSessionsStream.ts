"use client";

import { useCallback, useState } from "react";
import { useWebSocket, type WebSocketStatus } from "./useWebSocket";

interface Session {
	id: string;
	title: string | null;
	userId: string;
	startedAt: number;
	lastEventAt: number | null;
	eventCount: number;
	preview: string | null;
	isActive: boolean;
}

interface SessionsStreamState {
	active: Session[];
	recent: Session[];
	error: string | null;
}

interface UseSessionsStreamOptions {
	onSessionsUpdate?: (data: { active: Session[]; recent: Session[] }) => void;
}

interface SessionsMessage {
	type: "sessions" | "session_created" | "session_updated" | "session_closed" | "error";
	data?: Session | { active: Session[]; recent: Session[] };
	message?: string;
}

/**
 * Deduplicates a list of sessions by ID
 */
function dedupeList(list: Session[]): Session[] {
	const seen = new Set<string>();
	return (list || []).filter((s) => {
		if (!s?.id || seen.has(s.id)) return false;
		seen.add(s.id);
		return true;
	});
}

/**
 * Custom hook for real-time session list streaming via WebSocket.
 * Uses the shared useWebSocket hook for connection management.
 */
export function useSessionsStream({ onSessionsUpdate }: UseSessionsStreamOptions = {}) {
	const [state, setState] = useState<SessionsStreamState>({
		active: [],
		recent: [],
		error: null,
	});

	const handleMessage = useCallback(
		(message: SessionsMessage) => {
			switch (message.type) {
				case "sessions": {
					// Full session list update - deduplicate by ID
					const data = message.data as { active: Session[]; recent: Session[] };
					const dedupedActive = dedupeList(data.active);
					const dedupedRecent = dedupeList(data.recent);
					setState((prev) => ({
						...prev,
						active: dedupedActive,
						recent: dedupedRecent,
						error: null,
					}));
					onSessionsUpdate?.({ active: dedupedActive, recent: dedupedRecent });
					break;
				}

				case "session_created": {
					// New session created - add to active list
					setState((prev) => {
						const newSession = message.data as Session;
						// Avoid duplicates
						const existsInActive = prev.active.some((s) => s.id === newSession.id);
						const existsInRecent = prev.recent.some((s) => s.id === newSession.id);

						if (existsInActive || existsInRecent) return prev;

						const updated = {
							...prev,
							active: [newSession, ...prev.active],
						};
						onSessionsUpdate?.({ active: updated.active, recent: updated.recent });
						return updated;
					});
					break;
				}

				case "session_updated": {
					// Session updated - update in place
					setState((prev) => {
						const updatedSession = message.data as Session;
						const updateInList = (list: Session[]) =>
							list.map((s) => (s.id === updatedSession.id ? updatedSession : s));

						const updated = {
							...prev,
							active: updateInList(prev.active),
							recent: updateInList(prev.recent),
						};
						onSessionsUpdate?.({ active: updated.active, recent: updated.recent });
						return updated;
					});
					break;
				}

				case "session_closed": {
					// Session closed - move from active to recent
					setState((prev) => {
						const closedSession = message.data as Session;
						const updated = {
							...prev,
							active: prev.active.filter((s) => s.id !== closedSession.id),
							recent: [{ ...closedSession, isActive: false }, ...prev.recent],
						};
						onSessionsUpdate?.({ active: updated.active, recent: updated.recent });
						return updated;
					});
					break;
				}

				case "error":
					setState((prev) => ({ ...prev, error: message.message || "Unknown error" }));
					break;

				default:
					console.log("[SessionsStream] Unknown message type:", message.type);
			}
		},
		[onSessionsUpdate],
	);

	const handleOpen = useCallback((ws: WebSocket) => {
		console.log("[SessionsStream] WebSocket connected");
		setState((prev) => ({ ...prev, error: null }));
		// Request initial session list
		ws.send(JSON.stringify({ type: "subscribe" }));
	}, []);

	const handleClose = useCallback(() => {
		console.log("[SessionsStream] WebSocket closed");
	}, []);

	const handleError = useCallback(() => {
		console.error("[SessionsStream] WebSocket connection error");
	}, []);

	const { status, isConnected, send, close, reconnect, reconnectAttempt } =
		useWebSocket<SessionsMessage>({
			url: "/api/ws/sessions",
			onMessage: handleMessage,
			onOpen: handleOpen,
			onClose: handleClose,
			onError: handleError,
			reconnect: true,
			maxReconnectAttempts: 10,
		});

	// Update error state when max reconnect attempts reached
	const error =
		!isConnected && reconnectAttempt >= 10
			? "Connection lost. Please refresh the page."
			: state.error;

	// Manual refresh function
	const refresh = useCallback(() => {
		send({ type: "refresh" });
	}, [send]);

	return {
		active: state.active,
		recent: state.recent,
		isConnected,
		status,
		error,
		refresh,
		disconnect: close,
		reconnect,
	};
}

// Re-export WebSocketStatus for consumers
export type { WebSocketStatus };
