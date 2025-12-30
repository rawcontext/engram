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
import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
	{ name: "Overview", href: "/", icon: LayoutDashboard },
	{ name: "Services", href: "/services", icon: Server },
	{ name: "Infrastructure", href: "/infrastructure", icon: HardDrive },
	{ name: "Deployments", href: "/deployments", icon: Rocket },
	{ name: "Logs", href: "/logs", icon: ScrollText },
	{ name: "Performance", href: "/performance", icon: Activity },
	{ name: "Alerts", href: "/alerts", icon: Bell },
	{ name: "Tools", href: "/tools", icon: Wrench },
];

export function Sidebar() {
	const pathname = usePathname();

	return (
		<aside className="fixed left-0 top-0 bottom-0 w-[var(--sidebar-width)] bg-sidebar border-r border-sidebar-border z-40 flex flex-col">
			{/* Logo Section */}
			<div className="h-[var(--header-height)] flex items-center px-5 border-b border-sidebar-border">
				<Link href="/" className="flex items-center gap-3 group">
					<div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center shadow-lg">
						<Terminal className="w-4 h-4 text-primary-foreground" />
					</div>
					<div className="flex flex-col">
						<span className="font-semibold text-sm text-sidebar-foreground group-hover:text-primary transition-colors">
							Console
						</span>
						<span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
							Engram
						</span>
					</div>
				</Link>
			</div>

			{/* Navigation */}
			<nav className="flex-1 px-3 py-4 overflow-y-auto">
				<div className="space-y-1">
					{navigation.map((item) => {
						const isActive = pathname === item.href;
						const Icon = item.icon;

						return (
							<Link
								key={item.name}
								href={item.href}
								className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all relative ${
									isActive
										? "bg-sidebar-accent text-sidebar-primary"
										: "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
								}`}
							>
								{isActive && (
									<span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-sidebar-primary rounded-r" />
								)}
								<Icon className="w-4 h-4 flex-shrink-0" />
								<span>{item.name}</span>
							</Link>
						);
					})}
				</div>
			</nav>

			{/* Footer */}
			<div className="p-4 border-t border-sidebar-border">
				<div className="bg-sidebar-accent rounded-lg p-3">
					<div className="flex items-center gap-2 mb-2">
						<span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]" />
						<span className="font-mono text-xs text-sidebar-foreground">System Operational</span>
					</div>
					<div className="font-mono text-[10px] text-muted-foreground">Last sync: Just now</div>
				</div>
			</div>
		</aside>
	);
}
