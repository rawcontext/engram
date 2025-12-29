"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SiteHeader } from "@/components/layout/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { StreamingProvider } from "@/lib/streaming-context";

function DashboardSkeleton() {
	return (
		<div className="min-h-screen bg-background flex">
			{/* Sidebar skeleton */}
			<div className="hidden md:block w-64 border-r bg-sidebar" />
			{/* Main content skeleton */}
			<div className="flex-1 flex flex-col">
				<div className="h-14 border-b bg-background" />
				<div className="flex-1 p-6">
					<div className="animate-pulse space-y-4">
						<div className="h-8 bg-muted rounded w-48" />
						<div className="h-4 bg-muted rounded w-64" />
						<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
							<div className="h-32 bg-muted rounded" />
							<div className="h-32 bg-muted rounded" />
							<div className="h-32 bg-muted rounded" />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
	const [isHydrated, setIsHydrated] = useState(false);

	useEffect(() => {
		setIsHydrated(true);
	}, []);

	// Show skeleton during SSR and initial hydration to prevent mismatch
	if (!isHydrated) {
		return <DashboardSkeleton />;
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
