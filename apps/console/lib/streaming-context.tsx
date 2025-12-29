"use client";

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import type { StreamingStatus } from "@/hooks/useStreamingData";

interface StreamingSource {
	id: string;
	name: string;
	status: StreamingStatus;
	lastUpdate: Date | null;
}

interface StreamingContextValue {
	/** All registered streaming sources */
	sources: Map<string, StreamingSource>;
	/** Aggregate status (worst status across all sources) */
	aggregateStatus: StreamingStatus;
	/** Whether any source is receiving live data */
	isAnyLive: boolean;
	/** Whether all sources are live */
	isAllLive: boolean;
	/** Register a streaming source */
	registerSource: (
		id: string,
		name: string,
		status: StreamingStatus,
		lastUpdate: Date | null,
	) => void;
	/** Unregister a streaming source */
	unregisterSource: (id: string) => void;
	/** Get the most recent update across all sources */
	lastGlobalUpdate: Date | null;
}

const StreamingContext = createContext<StreamingContextValue | null>(null);

function getAggregateStatus(sources: Map<string, StreamingSource>): StreamingStatus {
	if (sources.size === 0) return "connecting";

	const statuses = Array.from(sources.values()).map((s) => s.status);

	// Priority: offline > stale > degraded > connecting > live
	if (statuses.includes("offline")) return "offline";
	if (statuses.includes("stale")) return "stale";
	if (statuses.includes("degraded")) return "degraded";
	if (statuses.includes("connecting")) return "connecting";
	return "live";
}

export function StreamingProvider({ children }: { children: ReactNode }) {
	const [sources, setSources] = useState<Map<string, StreamingSource>>(new Map());

	const registerSource = useCallback(
		(id: string, name: string, status: StreamingStatus, lastUpdate: Date | null) => {
			setSources((prev) => {
				const next = new Map(prev);
				next.set(id, { id, name, status, lastUpdate });
				return next;
			});
		},
		[],
	);

	const unregisterSource = useCallback((id: string) => {
		setSources((prev) => {
			const next = new Map(prev);
			next.delete(id);
			return next;
		});
	}, []);

	const aggregateStatus = getAggregateStatus(sources);
	const isAnyLive = Array.from(sources.values()).some((s) => s.status === "live");
	const isAllLive =
		sources.size > 0 && Array.from(sources.values()).every((s) => s.status === "live");

	const lastGlobalUpdate = Array.from(sources.values()).reduce<Date | null>((latest, source) => {
		if (!source.lastUpdate) return latest;
		if (!latest) return source.lastUpdate;
		return source.lastUpdate > latest ? source.lastUpdate : latest;
	}, null);

	return (
		<StreamingContext.Provider
			value={{
				sources,
				aggregateStatus,
				isAnyLive,
				isAllLive,
				registerSource,
				unregisterSource,
				lastGlobalUpdate,
			}}
		>
			{children}
		</StreamingContext.Provider>
	);
}

const DEFAULT_CONTEXT: StreamingContextValue = {
	sources: new Map(),
	aggregateStatus: "connecting",
	isAnyLive: false,
	isAllLive: false,
	registerSource: () => {},
	unregisterSource: () => {},
	lastGlobalUpdate: null,
};

export function useStreamingContext(): StreamingContextValue {
	const context = useContext(StreamingContext);
	// Return default context if provider not present (graceful degradation)
	return context ?? DEFAULT_CONTEXT;
}

/**
 * Hook for components to register themselves as streaming sources.
 * Automatically unregisters when the component unmounts.
 *
 * Uses refs to store the latest values and syncs to context on mount and
 * via a debounced interval to prevent infinite update loops.
 */
export function useRegisterStreamingSource(
	id: string,
	name: string,
	status: StreamingStatus,
	lastUpdate: Date | null,
) {
	const context = useContext(StreamingContext);

	// Store latest values in refs to avoid effect dependencies
	const latestRef = useRef({ id, name, status, lastUpdate });
	const registeredRef = useRef<string | null>(null);
	const contextRef = useRef(context);

	// Update refs synchronously (no effect needed)
	latestRef.current = { id, name, status, lastUpdate };
	contextRef.current = context;

	// Register on mount, update periodically, unregister on unmount
	useEffect(() => {
		const ctx = contextRef.current;
		if (!ctx) return;

		const sync = () => {
			const {
				id: currentId,
				name: currentName,
				status: currentStatus,
				lastUpdate: currentLastUpdate,
			} = latestRef.current;
			ctx.registerSource(currentId, currentName, currentStatus, currentLastUpdate);
			registeredRef.current = currentId;
		};

		// Initial registration
		sync();

		// Periodic sync every 2 seconds to catch status changes without causing loops
		const interval = setInterval(sync, 2000);

		return () => {
			clearInterval(interval);
			if (registeredRef.current && contextRef.current) {
				contextRef.current.unregisterSource(registeredRef.current);
			}
		};
	}, []);
}
