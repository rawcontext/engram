"use client";

import type { ReactNode } from "react";
import { KeyboardShortcutsProvider } from "@/components/keyboard-shortcuts-provider";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SiteHeader } from "@/components/layout/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { StreamingProvider } from "@/lib/streaming-context";

export default function DashboardShell({ children }: { children: ReactNode }) {
	return (
		<KeyboardShortcutsProvider>
			<StreamingProvider>
				<SidebarProvider>
					<AppSidebar />
					<SidebarInset>
						<SiteHeader />
						<main className="flex-1 p-4 md:p-6">{children}</main>
					</SidebarInset>
				</SidebarProvider>
			</StreamingProvider>
		</KeyboardShortcutsProvider>
	);
}
