"use client";

import { useEffect, useState, type ReactNode } from "react";

interface ClientOnlyProps {
	children: ReactNode;
	fallback?: ReactNode;
}

/**
 * Wrapper component that only renders children on the client after hydration.
 * This prevents hydration mismatches for components that depend on client-side state.
 */
export function ClientOnly({ children, fallback = null }: ClientOnlyProps) {
	const [hasMounted, setHasMounted] = useState(false);

	useEffect(() => {
		setHasMounted(true);
	}, []);

	if (!hasMounted) {
		return <>{fallback}</>;
	}

	return <>{children}</>;
}
