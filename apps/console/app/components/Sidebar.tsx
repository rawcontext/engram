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
		<aside className="fixed left-0 top-0 bottom-0 w-[var(--sidebar-width)] bg-[rgb(var(--console-panel))] border-r border-[rgba(var(--console-cyan),0.1)] z-40 flex flex-col">
			{/* Logo Section */}
			<div className="h-[var(--header-height)] flex items-center px-5 border-b border-[rgba(var(--console-cyan),0.1)]">
				<Link href="/" className="flex items-center gap-3 group">
					<div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[rgb(var(--console-cyan))] to-[rgb(var(--console-purple))] flex items-center justify-center shadow-lg shadow-[rgba(var(--console-cyan),0.2)]">
						<Terminal className="w-4 h-4 text-[rgb(var(--console-void))]" />
					</div>
					<div className="flex flex-col">
						<span className="font-display text-sm text-[rgb(var(--text-primary))] group-hover:text-gradient transition-colors">
							Console
						</span>
						<span className="font-mono text-[10px] text-[rgb(var(--text-muted))] uppercase tracking-wider">
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
								className={`nav-item ${isActive ? "active" : ""}`}
							>
								<Icon className="w-4 h-4 flex-shrink-0" />
								<span>{item.name}</span>
							</Link>
						);
					})}
				</div>
			</nav>

			{/* Footer */}
			<div className="p-4 border-t border-[rgba(var(--console-cyan),0.1)]">
				<div className="panel p-3">
					<div className="flex items-center gap-2 mb-2">
						<div className="status-dot status-online" />
						<span className="font-mono text-xs text-[rgb(var(--text-secondary))]">
							System Operational
						</span>
					</div>
					<div className="font-mono text-[10px] text-[rgb(var(--text-muted))]">
						Last sync: Just now
					</div>
				</div>
			</div>
		</aside>
	);
}
