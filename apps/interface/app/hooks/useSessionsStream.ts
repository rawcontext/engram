"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
	isConnected: boolean;
	error: string | null;
}

interface UseSessionsStreamOptions {
	onSessionsUpdate?: (data: { active: Session[]; recent: Session[] }) => void;
}

/**
 * Custom hook for real-time session list streaming via WebSocket
 * NO POLLING - pure WebSocket streaming
 */
export function useSessionsStream({ onSessionsUpdate }: UseSessionsStreamOptions = {}) {
	const [state, setState] = useState<SessionsStreamState>({
		active: [],
		recent: [],
		isConnected: false,
		error: null,
	});

	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const reconnectAttempts = useRef(0);
	const maxReconnectAttempts = 10;

	// Connect to WebSocket
	const connectWebSocket = useCallback(() => {
		if (wsRef.current?.readyState === WebSocket.OPEN) return;

		// Determine WebSocket URL
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${window.location.host}/api/ws/sessions`;

		try {
			const ws = new WebSocket(wsUrl);
			wsRef.current = ws;

			ws.onopen = () => {
				console.log("[SessionsStream] WebSocket connected");
				setState((prev) => ({ ...prev, isConnected: true, error: null }));
				reconnectAttempts.current = 0;

				// Request initial session list
				ws.send(JSON.stringify({ type: "subscribe" }));
			};

			ws.onmessage = (event) => {
				try {
					const message = JSON.parse(event.data);

					switch (message.type) {
						case "sessions": {
							// Full session list update - deduplicate by ID
							const dedupeList = (list: Session[]): Session[] => {
								const seen = new Set<string>();
								return (list || []).filter((s) => {
									if (!s?.id || seen.has(s.id)) return false;
									seen.add(s.id);
									return true;
								});
							};
							const dedupedActive = dedupeList(message.data.active);
							const dedupedRecent = dedupeList(message.data.recent);
							setState((prev) => ({
								...prev,
								active: dedupedActive,
								recent: dedupedRecent,
							}));
							onSessionsUpdate?.({ active: dedupedActive, recent: dedupedRecent });
							break;
						}

						case "session_created":
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

						case "session_updated":
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

						case "session_closed":
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

						case "error":
							setState((prev) => ({ ...prev, error: message.message }));
							break;

						default:
							console.log("[SessionsStream] Unknown message type:", message.type);
					}
				} catch (err) {
					console.error("[SessionsStream] Failed to parse message:", err);
				}
			};

			ws.onclose = (event) => {
				console.log("[SessionsStream] WebSocket closed:", event.code, event.reason);
				setState((prev) => ({ ...prev, isConnected: false }));
				wsRef.current = null;

				// Attempt reconnection with exponential backoff
				if (reconnectAttempts.current < maxReconnectAttempts) {
					const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30000);
					reconnectAttempts.current++;

					console.log(
						`[SessionsStream] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`,
					);
					reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
				} else {
					console.error("[SessionsStream] Max reconnect attempts reached");
					setState((prev) => ({ ...prev, error: "Connection lost. Please refresh the page." }));
				}
			};

			ws.onerror = () => {
				console.error("[SessionsStream] WebSocket connection error");
			};
		} catch (err) {
			console.error("[SessionsStream] Failed to create WebSocket:", err);
			setState((prev) => ({ ...prev, error: "Failed to connect to server" }));
		}
	}, [onSessionsUpdate]);

	// Disconnect WebSocket
	const disconnect = useCallback(() => {
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
			reconnectTimeoutRef.current = null;
		}

		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}
	}, []);

	// Effect to manage connection lifecycle
	useEffect(() => {
		connectWebSocket();

		return () => {
			disconnect();
		};
	}, [connectWebSocket, disconnect]);

	// Manual refresh function
	const refresh = useCallback(() => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: "refresh" }));
		}
	}, []);

	return {
		...state,
		refresh,
		disconnect,
	};
}
