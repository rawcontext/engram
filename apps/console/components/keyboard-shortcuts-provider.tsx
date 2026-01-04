"use client";

import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import {
	type UseKeyboardShortcutsReturn,
	useKeyboardShortcuts,
} from "@/hooks/useKeyboardShortcuts";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";

interface KeyboardShortcutsContextValue extends UseKeyboardShortcutsReturn {
	showHelp: () => void;
}

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextValue | null>(null);

interface KeyboardShortcutsProviderProps {
	children: ReactNode;
}

/**
 * Provider for global keyboard shortcuts.
 * Wraps the dashboard shell to enable vim-style navigation.
 */
export function KeyboardShortcutsProvider({ children }: KeyboardShortcutsProviderProps) {
	const [helpOpen, setHelpOpen] = useState(false);

	const showHelp = useCallback(() => {
		setHelpOpen(true);
	}, []);

	const keyboardShortcuts = useKeyboardShortcuts({
		onShowHelp: showHelp,
	});

	const contextValue: KeyboardShortcutsContextValue = {
		...keyboardShortcuts,
		showHelp,
	};

	return (
		<KeyboardShortcutsContext.Provider value={contextValue}>
			{children}

			{/* Go mode indicator */}
			{keyboardShortcuts.isGoMode && <GoModeIndicator />}

			{/* Help dialog */}
			<KeyboardShortcutsDialog
				open={helpOpen}
				onOpenChange={setHelpOpen}
				shortcuts={keyboardShortcuts.shortcuts}
			/>
		</KeyboardShortcutsContext.Provider>
	);
}

/**
 * Hook to access keyboard shortcuts context.
 */
export function useKeyboardShortcutsContext(): KeyboardShortcutsContextValue {
	const context = useContext(KeyboardShortcutsContext);
	if (!context) {
		throw new Error("useKeyboardShortcutsContext must be used within KeyboardShortcutsProvider");
	}
	return context;
}

/**
 * Floating indicator shown when in "go" mode.
 */
function GoModeIndicator() {
	return (
		<div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
			<div className="flex items-center gap-2 px-4 py-2 bg-card border border-primary/30 rounded-lg shadow-lg shadow-primary/10">
				<kbd className="px-2 py-1 text-xs font-mono bg-primary/10 text-primary rounded">g</kbd>
				<span className="text-sm text-muted-foreground">Press a key to navigate...</span>
			</div>
		</div>
	);
}
