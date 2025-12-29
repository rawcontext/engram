"use client";

import type { ReactNode } from "react";
import { ClientOnly } from "../components/client-only";
import { EnvironmentProvider } from "../lib/environment";
import { ThemeProvider } from "../lib/theme";

// Loading skeleton to show during hydration
function HydrationFallback() {
	return (
		<div className="min-h-screen bg-background flex items-center justify-center">
			<div className="flex flex-col items-center gap-4">
				<div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
				<p className="text-sm text-muted-foreground font-mono">Loading...</p>
			</div>
		</div>
	);
}

export function Providers({ children }: { children: ReactNode }) {
	return (
		<ClientOnly fallback={<HydrationFallback />}>
			<ThemeProvider>
				<EnvironmentProvider>{children}</EnvironmentProvider>
			</ThemeProvider>
		</ClientOnly>
	);
}
