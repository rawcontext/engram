"use client";

import { Badge } from "@tremor/react";
import { Bell, LogOut, Settings, User } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { signOut, useSession } from "../../lib/auth-client";
import { useEnvironment } from "../../lib/environment";
import { EnvironmentSwitcher } from "./EnvironmentSwitcher";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
	const { isConnected } = useEnvironment();
	const { data: session } = useSession();
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	const handleSignOut = async () => {
		await signOut({ fetchOptions: { onSuccess: () => window.location.assign("/login") } });
	};

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				setMenuOpen(false);
			}
		};

		if (menuOpen) {
			document.addEventListener("mousedown", handleClickOutside);
		}
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [menuOpen]);

	return (
		<header className="fixed top-0 left-[var(--sidebar-width)] right-0 h-[var(--header-height)] bg-[rgba(var(--console-panel),0.8)] backdrop-blur-xl border-b border-[rgba(var(--console-cyan),0.1)] z-30 flex items-center justify-between px-6">
			{/* Left: Environment Switcher */}
			<div className="flex items-center gap-4">
				<EnvironmentSwitcher />

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
				<button
					type="button"
					className="w-9 h-9 rounded-lg flex items-center justify-center text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-primary))] hover:bg-[rgba(var(--console-cyan),0.05)] transition-all relative"
				>
					<Bell className="w-4 h-4" />
					<span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[rgb(var(--console-amber))]" />
				</button>

				{/* Theme Toggle */}
				<ThemeToggle />

				{/* Settings */}
				<button
					type="button"
					className="w-9 h-9 rounded-lg flex items-center justify-center text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-primary))] hover:bg-[rgba(var(--console-cyan),0.05)] transition-all"
				>
					<Settings className="w-4 h-4" />
				</button>

				{/* User Menu */}
				<div
					className="relative pl-4 ml-2 border-l border-[rgba(var(--console-cyan),0.1)]"
					ref={menuRef}
				>
					<button
						type="button"
						onClick={() => setMenuOpen(!menuOpen)}
						className="flex items-center gap-3"
					>
						{session?.user?.image ? (
							<Image
								src={session.user.image}
								alt={session.user.name || "User"}
								width={32}
								height={32}
								className="rounded-full"
								unoptimized
							/>
						) : (
							<div className="w-8 h-8 rounded-full bg-gradient-to-br from-[rgb(var(--console-blue))] to-[rgb(var(--console-purple))] flex items-center justify-center">
								{session?.user?.name ? (
									<span className="text-xs font-medium text-white">
										{session.user.name.charAt(0).toUpperCase()}
									</span>
								) : (
									<User className="w-4 h-4 text-white" />
								)}
							</div>
						)}
					</button>

					{menuOpen && (
						<div className="absolute right-0 top-full mt-2 w-64 rounded-lg bg-[rgb(var(--console-panel))] border border-[rgba(var(--console-cyan),0.2)] shadow-xl overflow-hidden">
							{session?.user && (
								<div className="px-4 py-3 border-b border-[rgba(var(--console-cyan),0.1)]">
									<p className="text-sm font-medium text-[rgb(var(--text-primary))] truncate">
										{session.user.name}
									</p>
									<p className="text-xs text-[rgb(var(--text-muted))] truncate">
										{session.user.email}
									</p>
								</div>
							)}
							<button
								type="button"
								onClick={handleSignOut}
								className="w-full px-4 py-3 flex items-center gap-3 text-sm text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--console-red))] hover:bg-[rgba(var(--console-red),0.05)] transition-all"
							>
								<LogOut className="w-4 h-4" />
								Sign Out
							</button>
						</div>
					)}
				</div>
			</div>
		</header>
	);
}
