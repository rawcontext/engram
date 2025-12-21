"use client";

import { LoadingState } from "../shared";

/**
 * Loading skeleton for LineageGraph - shows while loading neural pathways.
 * Uses the shared LoadingState component with the "neural" variant.
 */
export function LoadingSkeleton() {
	return (
		<LoadingState
			variant="neural"
			message="MAPPING"
			subMessage="Loading neural pathways..."
			size="md"
		/>
	);
}
