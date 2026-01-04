"use client";

import {
	Activity,
	Bell,
	HardDrive,
	LayoutDashboard,
	Menu,
	Rocket,
	ScrollText,
	Server,
	Terminal,
	Wrench,
	X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

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
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

	return (
		<>
			{/* Mobile Menu Button - Fixed at top-left */}
			<button
				type="button"
				onClick={() => setMobileMenuOpen(true)}
				className="fixed top-4 left-4 z-50 lg:hidden w-11 h-11 flex items-center justify-center bg-sidebar border border-sidebar-border rounded-lg shadow-lg active:scale-95 transition-transform"
				aria-label="Open menu"
			>
				<Menu className="w-5 h-5 text-sidebar-foreground" />
			</button>

			{/* Mobile Overlay */}
			{mobileMenuOpen && (
				<div
					className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden transition-opacity"
					onClick={() => setMobileMenuOpen(false)}
				/>
			)}

			{/* Sidebar - Drawer on mobile, fixed on desktop */}
			<aside
				className={`fixed top-0 bottom-0 w-[280px] bg-sidebar border-r border-sidebar-border z-50 flex flex-col transition-transform duration-300 ease-in-out lg:translate-x-0 ${
					mobileMenuOpen ? "translate-x-0 left-0" : "-translate-x-full left-0 lg:left-0"
				}`}
			>
				{/* Mobile Close Button */}
				<button
					type="button"
					onClick={() => setMobileMenuOpen(false)}
					className="absolute top-4 right-4 lg:hidden w-8 h-8 flex items-center justify-center rounded-md hover:bg-sidebar-accent transition-colors"
					aria-label="Close menu"
				>
					<X className="w-4 h-4 text-muted-foreground" />
				</button>

				{/* Logo Section */}
				<div className="h-16 flex items-center px-5 border-b border-sidebar-border">
					<Link
						href="/"
						className="flex items-center gap-3 group"
						onClick={() => setMobileMenuOpen(false)}
					>
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

				{/* Navigation - Touch-friendly on mobile */}
				<nav className="flex-1 px-3 py-4 overflow-y-auto">
					<div className="space-y-1">
						{navigation.map((item) => {
							const isActive = pathname === item.href;
							const Icon = item.icon;

							return (
								<Link
									key={item.name}
									href={item.href}
									onClick={() => setMobileMenuOpen(false)}
									className={`flex items-center gap-3 px-3 py-3 lg:py-2.5 rounded-md text-sm font-medium transition-all relative min-h-[44px] active:scale-[0.98] ${
										isActive
											? "bg-sidebar-accent text-sidebar-primary"
											: "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
									}`}
								>
									{isActive && (
										<span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-sidebar-primary rounded-r" />
									)}
									<Icon className="w-5 h-5 lg:w-4 lg:h-4 flex-shrink-0" />
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
		</>
	);
}
