"use client";

import { Badge } from "@tremor/react";
import { Bell, ChevronDown, Globe, Settings, User } from "lucide-react";
import { useEnvironment } from "../../lib/environment";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
	const { environment, isConnected } = useEnvironment();

	// Extract host from API URL for display
	const displayHost = environment.apiUrl.replace(/^https?:\/\//, "");

	return (
		<header className="fixed top-0 left-[var(--sidebar-width)] right-0 h-[var(--header-height)] bg-[rgba(var(--console-panel),0.8)] backdrop-blur-xl border-b border-[rgba(var(--console-cyan),0.1)] z-30 flex items-center justify-between px-6">
			{/* Left: Environment Switcher */}
			<div className="flex items-center gap-4">
				<button className="panel flex items-center gap-3 px-4 py-2 hover:border-[rgba(var(--console-cyan),0.3)] transition-colors group">
					<Globe className="w-4 h-4 text-[rgb(var(--console-cyan))]" />
					<div className="flex flex-col items-start">
						<span className="font-mono text-xs text-[rgb(var(--text-primary))]">
							{environment.name}
						</span>
						<span className="font-mono text-[10px] text-[rgb(var(--text-muted))]">
							{displayHost}
						</span>
					</div>
					<ChevronDown className="w-4 h-4 text-[rgb(var(--text-muted))] group-hover:text-[rgb(var(--text-secondary))] transition-colors" />
				</button>

				<Badge color={isConnected ? "emerald" : "red"} className="font-mono">
					{isConnected ? "Connected" : "Disconnected"}
				</Badge>
			</div>

			{/* Center: Timestamp */}
			<div className="font-mono text-xs text-[rgb(var(--text-muted))]">
				<span className="text-[rgb(var(--text-secondary))]">UTC</span>{" "}
				{new Date().toISOString().replace("T", " ").slice(0, 19)}
			</div>

			{/* Right: Actions */}
			<div className="flex items-center gap-2">
				{/* Notifications */}
				<button className="w-9 h-9 rounded-lg flex items-center justify-center text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-primary))] hover:bg-[rgba(var(--console-cyan),0.05)] transition-all relative">
					<Bell className="w-4 h-4" />
					<span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[rgb(var(--console-amber))]" />
				</button>

				{/* Theme Toggle */}
				<ThemeToggle />

				{/* Settings */}
				<button className="w-9 h-9 rounded-lg flex items-center justify-center text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-primary))] hover:bg-[rgba(var(--console-cyan),0.05)] transition-all">
					<Settings className="w-4 h-4" />
				</button>

				{/* User Menu */}
				<button className="flex items-center gap-3 pl-4 ml-2 border-l border-[rgba(var(--console-cyan),0.1)]">
					<div className="w-8 h-8 rounded-full bg-gradient-to-br from-[rgb(var(--console-blue))] to-[rgb(var(--console-purple))] flex items-center justify-center">
						<User className="w-4 h-4 text-white" />
					</div>
				</button>
			</div>
		</header>
	);
}
