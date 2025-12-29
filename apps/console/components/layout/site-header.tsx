"use client";

import { Bell, Settings } from "lucide-react";
import { usePathname } from "next/navigation";

import { EnvironmentSwitcher } from "@/app/components/EnvironmentSwitcher";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { SignalStrength, StreamingIndicator } from "@/components/streaming";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useEnvironment } from "@/lib/environment";
import { useStreamingContext } from "@/lib/streaming-context";

const pageNames: Record<string, string> = {
	"/": "Overview",
	"/services": "Services",
	"/infrastructure": "Infrastructure",
	"/deployments": "Deployments",
	"/logs": "Logs",
	"/performance": "Performance",
	"/alerts": "Alerts",
	"/tools": "Tools",
};

export function SiteHeader() {
	const pathname = usePathname();
	const { isConnected } = useEnvironment();
	const streamingContext = useStreamingContext();

	// Get current page name from pathname
	const currentPage = pageNames[pathname] || pathname.split("/").pop() || "Dashboard";

	// Determine streaming status from context or fall back to environment connection
	const streamingStatus = streamingContext.aggregateStatus ?? (isConnected ? "live" : "offline");
	const lastUpdate = streamingContext.lastGlobalUpdate ?? null;

	return (
		<header className="flex h-16 shrink-0 items-center gap-2 border-b border-border/40 bg-background/80 backdrop-blur-xl transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
			<div className="flex w-full items-center gap-2 px-4">
				<SidebarTrigger className="-ml-1" />
				<Separator orientation="vertical" className="mr-2 h-4" />
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem className="hidden md:block">
							<BreadcrumbLink href="/">Console</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator className="hidden md:block" />
						<BreadcrumbItem>
							<BreadcrumbPage>{currentPage}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>

				{/* Right side actions */}
				<div className="ml-auto flex items-center gap-2">
					<EnvironmentSwitcher />

					{/* Streaming status indicator */}
					<div className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted/50">
						<SignalStrength status={streamingStatus} />
						<StreamingIndicator
							status={streamingStatus}
							lastUpdate={lastUpdate}
							showTimestamp={false}
							showLabel={true}
							size="sm"
						/>
					</div>

					<Separator orientation="vertical" className="mx-2 h-4" />

					{/* Notifications */}
					<Button variant="ghost" size="icon" className="relative">
						<Bell className="h-4 w-4" />
						<span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-warning" />
						<span className="sr-only">Notifications</span>
					</Button>

					{/* Theme Toggle */}
					<ThemeToggle />

					{/* Settings */}
					<Button variant="ghost" size="icon">
						<Settings className="h-4 w-4" />
						<span className="sr-only">Settings</span>
					</Button>
				</div>
			</div>
		</header>
	);
}
