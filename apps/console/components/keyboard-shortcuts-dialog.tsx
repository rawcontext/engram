"use client";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

interface ShortcutDefinition {
	key: string;
	label: string;
	description: string;
}

interface KeyboardShortcutsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	shortcuts: ShortcutDefinition[];
}

/**
 * Dialog showing all available keyboard shortcuts.
 */
export function KeyboardShortcutsDialog({
	open,
	onOpenChange,
	shortcuts,
}: KeyboardShortcutsDialogProps) {
	// Group shortcuts by category
	const navigationShortcuts = shortcuts.filter((s) => s.key.startsWith("g "));
	const actionShortcuts = shortcuts.filter((s) => !s.key.startsWith("g "));

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<kbd className="px-2 py-1 text-xs font-mono bg-muted rounded">?</kbd>
						Keyboard Shortcuts
					</DialogTitle>
					<DialogDescription>
						Vim-style navigation for power users. Press any shortcut to navigate.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 mt-4">
					{/* Navigation shortcuts */}
					<div>
						<h3 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">
							Navigation
						</h3>
						<div className="space-y-2">
							{navigationShortcuts.map((shortcut) => (
								<div key={shortcut.key} className="flex items-center justify-between py-1">
									<div className="flex items-center gap-3">
										<kbd className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono bg-muted rounded min-w-[3rem] justify-center">
											{shortcut.key.split(" ").map((k, i) => (
												<span key={`${shortcut.key}-${k}`}>
													{i > 0 && <span className="text-muted-foreground mx-0.5">+</span>}
													{k}
												</span>
											))}
										</kbd>
										<span className="text-sm font-medium">{shortcut.label}</span>
									</div>
									<span className="text-xs text-muted-foreground">{shortcut.description}</span>
								</div>
							))}
						</div>
					</div>

					{/* Action shortcuts */}
					<div>
						<h3 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">
							Actions
						</h3>
						<div className="space-y-2">
							{actionShortcuts.map((shortcut) => (
								<div key={shortcut.key} className="flex items-center justify-between py-1">
									<div className="flex items-center gap-3">
										<kbd className="inline-flex items-center gap-1 px-2 py-1 text-xs font-mono bg-muted rounded min-w-[3rem] justify-center">
											{shortcut.key}
										</kbd>
										<span className="text-sm font-medium">{shortcut.label}</span>
									</div>
									<span className="text-xs text-muted-foreground">{shortcut.description}</span>
								</div>
							))}
						</div>
					</div>
				</div>

				<div className="mt-6 pt-4 border-t">
					<p className="text-xs text-muted-foreground text-center">
						Press <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded">Esc</kbd> to
						close
					</p>
				</div>
			</DialogContent>
		</Dialog>
	);
}
