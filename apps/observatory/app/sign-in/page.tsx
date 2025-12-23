"use client";

import { signIn } from "@lib/auth-client";

export default function SignInPage() {
	const handleSignIn = async () => {
		await signIn.social({
			provider: "google",
			callbackURL: "/",
		});
	};

	return (
		<div
			style={{
				minHeight: "100dvh",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				position: "relative",
			}}
		>
			<div
				style={{
					position: "relative",
					zIndex: 10,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					padding: "3rem 2rem",
					maxWidth: "420px",
					width: "100%",
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						marginBottom: "3rem",
					}}
				>
					<div
						className="logo-icon"
						style={{
							width: "64px",
							height: "64px",
							color: "rgb(0, 245, 212)",
							marginBottom: "1.5rem",
						}}
					>
						<svg
							viewBox="0 0 48 48"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
							width="64"
							height="64"
						>
							<circle
								cx="24"
								cy="24"
								r="20"
								stroke="currentColor"
								strokeWidth="1.5"
								opacity="0.3"
							/>
							<circle
								cx="24"
								cy="24"
								r="12"
								stroke="currentColor"
								strokeWidth="1.5"
								opacity="0.5"
							/>
							<circle cx="24" cy="24" r="4" fill="currentColor" />
							<circle cx="24" cy="8" r="2" fill="currentColor" opacity="0.7" />
							<circle cx="24" cy="40" r="2" fill="currentColor" opacity="0.7" />
							<circle cx="8" cy="24" r="2" fill="currentColor" opacity="0.7" />
							<circle cx="40" cy="24" r="2" fill="currentColor" opacity="0.7" />
							<line
								x1="24"
								y1="10"
								x2="24"
								y2="20"
								stroke="currentColor"
								strokeWidth="1"
								opacity="0.5"
							/>
							<line
								x1="24"
								y1="28"
								x2="24"
								y2="38"
								stroke="currentColor"
								strokeWidth="1"
								opacity="0.5"
							/>
							<line
								x1="10"
								y1="24"
								x2="20"
								y2="24"
								stroke="currentColor"
								strokeWidth="1"
								opacity="0.5"
							/>
							<line
								x1="28"
								y1="24"
								x2="38"
								y2="24"
								stroke="currentColor"
								strokeWidth="1"
								opacity="0.5"
							/>
						</svg>
					</div>
					<h1
						className="font-display text-glow"
						style={{
							fontSize: "1.75rem",
							fontWeight: 700,
							letterSpacing: "-0.02em",
							margin: "0 0 0.5rem 0",
							textAlign: "center",
						}}
					>
						Neural Observatory
					</h1>
					<p
						style={{
							fontSize: "0.875rem",
							fontWeight: 300,
							color: "rgb(148, 163, 184)",
							margin: 0,
							letterSpacing: "0.02em",
						}}
					>
						Session visualization & memory analytics
					</p>
				</div>

				<button
					onClick={handleSignIn}
					className="sign-in-button"
					type="button"
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						gap: "0.75rem",
						width: "100%",
						padding: "0.875rem 1.5rem",
						background: "rgba(255, 255, 255, 0.03)",
						border: "1px solid rgba(255, 255, 255, 0.1)",
						borderRadius: "8px",
						color: "rgb(241, 245, 249)",
						fontSize: "0.9375rem",
						fontWeight: 500,
						cursor: "pointer",
					}}
				>
					<svg style={{ width: "20px", height: "20px", flexShrink: 0 }} viewBox="0 0 24 24">
						<path
							d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
							fill="#4285F4"
						/>
						<path
							d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
							fill="#34A853"
						/>
						<path
							d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
							fill="#FBBC05"
						/>
						<path
							d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
							fill="#EA4335"
						/>
					</svg>
					<span>Continue with Google</span>
				</button>
			</div>

			<style jsx>{`
				.logo-icon {
					animation: pulse-glow 3s ease-in-out infinite;
				}

				@keyframes pulse-glow {
					0%, 100% {
						filter: drop-shadow(0 0 8px rgba(0, 245, 212, 0.4));
					}
					50% {
						filter: drop-shadow(0 0 20px rgba(0, 245, 212, 0.6));
					}
				}

				.sign-in-button {
					transition: all 0.2s ease;
					position: relative;
					overflow: hidden;
				}

				.sign-in-button::before {
					content: "";
					position: absolute;
					inset: 0;
					background: linear-gradient(
						135deg,
						rgba(0, 245, 212, 0.1) 0%,
						rgba(0, 245, 212, 0) 50%
					);
					opacity: 0;
					transition: opacity 0.2s ease;
				}

				.sign-in-button:hover {
					border-color: rgba(0, 245, 212, 0.3);
					background: rgba(255, 255, 255, 0.05);
					box-shadow:
						0 0 30px rgba(0, 245, 212, 0.1),
						inset 0 1px 0 rgba(255, 255, 255, 0.05);
				}

				.sign-in-button:hover::before {
					opacity: 1;
				}

				.sign-in-button:active {
					transform: scale(0.98);
				}
			`}</style>
		</div>
	);
}
