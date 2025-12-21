"use client";

import type { SearchMode } from "@app/hooks/useSearch";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface SearchInputProps {
	value: string;
	onChange: (value: string) => void;
	mode: SearchMode;
	detectedUUID: string | null;
	isLoading: boolean;
	isDebouncing: boolean;
	resultCount?: number;
}

export function SearchInput({
	value,
	onChange,
	mode,
	detectedUUID,
	isLoading,
	isDebouncing,
	resultCount = 0,
}: SearchInputProps) {
	const router = useRouter();
	const inputRef = useRef<HTMLInputElement>(null);
	const [isFocused, setIsFocused] = useState(false);

	// Handle keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Focus search on "/" key (when not already focused on an input)
			if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
				e.preventDefault();
				inputRef.current?.focus();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	const handleSubmit = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			if (detectedUUID) {
				router.push(`/session/${detectedUUID}`);
			}
		},
		[detectedUUID, router],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && detectedUUID) {
				router.push(`/session/${detectedUUID}`);
			}
		},
		[detectedUUID, router],
	);

	// Determine status indicator
	const showSpinner = isLoading || isDebouncing;
	const showUUIDAction = mode === "uuid" && detectedUUID;
	const showResultCount = mode === "search" && !isLoading && resultCount > 0;

	return (
		<form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: "600px", margin: "0 auto" }}>
			<div
				style={{
					position: "relative",
					display: "flex",
					alignItems: "center",
				}}
			>
				{/* Search icon / spinner */}
				<div
					style={{
						position: "absolute",
						left: "16px",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						width: "20px",
						height: "20px",
						pointerEvents: "none",
					}}
				>
					{showSpinner ? (
						<div
							style={{
								width: "16px",
								height: "16px",
								border: "2px solid rgba(0, 245, 212, 0.2)",
								borderTopColor: "rgb(0, 245, 212)",
								borderRadius: "50%",
								animation: "searchSpin 0.8s linear infinite",
							}}
						/>
					) : (
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke={isFocused ? "rgb(0, 245, 212)" : "rgb(148, 163, 184)"}
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{ transition: "stroke 0.2s ease" }}
						>
							<circle cx="11" cy="11" r="8" />
							<path d="m21 21-4.35-4.35" />
						</svg>
					)}
				</div>

				{/* Input field */}
				<input
					ref={inputRef}
					type="text"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onFocus={() => setIsFocused(true)}
					onBlur={() => setIsFocused(false)}
					onKeyDown={handleKeyDown}
					placeholder="Search thoughts, code, or enter session UUID..."
					autoComplete="off"
					spellCheck={false}
					style={{
						width: "100%",
						padding: "14px 16px 14px 48px",
						paddingRight: showUUIDAction || showResultCount ? "120px" : "48px",
						fontSize: "14px",
						fontFamily: "JetBrains Mono, monospace",
						color: "rgb(226, 232, 240)",
						backgroundColor: "rgba(15, 20, 30, 0.8)",
						border: isFocused
							? "1px solid rgba(0, 245, 212, 0.5)"
							: "1px solid rgba(100, 116, 139, 0.25)",
						borderRadius: "12px",
						outline: "none",
						transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
						boxShadow: isFocused
							? "0 0 0 3px rgba(0, 245, 212, 0.1), 0 4px 20px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.05)"
							: "0 2px 10px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255,255,255,0.03)",
						backdropFilter: "blur(12px)",
					}}
				/>

				{/* Right side actions */}
				<div
					style={{
						position: "absolute",
						right: "12px",
						display: "flex",
						alignItems: "center",
						gap: "8px",
					}}
				>
					{/* UUID detected - Go button */}
					{showUUIDAction && (
						<button
							type="submit"
							style={{
								display: "flex",
								alignItems: "center",
								gap: "6px",
								padding: "6px 12px",
								fontSize: "10px",
								fontFamily: "Orbitron, sans-serif",
								fontWeight: 600,
								letterSpacing: "0.1em",
								color: "rgb(0, 245, 212)",
								backgroundColor: "rgba(0, 245, 212, 0.1)",
								border: "1px solid rgba(0, 245, 212, 0.3)",
								borderRadius: "6px",
								cursor: "pointer",
								transition: "all 0.2s ease",
								animation: "uuidPulse 2s ease-in-out infinite",
							}}
							onMouseEnter={(e) => {
								e.currentTarget.style.backgroundColor = "rgba(0, 245, 212, 0.2)";
								e.currentTarget.style.borderColor = "rgba(0, 245, 212, 0.5)";
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.backgroundColor = "rgba(0, 245, 212, 0.1)";
								e.currentTarget.style.borderColor = "rgba(0, 245, 212, 0.3)";
							}}
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M5 12h14" />
								<path d="m12 5 7 7-7 7" />
							</svg>
							GO TO SESSION
						</button>
					)}

					{/* Result count badge */}
					{showResultCount && (
						<span
							style={{
								padding: "4px 10px",
								fontSize: "10px",
								fontFamily: "JetBrains Mono, monospace",
								fontWeight: 500,
								color: "rgb(148, 163, 184)",
								backgroundColor: "rgba(100, 116, 139, 0.15)",
								borderRadius: "4px",
								border: "1px solid rgba(100, 116, 139, 0.2)",
							}}
						>
							{resultCount} {resultCount === 1 ? "match" : "matches"}
						</span>
					)}

					{/* Keyboard hint when empty */}
					{!value && !isFocused && (
						<span
							style={{
								padding: "4px 8px",
								fontSize: "10px",
								fontFamily: "JetBrains Mono, monospace",
								color: "rgb(71, 85, 105)",
								backgroundColor: "rgba(15, 20, 30, 0.6)",
								borderRadius: "4px",
								border: "1px solid rgba(71, 85, 105, 0.3)",
							}}
						>
							/
						</span>
					)}
				</div>
			</div>

			{/* Inline styles for animations */}
			<style jsx>{`
				@keyframes searchSpin {
					from { transform: rotate(0deg); }
					to { transform: rotate(360deg); }
				}
				@keyframes uuidPulse {
					0%, 100% {
						box-shadow: 0 0 0 0 rgba(0, 245, 212, 0.2);
					}
					50% {
						box-shadow: 0 0 12px 2px rgba(0, 245, 212, 0.15);
					}
				}
			`}</style>
		</form>
	);
}
