"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SiteHeader } from "@/components/layout/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { StreamingProvider } from "@/lib/streaming-context";

export default function DashboardLayout({ children }: { children: ReactNode }) {
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	// Return empty div during SSR - simplest possible hydration safe pattern
	if (!mounted) {
		return <div />;
	}

	return (
		<StreamingProvider>
			<SidebarProvider>
				<AppSidebar />
				<SidebarInset>
					<SiteHeader />
					<main className="flex-1 p-6">{children}</main>
				</SidebarInset>
			</SidebarProvider>
		</StreamingProvider>
	);
}
