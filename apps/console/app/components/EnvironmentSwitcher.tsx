"use client";

import { ChevronDown, Globe, Plus, Server, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEnvironment } from "../../lib/environment";

export function EnvironmentSwitcher() {
	const {
		environment,
		environments,
		setEnvironment,
		addCustomEnvironment,
		removeCustomEnvironment,
		isConnected,
	} = useEnvironment();

	const [isOpen, setIsOpen] = useState(false);
	const [showAddForm, setShowAddForm] = useState(false);
	const [newName, setNewName] = useState("");
	const [newUrl, setNewUrl] = useState("");
	const dropdownRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

	// Extract host from API URL
	const displayHost = environment.apiUrl.replace(/^https?:\/\//, "");

	// Close dropdown on outside click
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
				setIsOpen(false);
				setShowAddForm(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Keyboard shortcut Cmd+E
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "e") {
				e.preventDefault();
				setIsOpen((prev) => !prev);
			}
			if (e.key === "Escape" && isOpen) {
				setIsOpen(false);
				setShowAddForm(false);
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isOpen]);

	const handleSelect = useCallback(
		(id: string) => {
			setEnvironment(id);
			setIsOpen(false);
		},
		[setEnvironment],
	);

	const handleAddEnvironment = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			if (!newName.trim() || !newUrl.trim()) return;

			// Normalize URL
			let apiUrl = newUrl.trim();
			if (!apiUrl.startsWith("http")) {
				apiUrl = `https://${apiUrl}`;
			}

			addCustomEnvironment({
				name: newName.trim(),
				apiUrl,
				wsUrl: apiUrl.replace(/^http/, "ws"),
				description: "Custom environment",
			});

			setNewName("");
			setNewUrl("");
			setShowAddForm(false);
		},
		[newName, newUrl, addCustomEnvironment],
	);

	return (
		<div className="relative" ref={dropdownRef}>
			{/* Trigger Button */}
			<button
				type="button"
				ref={triggerRef}
				onClick={() => setIsOpen(!isOpen)}
				className="flex items-center gap-3 px-4 py-2 bg-card border border-border rounded-lg hover:border-primary/30 transition-all group"
				aria-expanded={isOpen}
				aria-haspopup="listbox"
			>
				{/* Status indicator */}
				<div className="relative">
					<Globe className="w-4 h-4 text-primary" />
					<span
						className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-card ${
							isConnected
								? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]"
								: "bg-destructive shadow-[0_0_6px_rgba(239,68,68,0.5)] animate-pulse"
						}`}
					/>
				</div>

				<div className="flex flex-col items-start">
					<span className="font-mono text-xs text-foreground">{environment.name}</span>
					<span className="font-mono text-[10px] text-muted-foreground">{displayHost}</span>
				</div>

				<ChevronDown
					className={`w-4 h-4 text-muted-foreground group-hover:text-secondary-foreground transition-transform duration-200 ${
						isOpen ? "rotate-180" : ""
					}`}
				/>
			</button>

			{/* Dropdown */}
			{isOpen && (
				<div className="absolute top-full left-0 mt-2 w-72 bg-card border border-border rounded-lg overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
					{/* Header */}
					<div className="px-3 py-2 border-b border-primary/10">
						<div className="flex items-center justify-between">
							<span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
								Environments
							</span>
							<span className="font-mono text-[10px] text-muted-foreground">⌘E</span>
						</div>
					</div>

					{/* Environment List */}
					<div className="py-1 max-h-64 overflow-y-auto">
						{environments.map((env) => {
							const isSelected = env.id === environment.id;
							const host = env.apiUrl.replace(/^https?:\/\//, "");

							return (
								<div
									key={env.id}
									className={`group flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-all ${
										isSelected ? "bg-primary/10" : "hover:bg-primary/5"
									}`}
									onClick={() => handleSelect(env.id)}
									onKeyDown={(e) => e.key === "Enter" && handleSelect(env.id)}
									role="option"
									aria-selected={isSelected}
									tabIndex={0}
								>
									{/* Icon */}
									<div
										className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
											isSelected ? "bg-primary/15" : "bg-secondary"
										}`}
									>
										<Server
											className={`w-4 h-4 ${isSelected ? "text-primary" : "text-muted-foreground"}`}
										/>
									</div>

									{/* Info */}
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span
												className={`font-mono text-xs ${
													isSelected ? "text-primary" : "text-foreground"
												}`}
											>
												{env.name}
											</span>
											{env.isCustom && (
												<span className="px-1.5 py-0.5 rounded text-[8px] font-mono uppercase bg-purple-500/15 text-purple-500">
													Custom
												</span>
											)}
										</div>
										<span className="font-mono text-[10px] text-muted-foreground truncate block">
											{host}
										</span>
									</div>

									{/* Selection indicator / Delete button */}
									{isSelected ? (
										<div className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.5)]" />
									) : env.isCustom ? (
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												removeCustomEnvironment(env.id);
											}}
											className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 transition-all"
											aria-label="Remove environment"
										>
											<Trash2 className="w-3 h-3 text-destructive" />
										</button>
									) : null}
								</div>
							);
						})}
					</div>

					{/* Add Custom Environment */}
					<div className="border-t border-primary/10">
						{!showAddForm ? (
							<button
								type="button"
								onClick={() => setShowAddForm(true)}
								className="w-full flex items-center gap-2 px-3 py-2.5 text-muted-foreground hover:text-foreground hover:bg-primary/5 transition-all"
							>
								<Plus className="w-4 h-4" />
								<span className="font-mono text-xs">Add custom environment</span>
							</button>
						) : (
							<form onSubmit={handleAddEnvironment} className="p-3 space-y-3">
								<div className="flex items-center justify-between mb-2">
									<span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
										New Environment
									</span>
									<button
										type="button"
										onClick={() => setShowAddForm(false)}
										className="p-1 rounded hover:bg-primary/10 transition-colors"
									>
										<X className="w-3 h-3 text-muted-foreground" />
									</button>
								</div>

								<input
									type="text"
									value={newName}
									onChange={(e) => setNewName(e.target.value)}
									placeholder="Environment name"
									className="w-full px-3 py-2 bg-secondary border border-primary/10 rounded-md font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/30 transition-colors"
								/>

								<input
									type="text"
									value={newUrl}
									onChange={(e) => setNewUrl(e.target.value)}
									placeholder="API URL (e.g., api.example.com)"
									className="w-full px-3 py-2 bg-secondary border border-primary/10 rounded-md font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/30 transition-colors"
								/>

								<button
									type="submit"
									disabled={!newName.trim() || !newUrl.trim()}
									className="w-full py-2 rounded-md font-mono text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20"
								>
									Add Environment
								</button>
							</form>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
