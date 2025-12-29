"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// Dynamically import the dashboard shell with SSR disabled
// This completely avoids hydration mismatches for the complex dashboard UI
const DashboardShell = dynamic(() => import("@/components/layout/dashboard-shell"), {
	ssr: false,
	loading: () => (
		<div className="min-h-screen bg-background flex items-center justify-center">
			<div className="text-muted-foreground">Loading dashboard...</div>
		</div>
	),
});

export default function DashboardLayout({ children }: { children: ReactNode }) {
	return <DashboardShell>{children}</DashboardShell>;
}
