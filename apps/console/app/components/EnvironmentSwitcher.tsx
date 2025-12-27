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
				ref={triggerRef}
				onClick={() => setIsOpen(!isOpen)}
				className="panel flex items-center gap-3 px-4 py-2 hover:border-[rgba(var(--console-cyan),0.3)] transition-all group"
				aria-expanded={isOpen}
				aria-haspopup="listbox"
			>
				{/* Status indicator */}
				<div className="relative">
					<Globe className="w-4 h-4 text-[rgb(var(--console-cyan))]" />
					<span
						className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[rgb(var(--console-panel))] ${
							isConnected
								? "bg-[rgb(var(--console-green))] shadow-[0_0_6px_rgba(var(--console-green),0.5)]"
								: "bg-[rgb(var(--console-red))] shadow-[0_0_6px_rgba(var(--console-red),0.5)]"
						}`}
						style={{
							animation: isConnected ? "none" : "pulse-status 2s ease-in-out infinite",
						}}
					/>
				</div>

				<div className="flex flex-col items-start">
					<span className="font-mono text-xs text-[rgb(var(--text-primary))]">
						{environment.name}
					</span>
					<span className="font-mono text-[10px] text-[rgb(var(--text-muted))]">{displayHost}</span>
				</div>

				<ChevronDown
					className={`w-4 h-4 text-[rgb(var(--text-muted))] group-hover:text-[rgb(var(--text-secondary))] transition-transform duration-200 ${
						isOpen ? "rotate-180" : ""
					}`}
				/>
			</button>

			{/* Dropdown */}
			{isOpen && (
				<div
					className="absolute top-full left-0 mt-2 w-72 panel overflow-hidden z-50"
					style={{
						animation: "dropdown-slide 0.15s ease-out",
					}}
				>
					{/* Header */}
					<div className="px-3 py-2 border-b border-[rgba(var(--console-cyan),0.1)]">
						<div className="flex items-center justify-between">
							<span className="font-mono text-[10px] text-[rgb(var(--text-muted))] uppercase tracking-wider">
								Environments
							</span>
							<span className="font-mono text-[10px] text-[rgb(var(--text-dim))]">⌘E</span>
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
										isSelected
											? "bg-[rgba(var(--console-cyan),0.1)]"
											: "hover:bg-[rgba(var(--console-cyan),0.05)]"
									}`}
									onClick={() => handleSelect(env.id)}
									role="option"
									aria-selected={isSelected}
								>
									{/* Icon */}
									<div
										className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
											isSelected
												? "bg-[rgba(var(--console-cyan),0.15)]"
												: "bg-[rgb(var(--console-surface))]"
										}`}
									>
										<Server
											className={`w-4 h-4 ${
												isSelected
													? "text-[rgb(var(--console-cyan))]"
													: "text-[rgb(var(--text-muted))]"
											}`}
										/>
									</div>

									{/* Info */}
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span
												className={`font-mono text-xs ${
													isSelected
														? "text-[rgb(var(--console-cyan))]"
														: "text-[rgb(var(--text-primary))]"
												}`}
											>
												{env.name}
											</span>
											{env.isCustom && (
												<span className="px-1.5 py-0.5 rounded text-[8px] font-mono uppercase bg-[rgba(var(--console-purple),0.15)] text-[rgb(var(--console-purple))]">
													Custom
												</span>
											)}
										</div>
										<span className="font-mono text-[10px] text-[rgb(var(--text-dim))] truncate block">
											{host}
										</span>
									</div>

									{/* Selection indicator / Delete button */}
									{isSelected ? (
										<div className="w-2 h-2 rounded-full bg-[rgb(var(--console-cyan))] shadow-[0_0_8px_rgba(var(--console-cyan),0.5)]" />
									) : env.isCustom ? (
										<button
											onClick={(e) => {
												e.stopPropagation();
												removeCustomEnvironment(env.id);
											}}
											className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[rgba(var(--console-red),0.1)] transition-all"
											aria-label="Remove environment"
										>
											<Trash2 className="w-3 h-3 text-[rgb(var(--console-red))]" />
										</button>
									) : null}
								</div>
							);
						})}
					</div>

					{/* Add Custom Environment */}
					<div className="border-t border-[rgba(var(--console-cyan),0.1)]">
						{!showAddForm ? (
							<button
								onClick={() => setShowAddForm(true)}
								className="w-full flex items-center gap-2 px-3 py-2.5 text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-primary))] hover:bg-[rgba(var(--console-cyan),0.05)] transition-all"
							>
								<Plus className="w-4 h-4" />
								<span className="font-mono text-xs">Add custom environment</span>
							</button>
						) : (
							<form onSubmit={handleAddEnvironment} className="p-3 space-y-3">
								<div className="flex items-center justify-between mb-2">
									<span className="font-mono text-[10px] text-[rgb(var(--text-muted))] uppercase tracking-wider">
										New Environment
									</span>
									<button
										type="button"
										onClick={() => setShowAddForm(false)}
										className="p-1 rounded hover:bg-[rgba(var(--console-cyan),0.1)] transition-colors"
									>
										<X className="w-3 h-3 text-[rgb(var(--text-muted))]" />
									</button>
								</div>

								<input
									type="text"
									value={newName}
									onChange={(e) => setNewName(e.target.value)}
									placeholder="Environment name"
									className="w-full px-3 py-2 bg-[rgb(var(--console-surface))] border border-[rgba(var(--console-cyan),0.1)] rounded-md font-mono text-xs text-[rgb(var(--text-primary))] placeholder:text-[rgb(var(--text-dim))] focus:outline-none focus:border-[rgba(var(--console-cyan),0.3)] transition-colors"
									autoFocus
								/>

								<input
									type="text"
									value={newUrl}
									onChange={(e) => setNewUrl(e.target.value)}
									placeholder="API URL (e.g., api.example.com)"
									className="w-full px-3 py-2 bg-[rgb(var(--console-surface))] border border-[rgba(var(--console-cyan),0.1)] rounded-md font-mono text-xs text-[rgb(var(--text-primary))] placeholder:text-[rgb(var(--text-dim))] focus:outline-none focus:border-[rgba(var(--console-cyan),0.3)] transition-colors"
								/>

								<button
									type="submit"
									disabled={!newName.trim() || !newUrl.trim()}
									className="w-full py-2 rounded-md font-mono text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-[rgba(var(--console-cyan),0.1)] text-[rgb(var(--console-cyan))] hover:bg-[rgba(var(--console-cyan),0.2)] border border-[rgba(var(--console-cyan),0.2)]"
								>
									Add Environment
								</button>
							</form>
						)}
					</div>
				</div>
			)}

			<style jsx>{`
				@keyframes dropdown-slide {
					from {
						opacity: 0;
						transform: translateY(-8px);
					}
					to {
						opacity: 1;
						transform: translateY(0);
					}
				}

				@keyframes pulse-status {
					0%,
					100% {
						opacity: 1;
					}
					50% {
						opacity: 0.4;
					}
				}
			`}</style>
		</div>
	);
}
