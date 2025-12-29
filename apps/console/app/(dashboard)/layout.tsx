"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// Dynamically import the dashboard shell with SSR disabled
// This completely avoids hydration mismatches for the complex dashboard UI
const DashboardShell = dynamic(() => import("@/components/layout/dashboard-shell"), {
	ssr: false,
	loading: () => (
		<div
			style={{
				minHeight: "100vh",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: "#0a0a0a",
			}}
		>
			<div style={{ color: "#71717a" }}>Loading dashboard...</div>
		</div>
	),
});

export default function DashboardLayout({ children }: { children: ReactNode }) {
	return <DashboardShell>{children}</DashboardShell>;
}
