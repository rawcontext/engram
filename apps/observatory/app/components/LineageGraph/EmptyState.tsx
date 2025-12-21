"use client";

import { EmptyState as SharedEmptyState } from "../shared";

/**
 * Empty state for LineageGraph - shows when no neural pathways are available.
 * Uses the shared EmptyState component with the "neural" variant.
 */
export function EmptyState() {
	return <SharedEmptyState variant="neural" />;
}
