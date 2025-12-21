"use client";

import { memo } from "react";
import { LoadingState as SharedLoadingState } from "../shared";

/**
 * Loading state for SessionReplay - shows while establishing neural link.
 * Uses the shared LoadingState component with the "neural" variant.
 */
function LoadingStateInner() {
	return (
		<SharedLoadingState
			variant="neural"
			message="SYNCHRONIZING"
			subMessage="Establishing neural link..."
		/>
	);
}

export const LoadingState = memo(LoadingStateInner);
