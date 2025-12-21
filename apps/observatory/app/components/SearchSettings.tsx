"use client";

import type { RerankerTier } from "@lib/search-client";
import { useEffect, useRef, useState } from "react";

export interface SearchSettingsState {
	rerank: boolean;
	forceTier?: "auto" | RerankerTier;
	rerankDepth: number;
	latencyBudgetMs?: number;
}

interface SearchSettingsProps {
	settings: SearchSettingsState;
	onChange: (settings: SearchSettingsState) => void;
}

/**
 * Reranker tier configuration with detailed model information.
 *
 * Architecture types:
 * - Cross-encoder: Concatenates query+doc, full attention between them
 * - Listwise LLM: Sees all candidates, makes relative comparisons
 *
 * Models:
 * - MiniLM: Distilled BERT, 6 layers, 22M params - fast inference
 * - BGE: BERT-based, trained on diverse retrieval tasks
 * - Jina: Multilingual (89 langs), code-optimized
 * - Gemini: Google's fast reasoning model, premium tier
 */
const TIER_OPTIONS = [
	{
		value: "auto",
		label: "Auto",
		shortDesc: "Query-adaptive routing",
		model: null,
		arch: "Classifier → Router",
		params: null,
		latency: "Variable",
		description: "Analyzes query complexity and routes to optimal tier",
	},
	{
		value: "fast",
		label: "Fast",
		shortDesc: "MiniLM-L6 Cross-Encoder",
		model: "ms-marco-MiniLM-L-6-v2",
		arch: "Cross-Encoder",
		params: "22M",
		latency: "~20ms",
		description: "Distilled BERT optimized for speed",
	},
	{
		value: "accurate",
		label: "Accurate",
		shortDesc: "BGE Reranker Base",
		model: "bge-reranker-base",
		arch: "Cross-Encoder",
		params: "278M",
		latency: "~150ms",
		description: "BAAI general embedding reranker",
	},
	{
		value: "code",
		label: "Code",
		shortDesc: "Jina v2 Multilingual",
		model: "jina-reranker-v2-base",
		arch: "Cross-Encoder",
		params: "278M",
		latency: "~150ms",
		description: "89 languages, code-optimized attention",
	},
	{
		value: "llm",
		label: "LLM",
		shortDesc: "Gemini 3.0 Flash",
		model: "gemini-3-flash-preview",
		arch: "Listwise LLM",
		params: "~300B",
		latency: "~2s",
		description: "Google's fast reasoning model, sees all candidates",
	},
] as const;

const DEPTH_PRESETS = [
	{ value: 20, label: "20" },
	{ value: 30, label: "30" },
	{ value: 50, label: "50" },
	{ value: 100, label: "100" },
] as const;

export function SearchSettings({ settings, onChange }: SearchSettingsProps) {
	const [isOpen, setIsOpen] = useState(false);
	const panelRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);

	// Close panel when clicking outside
	useEffect(() => {
		if (!isOpen) return;

		const handleClickOutside = (event: MouseEvent) => {
			if (
				panelRef.current &&
				buttonRef.current &&
				!panelRef.current.contains(event.target as Node) &&
				!buttonRef.current.contains(event.target as Node)
			) {
				setIsOpen(false);
			}
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsOpen(false);
				buttonRef.current?.focus();
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		document.addEventListener("keydown", handleEscape);

		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			document.removeEventListener("keydown", handleEscape);
		};
	}, [isOpen]);

	const handleToggleRerank = () => {
		onChange({ ...settings, rerank: !settings.rerank });
	};

	const handleTierChange = (tier: "auto" | RerankerTier) => {
		onChange({
			...settings,
			forceTier: tier === "auto" ? undefined : tier,
		});
	};

	const handleDepthChange = (depth: number) => {
		onChange({ ...settings, rerankDepth: depth });
	};

	const handleLatencyChange = (latency: string) => {
		const value = latency.trim() === "" ? undefined : Number.parseInt(latency, 10);
		onChange({
			...settings,
			latencyBudgetMs: value && !Number.isNaN(value) ? value : undefined,
		});
	};

	const selectedTier = settings.forceTier || "auto";

	return (
		<div style={{ position: "relative", zIndex: 20 }}>
			{/* Settings Toggle Button */}
			<button
				ref={buttonRef}
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				aria-expanded={isOpen}
				aria-haspopup="true"
				aria-label={`Configure reranker settings (currently ${settings.rerank ? "enabled" : "disabled"})`}
				style={{
					display: "flex",
					alignItems: "center",
					gap: "8px",
					padding: "8px 12px",
					background: isOpen
						? "linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(0, 245, 212, 0.1))"
						: settings.rerank
							? "linear-gradient(135deg, rgba(34, 197, 94, 0.08), rgba(15, 20, 30, 0.6))"
							: "rgba(15, 20, 30, 0.6)",
					backdropFilter: "blur(12px)",
					WebkitBackdropFilter: "blur(12px)",
					border: isOpen
						? "1px solid rgba(251, 191, 36, 0.4)"
						: settings.rerank
							? "1px solid rgba(34, 197, 94, 0.25)"
							: "1px solid rgba(71, 85, 105, 0.3)",
					borderRadius: "8px",
					color: isOpen ? "rgb(251, 191, 36)" : "rgb(148, 163, 184)",
					fontSize: "11px",
					fontFamily: "Orbitron, sans-serif",
					fontWeight: 600,
					letterSpacing: "0.05em",
					cursor: "pointer",
					transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
					boxShadow: isOpen
						? "0 4px 20px rgba(251, 191, 36, 0.15), inset 0 1px 0 rgba(251, 191, 36, 0.1)"
						: settings.rerank
							? "0 2px 12px rgba(34, 197, 94, 0.1), 0 2px 8px rgba(0, 0, 0, 0.2)"
							: "0 2px 8px rgba(0, 0, 0, 0.2)",
				}}
				onMouseEnter={(e) => {
					if (!isOpen) {
						e.currentTarget.style.background = settings.rerank
							? "linear-gradient(135deg, rgba(34, 197, 94, 0.12), rgba(15, 20, 30, 0.8))"
							: "rgba(15, 20, 30, 0.8)";
						e.currentTarget.style.borderColor = settings.rerank
							? "rgba(34, 197, 94, 0.35)"
							: "rgba(71, 85, 105, 0.5)";
					}
				}}
				onMouseLeave={(e) => {
					if (!isOpen) {
						e.currentTarget.style.background = settings.rerank
							? "linear-gradient(135deg, rgba(34, 197, 94, 0.08), rgba(15, 20, 30, 0.6))"
							: "rgba(15, 20, 30, 0.6)";
						e.currentTarget.style.borderColor = settings.rerank
							? "rgba(34, 197, 94, 0.25)"
							: "rgba(71, 85, 105, 0.3)";
					}
				}}
			>
				{/* Status Indicator Dot */}
				<div
					style={{
						width: "6px",
						height: "6px",
						borderRadius: "50%",
						backgroundColor: settings.rerank ? "rgb(34, 197, 94)" : "rgb(71, 85, 105)",
						boxShadow: settings.rerank
							? "0 0 6px rgba(34, 197, 94, 0.8), 0 0 12px rgba(34, 197, 94, 0.4)"
							: "none",
						transition: "all 0.3s ease",
					}}
				/>
				{/* Gear Icon */}
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					style={{
						transition: "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
						transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
					}}
				>
					<circle cx="12" cy="12" r="3" />
					<path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24" />
				</svg>
				<span>RERANKER</span>
			</button>

			{/* Settings Panel - Compact 2-Column Layout */}
			{isOpen && (
				<div
					ref={panelRef}
					role="dialog"
					aria-label="Reranker configuration panel"
					style={{
						position: "absolute",
						top: "calc(100% + 8px)",
						right: 0,
						width: "420px",
						background:
							"linear-gradient(135deg, rgba(15, 20, 30, 0.95) 0%, rgba(8, 10, 15, 0.98) 100%)",
						backdropFilter: "blur(20px)",
						WebkitBackdropFilter: "blur(20px)",
						border: "1px solid rgba(251, 191, 36, 0.25)",
						borderRadius: "12px",
						padding: "14px",
						boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(251, 191, 36, 0.1)",
						animation: "settingsPanelSlideIn 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
					}}
				>
					{/* Top accent line */}
					<div
						style={{
							position: "absolute",
							top: 0,
							left: "50%",
							transform: "translateX(-50%)",
							width: "60%",
							height: "1px",
							background:
								"linear-gradient(90deg, transparent, rgba(251, 191, 36, 0.5), transparent)",
						}}
					/>

					{/* Header Row: Title + Master Toggle */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							marginBottom: "12px",
							paddingBottom: "10px",
							borderBottom: "1px solid rgba(71, 85, 105, 0.2)",
						}}
					>
						<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
							<span
								style={{
									fontSize: "9px",
									fontFamily: "Orbitron, sans-serif",
									fontWeight: 600,
									letterSpacing: "0.15em",
									color: "rgb(251, 191, 36)",
									textShadow: "0 0 8px rgba(251, 191, 36, 0.4)",
								}}
							>
								RERANKER CONFIG
							</span>
							<div
								style={{
									width: "4px",
									height: "4px",
									borderRadius: "50%",
									backgroundColor: settings.rerank ? "rgb(34, 197, 94)" : "rgb(71, 85, 105)",
									boxShadow: settings.rerank ? "0 0 8px rgba(34, 197, 94, 0.6)" : "none",
									transition: "all 0.3s ease",
								}}
							/>
						</div>

						{/* Compact Toggle Switch */}
						<button
							type="button"
							onClick={handleToggleRerank}
							aria-pressed={settings.rerank}
							aria-label={settings.rerank ? "Disable reranking" : "Enable reranking"}
							style={{
								display: "flex",
								alignItems: "center",
								gap: "6px",
								padding: "4px 8px",
								background: settings.rerank ? "rgba(34, 197, 94, 0.15)" : "rgba(71, 85, 105, 0.15)",
								border: settings.rerank
									? "1px solid rgba(34, 197, 94, 0.3)"
									: "1px solid rgba(71, 85, 105, 0.25)",
								borderRadius: "6px",
								cursor: "pointer",
								transition: "all 0.25s ease",
							}}
						>
							<span
								style={{
									fontSize: "9px",
									fontFamily: "JetBrains Mono, monospace",
									fontWeight: 600,
									color: settings.rerank ? "rgb(34, 197, 94)" : "rgb(100, 116, 139)",
									letterSpacing: "0.05em",
								}}
							>
								{settings.rerank ? "ON" : "OFF"}
							</span>
							<div
								style={{
									width: "28px",
									height: "14px",
									background: settings.rerank ? "rgba(34, 197, 94, 0.3)" : "rgba(71, 85, 105, 0.3)",
									borderRadius: "7px",
									position: "relative",
									transition: "background 0.2s ease",
								}}
							>
								<div
									style={{
										position: "absolute",
										top: "2px",
										left: settings.rerank ? "14px" : "2px",
										width: "10px",
										height: "10px",
										background: settings.rerank ? "rgb(34, 197, 94)" : "rgb(100, 116, 139)",
										borderRadius: "50%",
										transition: "left 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.25s ease",
										boxShadow: settings.rerank ? "0 0 6px rgba(34, 197, 94, 0.6)" : "none",
									}}
								/>
							</div>
						</button>
					</div>

					{/* Main Content - 2 Column Grid */}
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "1fr 1fr",
							gap: "12px",
							opacity: settings.rerank ? 1 : 0.4,
							pointerEvents: settings.rerank ? "auto" : "none",
							transition: "opacity 0.3s ease",
						}}
					>
						{/* Left Column: Tier Selection */}
						<div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
							<span
								style={{
									fontSize: "8px",
									fontFamily: "JetBrains Mono, monospace",
									fontWeight: 500,
									color: "rgb(148, 163, 184)",
									letterSpacing: "0.08em",
									textTransform: "uppercase",
								}}
							>
								Tier
							</span>
							<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
								{/* Auto - Full Width Featured Option */}
								<button
									type="button"
									onClick={() => handleTierChange("auto")}
									disabled={!settings.rerank}
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										padding: "8px 10px",
										background:
											selectedTier === "auto"
												? "linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(251, 191, 36, 0.1))"
												: "rgba(22, 30, 45, 0.5)",
										border:
											selectedTier === "auto"
												? "1px solid rgba(251, 191, 36, 0.4)"
												: "1px solid rgba(71, 85, 105, 0.2)",
										borderRadius: "6px",
										cursor: settings.rerank ? "pointer" : "not-allowed",
										transition: "all 0.2s ease",
									}}
									onMouseEnter={(e) => {
										if (settings.rerank && selectedTier !== "auto") {
											e.currentTarget.style.background = "rgba(22, 30, 45, 0.7)";
											e.currentTarget.style.borderColor = "rgba(71, 85, 105, 0.35)";
										}
									}}
									onMouseLeave={(e) => {
										if (settings.rerank && selectedTier !== "auto") {
											e.currentTarget.style.background = "rgba(22, 30, 45, 0.5)";
											e.currentTarget.style.borderColor = "rgba(71, 85, 105, 0.2)";
										}
									}}
								>
									<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
										<span
											style={{
												fontSize: "10px",
												fontFamily: "Orbitron, sans-serif",
												fontWeight: 600,
												color: selectedTier === "auto" ? "rgb(251, 191, 36)" : "rgb(148, 163, 184)",
											}}
										>
											Auto
										</span>
										<span
											style={{
												fontSize: "7px",
												fontFamily: "JetBrains Mono, monospace",
												color:
													selectedTier === "auto"
														? "rgba(251, 191, 36, 0.7)"
														: "rgb(100, 116, 139)",
												padding: "1px 4px",
												background:
													selectedTier === "auto"
														? "rgba(251, 191, 36, 0.1)"
														: "rgba(71, 85, 105, 0.2)",
												borderRadius: "3px",
											}}
										>
											Query-Adaptive
										</span>
									</div>
									<span
										style={{
											fontSize: "6px",
											fontFamily: "JetBrains Mono, monospace",
											color: "rgb(100, 116, 139)",
											letterSpacing: "0.05em",
										}}
									>
										Classifier → Router
									</span>
								</button>

								{/* Other tiers in 2x2 grid */}
								<div
									style={{
										display: "grid",
										gridTemplateColumns: "repeat(2, 1fr)",
										gap: "4px",
									}}
								>
									{TIER_OPTIONS.filter((o) => o.value !== "auto").map((option) => (
										<button
											key={option.value}
											type="button"
											onClick={() => handleTierChange(option.value as RerankerTier)}
											disabled={!settings.rerank}
											style={{
												display: "flex",
												flexDirection: "column",
												alignItems: "flex-start",
												justifyContent: "flex-start",
												padding: "6px 8px",
												background:
													selectedTier === option.value
														? "linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(251, 191, 36, 0.1))"
														: "rgba(22, 30, 45, 0.5)",
												border:
													selectedTier === option.value
														? "1px solid rgba(251, 191, 36, 0.4)"
														: "1px solid rgba(71, 85, 105, 0.2)",
												borderRadius: "5px",
												cursor: settings.rerank ? "pointer" : "not-allowed",
												transition: "all 0.2s ease",
												minHeight: "52px",
											}}
											onMouseEnter={(e) => {
												if (settings.rerank && selectedTier !== option.value) {
													e.currentTarget.style.background = "rgba(22, 30, 45, 0.7)";
													e.currentTarget.style.borderColor = "rgba(71, 85, 105, 0.35)";
												}
											}}
											onMouseLeave={(e) => {
												if (settings.rerank && selectedTier !== option.value) {
													e.currentTarget.style.background = "rgba(22, 30, 45, 0.5)";
													e.currentTarget.style.borderColor = "rgba(71, 85, 105, 0.2)";
												}
											}}
										>
											{/* Header row: Label + Latency */}
											<div
												style={{
													display: "flex",
													alignItems: "center",
													justifyContent: "space-between",
													width: "100%",
													marginBottom: "2px",
												}}
											>
												<span
													style={{
														fontSize: "9px",
														fontFamily: "Orbitron, sans-serif",
														fontWeight: 600,
														color:
															selectedTier === option.value
																? "rgb(251, 191, 36)"
																: "rgb(148, 163, 184)",
														transition: "color 0.2s ease",
													}}
												>
													{option.label}
												</span>
												<span
													style={{
														fontSize: "6px",
														fontFamily: "JetBrains Mono, monospace",
														color:
															selectedTier === option.value
																? "rgba(0, 245, 212, 0.9)"
																: "rgb(71, 85, 105)",
														padding: "1px 3px",
														background:
															selectedTier === option.value
																? "rgba(0, 245, 212, 0.1)"
																: "transparent",
														borderRadius: "2px",
													}}
												>
													{option.latency}
												</span>
											</div>
											{/* Model name */}
											<span
												style={{
													fontSize: "6px",
													fontFamily: "JetBrains Mono, monospace",
													color:
														selectedTier === option.value
															? "rgba(251, 191, 36, 0.8)"
															: "rgb(100, 116, 139)",
													letterSpacing: "0.02em",
													marginBottom: "2px",
												}}
											>
												{option.model}
											</span>
											{/* Architecture + Params */}
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: "4px",
												}}
											>
												<span
													style={{
														fontSize: "6px",
														fontFamily: "JetBrains Mono, monospace",
														color: "rgb(71, 85, 105)",
														padding: "1px 3px",
														background: "rgba(71, 85, 105, 0.15)",
														borderRadius: "2px",
													}}
												>
													{option.arch}
												</span>
												{option.params && (
													<span
														style={{
															fontSize: "6px",
															fontFamily: "JetBrains Mono, monospace",
															color: "rgb(71, 85, 105)",
														}}
													>
														{option.params}
													</span>
												)}
											</div>
										</button>
									))}
								</div>
							</div>
						</div>

						{/* Right Column: Depth + Latency */}
						<div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
							{/* Depth Selection */}
							<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
								<span
									style={{
										fontSize: "8px",
										fontFamily: "JetBrains Mono, monospace",
										fontWeight: 500,
										color: "rgb(148, 163, 184)",
										letterSpacing: "0.08em",
										textTransform: "uppercase",
									}}
								>
									Depth
								</span>
								<div
									style={{
										display: "grid",
										gridTemplateColumns: "repeat(4, 1fr)",
										gap: "4px",
									}}
								>
									{DEPTH_PRESETS.map((preset) => (
										<button
											key={preset.value}
											type="button"
											onClick={() => handleDepthChange(preset.value)}
											disabled={!settings.rerank}
											style={{
												padding: "6px 4px",
												background:
													settings.rerankDepth === preset.value
														? "rgba(0, 245, 212, 0.15)"
														: "rgba(22, 30, 45, 0.5)",
												border:
													settings.rerankDepth === preset.value
														? "1px solid rgba(0, 245, 212, 0.4)"
														: "1px solid rgba(71, 85, 105, 0.2)",
												borderRadius: "4px",
												cursor: settings.rerank ? "pointer" : "not-allowed",
												transition: "all 0.2s ease",
												fontSize: "10px",
												fontFamily: "JetBrains Mono, monospace",
												fontWeight: 600,
												color:
													settings.rerankDepth === preset.value
														? "rgb(0, 245, 212)"
														: "rgb(148, 163, 184)",
											}}
											onMouseEnter={(e) => {
												if (settings.rerank && settings.rerankDepth !== preset.value) {
													e.currentTarget.style.background = "rgba(22, 30, 45, 0.7)";
													e.currentTarget.style.borderColor = "rgba(71, 85, 105, 0.35)";
												}
											}}
											onMouseLeave={(e) => {
												if (settings.rerank && settings.rerankDepth !== preset.value) {
													e.currentTarget.style.background = "rgba(22, 30, 45, 0.5)";
													e.currentTarget.style.borderColor = "rgba(71, 85, 105, 0.2)";
												}
											}}
										>
											{preset.label}
										</button>
									))}
								</div>
							</div>

							{/* Latency Budget */}
							<div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
								<label
									htmlFor="latency-budget"
									style={{
										fontSize: "8px",
										fontFamily: "JetBrains Mono, monospace",
										fontWeight: 500,
										color: "rgb(148, 163, 184)",
										letterSpacing: "0.08em",
										textTransform: "uppercase",
										display: "flex",
										alignItems: "center",
										gap: "4px",
									}}
								>
									Latency
									<span style={{ fontSize: "7px", color: "rgb(71, 85, 105)", fontStyle: "italic" }}>
										ms
									</span>
								</label>
								<input
									id="latency-budget"
									type="number"
									placeholder="Auto"
									value={settings.latencyBudgetMs ?? ""}
									onChange={(e) => handleLatencyChange(e.target.value)}
									disabled={!settings.rerank}
									min="10"
									max="5000"
									step="10"
									aria-label="Latency budget in milliseconds"
									style={{
										padding: "6px 8px",
										background: "rgba(22, 30, 45, 0.6)",
										border: "1px solid rgba(71, 85, 105, 0.3)",
										borderRadius: "4px",
										color: "rgb(226, 232, 240)",
										fontSize: "10px",
										fontFamily: "JetBrains Mono, monospace",
										outline: "none",
										transition: "all 0.25s ease",
										cursor: settings.rerank ? "text" : "not-allowed",
										width: "100%",
									}}
									onFocus={(e) => {
										if (settings.rerank) {
											e.target.style.borderColor = "rgba(0, 245, 212, 0.5)";
											e.target.style.boxShadow = "0 0 8px rgba(0, 245, 212, 0.15)";
										}
									}}
									onBlur={(e) => {
										e.target.style.borderColor = "rgba(71, 85, 105, 0.3)";
										e.target.style.boxShadow = "none";
									}}
								/>
							</div>
						</div>
					</div>

					{/* Footer Tip */}
					<div
						style={{
							marginTop: "10px",
							paddingTop: "8px",
							borderTop: "1px solid rgba(71, 85, 105, 0.15)",
							fontSize: "7px",
							fontFamily: "JetBrains Mono, monospace",
							color: "rgb(71, 85, 105)",
							textAlign: "center",
							letterSpacing: "0.02em",
						}}
					>
						Cross-encoders score query+doc pairs • LLM sees all candidates (listwise)
					</div>
				</div>
			)}

			{/* Animations */}
			<style jsx>{`
				@keyframes settingsPanelSlideIn {
					from {
						opacity: 0;
						transform: translateY(-8px);
					}
					to {
						opacity: 1;
						transform: translateY(0);
					}
				}

				/* Number input styling */
				input[type="number"]::-webkit-inner-spin-button,
				input[type="number"]::-webkit-outer-spin-button {
					opacity: 0.5;
				}

				input[type="number"]:hover::-webkit-inner-spin-button,
				input[type="number"]:hover::-webkit-outer-spin-button {
					opacity: 1;
				}
			`}</style>
		</div>
	);
}
