"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../lib/theme";

export function ThemeToggle() {
	const { resolvedTheme, toggle } = useTheme();
	const isDark = resolvedTheme === "dark";

	return (
		<button
			onClick={toggle}
			className="relative w-9 h-9 rounded-lg flex items-center justify-center text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-primary))] hover:bg-[rgba(var(--console-cyan),0.05)] transition-all group overflow-hidden"
			aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
		>
			{/* Rotating container for the icons */}
			<div
				className="relative w-4 h-4 transition-transform duration-500 ease-out"
				style={{
					transform: isDark ? "rotate(0deg)" : "rotate(180deg)",
				}}
			>
				{/* Moon - visible in dark mode */}
				<Moon
					className="absolute inset-0 w-4 h-4 transition-all duration-300"
					style={{
						opacity: isDark ? 1 : 0,
						transform: isDark ? "scale(1)" : "scale(0.5)",
					}}
				/>
				{/* Sun - visible in light mode */}
				<Sun
					className="absolute inset-0 w-4 h-4 transition-all duration-300"
					style={{
						opacity: isDark ? 0 : 1,
						transform: isDark ? "scale(0.5) rotate(180deg)" : "scale(1) rotate(180deg)",
					}}
				/>
			</div>

			{/* Subtle glow on hover */}
			<div
				className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
				style={{
					background: isDark
						? "radial-gradient(circle at center, rgba(var(--console-purple), 0.1) 0%, transparent 70%)"
						: "radial-gradient(circle at center, rgba(var(--console-amber), 0.15) 0%, transparent 70%)",
				}}
			/>
		</button>
	);
}
