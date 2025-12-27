"use client";

import { useSession } from "@lib/auth-client";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

type ActivationState = "idle" | "loading" | "success" | "error";

function ActivateContent() {
	const searchParams = useSearchParams();
	const { data: session, isPending: isSessionLoading } = useSession();
	const [code, setCode] = useState("");
	const [state, setState] = useState<ActivationState>("idle");
	const [errorMessage, setErrorMessage] = useState("");
	const [cursorVisible, setCursorVisible] = useState(true);
	const inputRef = useRef<HTMLInputElement>(null);

	// Format code as XXXX-XXXX
	const formatCode = useCallback((value: string): string => {
		const clean = value
			.replace(/[^A-Z0-9]/gi, "")
			.toUpperCase()
			.slice(0, 8);
		if (clean.length > 4) {
			return `${clean.slice(0, 4)}-${clean.slice(4)}`;
		}
		return clean;
	}, []);

	// Pre-fill from query param
	useEffect(() => {
		const codeParam = searchParams.get("code");
		if (codeParam) {
			const formatted = formatCode(codeParam.toUpperCase());
			setCode(formatted);
		}
	}, [searchParams, formatCode]);

	// Blinking cursor effect
	useEffect(() => {
		const interval = setInterval(() => {
			setCursorVisible((v) => !v);
		}, 530);
		return () => clearInterval(interval);
	}, []);

	// Focus input on mount
	useEffect(() => {
		if (!isSessionLoading && session?.user) {
			inputRef.current?.focus();
		}
	}, [isSessionLoading, session]);

	const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const formatted = formatCode(e.target.value);
		setCode(formatted);
		setErrorMessage("");
		setState("idle");
	};

	const handleSubmit = useCallback(async () => {
		if (code.replace("-", "").length !== 8) {
			setErrorMessage("Please enter a complete code");
			setState("error");
			return;
		}

		setState("loading");
		setErrorMessage("");

		try {
			const response = await fetch("/api/auth/device/verify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ user_code: code }),
			});

			const data = await response.json();

			if (data.success) {
				setState("success");
			} else {
				setState("error");
				setErrorMessage(data.error?.message || "Verification failed");
			}
		} catch {
			setState("error");
			setErrorMessage("Connection failed. Please try again.");
		}
	}, [code]);

	// Handle Enter key
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && state !== "loading") {
			handleSubmit();
		}
	};

	// Loading session
	if (isSessionLoading) {
		return (
			<div className="activate-container">
				<div className="terminal-window">
					<div className="terminal-header">
						<div className="terminal-dots">
							<span className="dot red" />
							<span className="dot yellow" />
							<span className="dot green" />
						</div>
						<span className="terminal-title">engram :: authenticate</span>
					</div>
					<div className="terminal-body">
						<div className="loading-line">
							<span className="prompt">{">"}</span>
							<span className="loading-dots">Initializing</span>
						</div>
					</div>
				</div>
				<style jsx>{styles}</style>
			</div>
		);
	}

	// Build sign-in URL with callback to preserve the code
	const codeParam = searchParams.get("code");
	const callbackUrl = codeParam ? `/activate?code=${encodeURIComponent(codeParam)}` : "/activate";
	const signInUrl = `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`;

	// Not logged in
	if (!session?.user) {
		return (
			<div className="activate-container">
				<div className="terminal-window">
					<div className="terminal-header">
						<div className="terminal-dots">
							<span className="dot red" />
							<span className="dot yellow" />
							<span className="dot green" />
						</div>
						<span className="terminal-title">engram :: authenticate</span>
					</div>
					<div className="terminal-body">
						<div className="output-line error-text">
							<span className="prompt">!</span>
							<span>Authentication required</span>
						</div>
						<div className="output-line muted">
							<span className="prompt"> </span>
							<span>Sign in to authorize your device</span>
						</div>
						<div className="action-area">
							<a href={signInUrl} className="sign-in-link">
								<span className="link-prefix">→</span>
								Continue to sign in
							</a>
						</div>
					</div>
				</div>
				<style jsx>{styles}</style>
			</div>
		);
	}

	// Success state
	if (state === "success") {
		return (
			<div className="activate-container">
				<div className="terminal-window success-glow">
					<div className="terminal-header">
						<div className="terminal-dots">
							<span className="dot red" />
							<span className="dot yellow" />
							<span className="dot green pulse" />
						</div>
						<span className="terminal-title">engram :: authenticated</span>
					</div>
					<div className="terminal-body">
						<div className="success-icon">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						</div>
						<div className="output-line success-text large">
							<span>Device authorized</span>
						</div>
						<div className="output-line muted">
							<span>as {session.user.email}</span>
						</div>
						<div className="output-line muted" style={{ marginTop: "1.5rem" }}>
							<span>You can close this window and return to your terminal.</span>
						</div>
					</div>
				</div>
				<style jsx>{styles}</style>
			</div>
		);
	}

	// Main form
	return (
		<div className="activate-container">
			<div className={`terminal-window ${state === "error" ? "error-shake" : ""}`}>
				<div className="terminal-header">
					<div className="terminal-dots">
						<span className="dot red" />
						<span className="dot yellow" />
						<span className="dot green" />
					</div>
					<span className="terminal-title">engram :: activate device</span>
				</div>
				<div className="terminal-body">
					<div className="output-line muted">
						<span className="prompt">#</span>
						<span>Enter the code shown in your terminal</span>
					</div>

					{/* biome-ignore lint/a11y/useKeyWithClickEvents: click delegates to hidden input which handles keyboard */}
					<div className="code-input-wrapper" onClick={() => inputRef.current?.focus()}>
						<span className="prompt cyan">{">"}</span>
						<div className="code-display">
							{code.split("").map((char, i) => (
								<span
									key={`char-${i}-${char}`}
									className={`code-char ${char === "-" ? "separator" : ""}`}
								>
									{char}
								</span>
							))}
							{code.length < 9 && (
								<span className={`cursor ${cursorVisible ? "visible" : ""}`}>_</span>
							)}
						</div>
						<input
							ref={inputRef}
							type="text"
							value={code}
							onChange={handleCodeChange}
							onKeyDown={handleKeyDown}
							className="hidden-input"
							placeholder=""
							autoComplete="off"
							autoCapitalize="characters"
							spellCheck={false}
							disabled={state === "loading"}
						/>
					</div>

					{errorMessage && (
						<div className="output-line error-text">
							<span className="prompt">!</span>
							<span>{errorMessage}</span>
						</div>
					)}

					<div className="action-area">
						<button
							type="button"
							onClick={handleSubmit}
							disabled={state === "loading" || code.replace("-", "").length !== 8}
							className="submit-button"
						>
							{state === "loading" ? (
								<>
									<span className="spinner" />
									<span>Verifying...</span>
								</>
							) : (
								<>
									<span className="button-prefix">⏎</span>
									<span>Authorize Device</span>
								</>
							)}
						</button>
					</div>

					<div className="footer-info">
						<span className="muted-small">Signed in as {session.user.email}</span>
					</div>
				</div>
			</div>
			<style jsx>{styles}</style>
		</div>
	);
}

export default function ActivatePage() {
	return (
		<Suspense
			fallback={
				<div
					style={{
						minHeight: "100dvh",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<div style={{ color: "rgb(var(--text-muted))" }}>Loading...</div>
				</div>
			}
		>
			<ActivateContent />
		</Suspense>
	);
}

const styles = `
	.activate-container {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.terminal-window {
		width: 100%;
		max-width: 480px;
		background: rgba(8, 10, 15, 0.95);
		border: 1px solid rgba(0, 245, 212, 0.15);
		border-radius: 12px;
		overflow: hidden;
		box-shadow:
			0 0 60px rgba(0, 245, 212, 0.08),
			0 25px 50px rgba(0, 0, 0, 0.5),
			inset 0 1px 0 rgba(255, 255, 255, 0.03);
		animation: window-appear 0.4s ease-out;
	}

	.terminal-window.success-glow {
		border-color: rgba(34, 197, 94, 0.4);
		box-shadow:
			0 0 80px rgba(34, 197, 94, 0.15),
			0 25px 50px rgba(0, 0, 0, 0.5),
			inset 0 1px 0 rgba(255, 255, 255, 0.03);
	}

	@keyframes window-appear {
		from {
			opacity: 0;
			transform: scale(0.96) translateY(10px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	.terminal-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		background: rgba(15, 20, 30, 0.6);
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	}

	.terminal-dots {
		display: flex;
		gap: 6px;
	}

	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.dot.red { background: #ff5f57; }
	.dot.yellow { background: #febc2e; }
	.dot.green { background: #28c840; }
	.dot.pulse {
		animation: dot-pulse 1.5s ease-in-out infinite;
	}

	@keyframes dot-pulse {
		0%, 100% { opacity: 1; box-shadow: 0 0 8px #28c840; }
		50% { opacity: 0.6; box-shadow: 0 0 16px #28c840; }
	}

	.terminal-title {
		font-size: 0.75rem;
		color: rgb(var(--text-muted));
		letter-spacing: 0.05em;
		text-transform: lowercase;
	}

	.terminal-body {
		padding: 1.5rem;
	}

	.output-line {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		font-size: 0.875rem;
		line-height: 1.6;
	}

	.output-line.large {
		font-size: 1.25rem;
		font-weight: 500;
	}

	.prompt {
		color: rgb(var(--neural-purple));
		font-weight: 500;
		flex-shrink: 0;
		width: 1rem;
	}

	.prompt.cyan {
		color: rgb(var(--neural-cyan));
	}

	.muted {
		color: rgb(var(--text-muted));
	}

	.muted-small {
		font-size: 0.75rem;
		color: rgb(var(--text-muted));
	}

	.error-text {
		color: #f87171;
	}

	.error-text .prompt {
		color: #f87171;
	}

	.success-text {
		color: #4ade80;
	}

	.success-icon {
		width: 48px;
		height: 48px;
		margin: 0 auto 1rem;
		color: #4ade80;
		animation: success-pop 0.3s ease-out;
	}

	@keyframes success-pop {
		0% { transform: scale(0); opacity: 0; }
		50% { transform: scale(1.2); }
		100% { transform: scale(1); opacity: 1; }
	}

	.code-input-wrapper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 1.25rem 0;
		padding: 1rem 1.25rem;
		background: rgba(15, 20, 30, 0.8);
		border: 1px solid rgba(0, 245, 212, 0.2);
		border-radius: 8px;
		cursor: text;
		transition: all 0.2s ease;
	}

	.code-input-wrapper:focus-within {
		border-color: rgba(0, 245, 212, 0.5);
		box-shadow:
			0 0 20px rgba(0, 245, 212, 0.1),
			inset 0 0 10px rgba(0, 245, 212, 0.03);
	}

	.code-display {
		display: flex;
		gap: 0.125rem;
		font-family: "JetBrains Mono", monospace;
		font-size: 1.5rem;
		font-weight: 500;
		letter-spacing: 0.1em;
	}

	.code-char {
		color: rgb(var(--neural-cyan));
		text-shadow: 0 0 10px rgba(0, 245, 212, 0.5);
	}

	.code-char.separator {
		color: rgb(var(--text-muted));
		text-shadow: none;
		margin: 0 0.25rem;
	}

	.cursor {
		color: rgb(var(--neural-cyan));
		opacity: 0;
		animation: none;
	}

	.cursor.visible {
		opacity: 1;
	}

	.hidden-input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
		width: 0;
		height: 0;
	}

	.action-area {
		margin-top: 1.5rem;
	}

	.submit-button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.875rem 1.5rem;
		background: linear-gradient(135deg, rgba(0, 245, 212, 0.15), rgba(139, 92, 246, 0.15));
		border: 1px solid rgba(0, 245, 212, 0.3);
		border-radius: 8px;
		color: rgb(var(--neural-cyan));
		font-family: "Orbitron", sans-serif;
		font-size: 0.875rem;
		font-weight: 500;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.submit-button:hover:not(:disabled) {
		background: linear-gradient(135deg, rgba(0, 245, 212, 0.25), rgba(139, 92, 246, 0.25));
		border-color: rgba(0, 245, 212, 0.5);
		box-shadow:
			0 0 30px rgba(0, 245, 212, 0.2),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
		transform: translateY(-1px);
	}

	.submit-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.button-prefix {
		font-size: 1rem;
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid rgba(0, 245, 212, 0.3);
		border-top-color: rgb(var(--neural-cyan));
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.sign-in-link {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.875rem 1.5rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 8px;
		color: rgb(var(--text-primary));
		font-size: 0.9375rem;
		text-decoration: none;
		transition: all 0.2s ease;
	}

	.sign-in-link:hover {
		background: rgba(255, 255, 255, 0.05);
		border-color: rgba(0, 245, 212, 0.3);
		box-shadow: 0 0 20px rgba(0, 245, 212, 0.1);
	}

	.link-prefix {
		color: rgb(var(--neural-cyan));
	}

	.footer-info {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid rgba(255, 255, 255, 0.05);
		text-align: center;
	}

	.loading-line {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.loading-dots::after {
		content: "";
		animation: loading-dots 1.5s infinite;
	}

	@keyframes loading-dots {
		0% { content: ""; }
		25% { content: "."; }
		50% { content: ".."; }
		75% { content: "..."; }
	}

	.error-shake {
		animation: shake 0.4s ease-in-out;
	}

	@keyframes shake {
		0%, 100% { transform: translateX(0); }
		20%, 60% { transform: translateX(-6px); }
		40%, 80% { transform: translateX(6px); }
	}
`;
