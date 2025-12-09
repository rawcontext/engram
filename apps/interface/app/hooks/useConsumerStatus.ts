import { useCallback, useEffect, useState } from "react";
import type { ConsumerStatusResponse } from "../api/consumers/route";

export interface UseConsumerStatusOptions {
	/** Polling interval in ms (default: 5000) */
	pollInterval?: number;
	/** Whether to enable polling (default: true) */
	enabled?: boolean;
}

export interface UseConsumerStatusResult {
	/** Response from the consumer status API */
	data: ConsumerStatusResponse | null;
	/** Whether we're currently loading */
	isLoading: boolean;
	/** Error message if the request failed */
	error: string | null;
	/** Force a refresh of the status */
	refresh: () => Promise<void>;
}

/**
 * Hook to poll Kafka consumer group status.
 *
 * @example
 * ```tsx
 * const { data, isLoading, error } = useConsumerStatus({
 *   pollInterval: 5000,
 * });
 *
 * if (data?.allReady) {
 *   return <StatusIndicator status="online" label="All Consumers Ready" />;
 * }
 * ```
 */
export function useConsumerStatus(
	options: UseConsumerStatusOptions = {},
): UseConsumerStatusResult {
	const { pollInterval = 5000, enabled = true } = options;

	const [data, setData] = useState<ConsumerStatusResponse | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchStatus = useCallback(async () => {
		if (!enabled) return;

		try {
			setIsLoading(true);
			setError(null);

			const response = await fetch("/api/consumers");

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const result: ConsumerStatusResponse = await response.json();
			setData(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(message);
		} finally {
			setIsLoading(false);
		}
	}, [enabled]);

	// Initial fetch
	useEffect(() => {
		if (enabled) {
			fetchStatus();
		}
	}, [enabled, fetchStatus]);

	// Polling
	useEffect(() => {
		if (!enabled || pollInterval <= 0) return;

		const intervalId = setInterval(fetchStatus, pollInterval);

		return () => {
			clearInterval(intervalId);
		};
	}, [enabled, pollInterval, fetchStatus]);

	return {
		data,
		isLoading,
		error,
		refresh: fetchStatus,
	};
}
