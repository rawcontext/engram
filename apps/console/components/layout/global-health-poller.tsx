"use client";

/**
 * Global health poller that lives in the layout and never unmounts.
 * This ensures the connection status in the header stays stable during navigation.
 */

import { useStreamingData } from "@/hooks/useStreamingData";
import { useRegisterStreamingSource } from "@/lib/streaming-context";

interface ServiceHealth {
	ok: boolean;
	services?: Record<string, { status: string; latency?: number }>;
}

async function fetchHealth(): Promise<ServiceHealth> {
	const res = await fetch("/api/health-check");
	if (!res.ok) throw new Error("Health check failed");
	return res.json();
}

export function GlobalHealthPoller() {
	const { status, lastUpdate } = useStreamingData<ServiceHealth>({
		fetchData: fetchHealth,
		pollInterval: 5000,
		staleThreshold: 30,
		degradedThreshold: 15,
	});

	// Register with the streaming context so header always has status
	useRegisterStreamingSource("global-health", "Global Health", status, lastUpdate);

	// This component renders nothing - it just polls and registers
	return null;
}
