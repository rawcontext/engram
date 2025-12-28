"use client";

import { signOut, useSession } from "@lib/auth-client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export function UserMenu() {
	const { data: session, isPending } = useSession();
	const [isOpen, setIsOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	const handleSignOut = async () => {
		await signOut();
		window.location.href = "/sign-in";
	};

	if (isPending) {
		return (
			<div className="user-menu-skeleton">
				<div className="skeleton-avatar" />
				<style jsx>{`
					.user-menu-skeleton {
						display: flex;
						align-items: center;
					}
					.skeleton-avatar {
						width: 32px;
						height: 32px;
						border-radius: 50%;
						background: linear-gradient(
							90deg,
							rgba(255, 255, 255, 0.05) 25%,
							rgba(255, 255, 255, 0.1) 50%,
							rgba(255, 255, 255, 0.05) 75%
						);
						background-size: 200% 100%;
						animation: shimmer 1.5s infinite;
					}
					@keyframes shimmer {
						0% {
							background-position: 200% 0;
						}
						100% {
							background-position: -200% 0;
						}
					}
				`}</style>
			</div>
		);
	}

	if (!session) {
		return (
			<a
				href="/sign-in"
				style={{
					display: "flex",
					alignItems: "center",
					gap: "0.5rem",
					padding: "0.5rem 1rem",
					background: "linear-gradient(135deg, rgba(0, 245, 212, 0.1), rgba(56, 189, 248, 0.1))",
					border: "1px solid rgba(0, 245, 212, 0.2)",
					borderRadius: "6px",
					color: "#00f5d4",
					fontSize: "0.875rem",
					fontWeight: 500,
					textDecoration: "none",
					transition: "all 0.15s ease",
				}}
				onMouseOver={(e) => {
					e.currentTarget.style.background =
						"linear-gradient(135deg, rgba(0, 245, 212, 0.2), rgba(56, 189, 248, 0.2))";
					e.currentTarget.style.borderColor = "rgba(0, 245, 212, 0.3)";
				}}
				onFocus={(e) => {
					e.currentTarget.style.background =
						"linear-gradient(135deg, rgba(0, 245, 212, 0.2), rgba(56, 189, 248, 0.2))";
					e.currentTarget.style.borderColor = "rgba(0, 245, 212, 0.3)";
				}}
				onMouseOut={(e) => {
					e.currentTarget.style.background =
						"linear-gradient(135deg, rgba(0, 245, 212, 0.1), rgba(56, 189, 248, 0.1))";
					e.currentTarget.style.borderColor = "rgba(0, 245, 212, 0.2)";
				}}
				onBlur={(e) => {
					e.currentTarget.style.background =
						"linear-gradient(135deg, rgba(0, 245, 212, 0.1), rgba(56, 189, 248, 0.1))";
					e.currentTarget.style.borderColor = "rgba(0, 245, 212, 0.2)";
				}}
			>
				Sign in
			</a>
		);
	}

	const user = session.user;
	const initials = user.name
		? user.name
				.split(" ")
				.map((n) => n[0])
				.join("")
				.toUpperCase()
				.slice(0, 2)
		: user.email?.[0]?.toUpperCase() || "?";

	return (
		<div className="user-menu" ref={menuRef}>
			<button
				className="user-button"
				onClick={() => setIsOpen(!isOpen)}
				type="button"
				aria-expanded={isOpen}
				aria-haspopup="true"
			>
				{user.image ? (
					<Image
						src={user.image}
						alt={user.name || "User"}
						className="avatar"
						width={32}
						height={32}
						style={{ borderRadius: "50%" }}
					/>
				) : (
					<div className="avatar-fallback">{initials}</div>
				)}
			</button>

			{isOpen && (
				<div className="dropdown">
					<div className="dropdown-header">
						<div className="user-info">
							<span className="user-name">{user.name || "User"}</span>
							<span className="user-email">{user.email}</span>
						</div>
					</div>
					<div className="dropdown-divider" />
					<a className="dropdown-item" href="/keys">
						<svg
							className="item-icon"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
						</svg>
						API Keys
					</a>
					<a className="dropdown-item" href="/tokens">
						<svg
							className="item-icon"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
							<path d="M7 11V7a5 5 0 0 1 10 0v4" />
						</svg>
						OAuth Sessions
					</a>
					<div className="dropdown-divider" />
					<a
						className="dropdown-item"
						href={process.env.NEXT_PUBLIC_CONSOLE_URL || "http://localhost:6185"}
						target="_blank"
						rel="noopener noreferrer"
					>
						<svg
							className="item-icon"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
							<line x1="8" y1="21" x2="16" y2="21" />
							<line x1="12" y1="17" x2="12" y2="21" />
						</svg>
						Console
					</a>
					<div className="dropdown-divider" />
					<button className="dropdown-item sign-out" onClick={handleSignOut} type="button">
						<svg
							className="item-icon"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
							<polyline points="16,17 21,12 16,7" />
							<line x1="21" y1="12" x2="9" y2="12" />
						</svg>
						Sign out
					</button>
				</div>
			)}

			<style jsx>{`
				@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&display=swap");

				.user-menu {
					position: relative;
					font-family: "IBM Plex Sans", sans-serif;
				}

				.user-button {
					display: flex;
					align-items: center;
					justify-content: center;
					padding: 0;
					background: transparent;
					border: 2px solid transparent;
					border-radius: 50%;
					cursor: pointer;
					transition: all 0.15s ease;
				}

				.user-button:hover {
					border-color: rgba(56, 189, 248, 0.3);
				}

				.user-button:focus {
					outline: none;
					border-color: rgba(56, 189, 248, 0.5);
				}

				.avatar {
					width: 32px;
					height: 32px;
					border-radius: 50%;
					object-fit: cover;
				}

				.avatar-fallback {
					width: 32px;
					height: 32px;
					border-radius: 50%;
					background: linear-gradient(135deg, #1e3a5f 0%, #0c1929 100%);
					border: 1px solid rgba(56, 189, 248, 0.2);
					display: flex;
					align-items: center;
					justify-content: center;
					font-size: 0.75rem;
					font-weight: 500;
					color: #38bdf8;
					letter-spacing: 0.02em;
				}

				.dropdown {
					position: absolute;
					top: calc(100% + 8px);
					right: 0;
					min-width: 220px;
					background: #0f1319;
					border: 1px solid rgba(255, 255, 255, 0.08);
					border-radius: 8px;
					box-shadow:
						0 4px 24px rgba(0, 0, 0, 0.4),
						0 0 0 1px rgba(255, 255, 255, 0.02);
					overflow: hidden;
					animation: dropdown-in 0.15s ease-out;
					z-index: 100;
				}

				@keyframes dropdown-in {
					from {
						opacity: 0;
						transform: translateY(-4px) scale(0.95);
					}
					to {
						opacity: 1;
						transform: translateY(0) scale(1);
					}
				}

				.dropdown-header {
					padding: 0.875rem 1rem;
				}

				.user-info {
					display: flex;
					flex-direction: column;
					gap: 0.125rem;
				}

				.user-name {
					font-size: 0.875rem;
					font-weight: 500;
					color: #f1f5f9;
				}

				.user-email {
					font-size: 0.75rem;
					color: #64748b;
				}

				.dropdown-divider {
					height: 1px;
					background: rgba(255, 255, 255, 0.06);
					margin: 0;
				}

				.dropdown-item {
					display: flex;
					align-items: center;
					gap: 0.625rem;
					width: 100%;
					padding: 0.75rem 1rem;
					background: transparent;
					border: none;
					color: #94a3b8;
					font-family: inherit;
					font-size: 0.8125rem;
					font-weight: 400;
					text-align: left;
					cursor: pointer;
					transition: all 0.1s ease;
				}

				.dropdown-item:hover {
					background: rgba(255, 255, 255, 0.03);
					color: #f1f5f9;
				}

				.dropdown-item.sign-out:hover {
					color: #f87171;
				}

				.item-icon {
					width: 16px;
					height: 16px;
					opacity: 0.7;
				}
			`}</style>
		</div>
	);
}
