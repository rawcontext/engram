"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keyboard shortcut definitions for Console navigation.
 *
 * Shortcuts:
 * - g+h: Go to Home/Overview
 * - g+s: Go to Services
 * - g+i: Go to Infrastructure
 * - g+d: Go to Deployments
 * - g+l: Go to Logs
 * - g+p: Go to Performance
 * - g+a: Go to Alerts
 * - g+t: Go to Tools
 * - j/k: Navigate up/down in lists
 * - ?: Show keyboard shortcuts help
 * - Escape: Close modals/dialogs
 */

type NavigationRoute =
	| "/"
	| "/services"
	| "/infrastructure"
	| "/deployments"
	| "/logs"
	| "/performance"
	| "/alerts"
	| "/tools";

interface ShortcutDefinition {
	key: string;
	label: string;
	description: string;
	route?: NavigationRoute;
	action?: () => void;
}

// Navigation shortcuts (g+key pattern)
const GO_SHORTCUTS: Record<string, { route: NavigationRoute; label: string }> = {
	h: { route: "/", label: "Home" },
	s: { route: "/services", label: "Services" },
	i: { route: "/infrastructure", label: "Infrastructure" },
	d: { route: "/deployments", label: "Deployments" },
	l: { route: "/logs", label: "Logs" },
	p: { route: "/performance", label: "Performance" },
	a: { route: "/alerts", label: "Alerts" },
	t: { route: "/tools", label: "Tools" },
};

export interface UseKeyboardShortcutsOptions {
	/** Callback when help dialog should open */
	onShowHelp?: () => void;
	/** Callback for j/k navigation (index delta: -1 for up, +1 for down) */
	onNavigate?: (delta: number) => void;
	/** Callback when Enter is pressed on focused item */
	onSelect?: () => void;
	/** Whether shortcuts are enabled (disabled when typing in inputs) */
	enabled?: boolean;
}

export interface UseKeyboardShortcutsReturn {
	/** Whether we're in "go" mode (g was pressed, waiting for next key) */
	isGoMode: boolean;
	/** Current focused index for j/k navigation */
	focusedIndex: number;
	/** Set the focused index */
	setFocusedIndex: (index: number) => void;
	/** Reset focused index */
	resetFocus: () => void;
	/** List of all available shortcuts for help dialog */
	shortcuts: ShortcutDefinition[];
}

/**
 * Hook for vim-style keyboard navigation in Console.
 */
export function useKeyboardShortcuts(
	options: UseKeyboardShortcutsOptions = {},
): UseKeyboardShortcutsReturn {
	const { onShowHelp, onNavigate, onSelect, enabled = true } = options;

	const router = useRouter();
	const [isGoMode, setIsGoMode] = useState(false);
	const [focusedIndex, setFocusedIndex] = useState(-1);
	const goModeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// Clear go mode after timeout
	const clearGoMode = useCallback(() => {
		if (goModeTimeoutRef.current) {
			clearTimeout(goModeTimeoutRef.current);
			goModeTimeoutRef.current = null;
		}
		setIsGoMode(false);
	}, []);

	// Enter go mode
	const enterGoMode = useCallback(() => {
		setIsGoMode(true);
		// Auto-clear after 1.5s if no second key pressed
		goModeTimeoutRef.current = setTimeout(() => {
			setIsGoMode(false);
		}, 1500);
	}, []);

	// Handle navigation to route
	const navigateTo = useCallback(
		(route: NavigationRoute) => {
			router.push(route);
			clearGoMode();
		},
		[router, clearGoMode],
	);

	// Reset focus
	const resetFocus = useCallback(() => {
		setFocusedIndex(-1);
	}, []);

	// Check if event target is an input element
	const isInputElement = useCallback((target: EventTarget | null): boolean => {
		if (!target) return false;
		const tagName = (target as HTMLElement).tagName?.toLowerCase();
		const isContentEditable = (target as HTMLElement).isContentEditable;
		return (
			tagName === "input" || tagName === "textarea" || tagName === "select" || isContentEditable
		);
	}, []);

	// Keyboard event handler
	useEffect(() => {
		if (!enabled) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			// Skip if typing in an input
			if (isInputElement(event.target)) return;

			// Skip if modifier keys are pressed (except for ?)
			if (event.metaKey || event.ctrlKey || event.altKey) return;

			const key = event.key.toLowerCase();

			// Handle go mode (g was pressed)
			if (isGoMode) {
				const shortcut = GO_SHORTCUTS[key];
				if (shortcut) {
					event.preventDefault();
					navigateTo(shortcut.route);
				}
				clearGoMode();
				return;
			}

			// Enter go mode
			if (key === "g") {
				event.preventDefault();
				enterGoMode();
				return;
			}

			// Show help
			if (key === "?") {
				event.preventDefault();
				onShowHelp?.();
				return;
			}

			// j/k navigation
			if (key === "j") {
				event.preventDefault();
				setFocusedIndex((prev) => prev + 1);
				onNavigate?.(1);
				return;
			}

			if (key === "k") {
				event.preventDefault();
				setFocusedIndex((prev) => Math.max(-1, prev - 1));
				onNavigate?.(-1);
				return;
			}

			// Enter to select
			if (key === "enter" && focusedIndex >= 0) {
				event.preventDefault();
				onSelect?.();
				return;
			}

			// Escape to reset
			if (key === "escape") {
				resetFocus();
				clearGoMode();
				return;
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			if (goModeTimeoutRef.current) {
				clearTimeout(goModeTimeoutRef.current);
			}
		};
	}, [
		enabled,
		isGoMode,
		focusedIndex,
		isInputElement,
		enterGoMode,
		clearGoMode,
		navigateTo,
		resetFocus,
		onShowHelp,
		onNavigate,
		onSelect,
	]);

	// Build shortcuts list for help dialog
	const shortcuts: ShortcutDefinition[] = [
		{ key: "g h", label: "Go to Home", description: "Navigate to Overview dashboard", route: "/" },
		{
			key: "g s",
			label: "Go to Services",
			description: "Navigate to Services page",
			route: "/services",
		},
		{
			key: "g i",
			label: "Go to Infrastructure",
			description: "Navigate to Infrastructure page",
			route: "/infrastructure",
		},
		{
			key: "g d",
			label: "Go to Deployments",
			description: "Navigate to Deployments page",
			route: "/deployments",
		},
		{ key: "g l", label: "Go to Logs", description: "Navigate to Logs page", route: "/logs" },
		{
			key: "g p",
			label: "Go to Performance",
			description: "Navigate to Performance page",
			route: "/performance",
		},
		{ key: "g a", label: "Go to Alerts", description: "Navigate to Alerts page", route: "/alerts" },
		{ key: "g t", label: "Go to Tools", description: "Navigate to Tools page", route: "/tools" },
		{ key: "j", label: "Move down", description: "Move focus down in lists" },
		{ key: "k", label: "Move up", description: "Move focus up in lists" },
		{ key: "Enter", label: "Select", description: "Select focused item" },
		{ key: "?", label: "Help", description: "Show keyboard shortcuts" },
		{ key: "Esc", label: "Cancel", description: "Reset focus / close dialogs" },
		{ key: "Cmd+E", label: "Environment", description: "Toggle environment switcher" },
	];

	return {
		isGoMode,
		focusedIndex,
		setFocusedIndex,
		resetFocus,
		shortcuts,
	};
}
