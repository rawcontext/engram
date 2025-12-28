"use client";

import {
	Activity,
	Bell,
	HardDrive,
	LayoutDashboard,
	Rocket,
	ScrollText,
	Server,
	Terminal,
	Wrench,
} from "lucide-react";
import type * as React from "react";

import { NavMain } from "@/components/layout/nav-main";
import { NavUser } from "@/components/layout/nav-user";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
} from "@/components/ui/sidebar";

const navigation = [
	{ title: "Overview", url: "/", icon: LayoutDashboard },
	{ title: "Services", url: "/services", icon: Server },
	{ title: "Infrastructure", url: "/infrastructure", icon: HardDrive },
	{ title: "Deployments", url: "/deployments", icon: Rocket },
	{ title: "Logs", url: "/logs", icon: ScrollText },
	{ title: "Performance", url: "/performance", icon: Activity },
	{ title: "Alerts", url: "/alerts", icon: Bell },
	{ title: "Tools", url: "/tools", icon: Wrench },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" asChild>
							<a href="/" className="group">
								<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-[rgb(var(--console-purple))] shadow-lg shadow-primary/20">
									<Terminal className="size-4 text-primary-foreground" />
								</div>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-semibold">Console</span>
									<span className="truncate text-xs font-mono uppercase tracking-wider text-muted-foreground">
										Engram
									</span>
								</div>
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<NavMain items={navigation} />
			</SidebarContent>
			<SidebarFooter>
				<NavUser />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
