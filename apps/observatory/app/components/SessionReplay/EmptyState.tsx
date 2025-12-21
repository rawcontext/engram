"use client";

import { memo } from "react";
import { EmptyState as SharedEmptyState } from "../shared";

/**
 * Empty state for SessionReplay - shows when no cognitive events are available.
 * Uses the shared EmptyState component with the "stream" variant.
 */
function EmptyStateInner() {
	return <SharedEmptyState variant="stream" />;
}

export const EmptyState = memo(EmptyStateInner);
