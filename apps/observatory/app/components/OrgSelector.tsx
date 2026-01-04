"use client";

import { useSession } from "@lib/auth-client";
import { useCallback, useEffect, useRef, useState } from "react";

interface Organization {
	id: string;
	slug: string;
	name: string;
	createdAt: string;
	updatedAt: string;
}

const ORG_STORAGE_KEY = "engram-selected-org";

/**
 * Organization selector dropdown for admin users.
 * Allows switching between tenants when viewing data.
 *
 * Only visible to users with admin role.
 */
export function OrgSelector() {
	const { data: session, isPending } = useSession();
	const [isOpen, setIsOpen] = useState(false);
	const [orgs, setOrgs] = useState<Organization[]>([]);
	const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	// Check if user is admin
	// Note: role is added via additionalFields in auth.ts but not reflected in client types
	const userRole = (session?.user as { role?: string } | undefined)?.role;
	const isAdmin = userRole === "admin";

	// Load selected org from localStorage on mount
	useEffect(() => {
		if (typeof window === "undefined") return;
		try {
			const saved = localStorage.getItem(ORG_STORAGE_KEY);
			if (saved) {
				setSelectedOrg(JSON.parse(saved));
			}
		} catch {
			// Ignore parse errors
		}
	}, []);

	// Fetch organizations when admin is logged in
	useEffect(() => {
		if (!isAdmin) {
			setIsLoading(false);
			return;
		}

		const fetchOrgs = async () => {
			try {
				setIsLoading(true);
				setError(null);
				const response = await fetch("/api/orgs?all=true");
				if (!response.ok) {
					throw new Error("Failed to fetch organizations");
				}
				const data = await response.json();
				setOrgs(data.data?.organizations || []);

				// If no org selected and we have orgs, select first one
				if (!selectedOrg && data.data?.organizations?.length > 0) {
					const firstOrg = data.data.organizations[0];
					setSelectedOrg(firstOrg);
					localStorage.setItem(ORG_STORAGE_KEY, JSON.stringify(firstOrg));
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to load organizations");
			} finally {
				setIsLoading(false);
			}
		};

		fetchOrgs();
	}, [isAdmin, selectedOrg]);

	// Close dropdown on outside click
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	const handleSelect = useCallback((org: Organization) => {
		setSelectedOrg(org);
		setIsOpen(false);
		localStorage.setItem(ORG_STORAGE_KEY, JSON.stringify(org));
		// Dispatch custom event for other components to listen to
		window.dispatchEvent(new CustomEvent("org-changed", { detail: org }));
	}, []);

	// Don't render for non-admins
	if (!isAdmin || isPending) {
		return null;
	}

	// Loading state
	if (isLoading) {
		return (
			<div className="org-selector-skeleton">
				<div className="skeleton-box" />
				<style jsx>{`
					.org-selector-skeleton {
						display: flex;
						align-items: center;
					}
					.skeleton-box {
						width: 120px;
						height: 32px;
						border-radius: 6px;
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

	// Error state
	if (error) {
		return (
			<div className="org-selector-error" title={error}>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="#f87171"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<circle cx="12" cy="12" r="10" />
					<line x1="12" y1="8" x2="12" y2="12" />
					<line x1="12" y1="16" x2="12.01" y2="16" />
				</svg>
				<style jsx>{`
					.org-selector-error {
						display: flex;
						align-items: center;
						padding: 0.5rem;
						opacity: 0.7;
					}
				`}</style>
			</div>
		);
	}

	// No orgs available
	if (orgs.length === 0) {
		return null;
	}

	return (
		<div className="org-selector" ref={menuRef}>
			<button
				className="org-button"
				onClick={() => setIsOpen(!isOpen)}
				type="button"
				aria-expanded={isOpen}
				aria-haspopup="listbox"
			>
				<svg
					className="org-icon"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
					<polyline points="9,22 9,12 15,12 15,22" />
				</svg>
				<span className="org-name">{selectedOrg?.name || "Select Org"}</span>
				<svg
					className={`chevron ${isOpen ? "open" : ""}`}
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<polyline points="6,9 12,15 18,9" />
				</svg>
			</button>

			{isOpen && (
				<div className="dropdown" role="listbox">
					<div className="dropdown-header">
						<span className="header-label">Switch Organization</span>
						<span className="header-badge">{orgs.length}</span>
					</div>
					<div className="dropdown-divider" />
					<div className="dropdown-list">
						{orgs.map((org) => (
							<button
								key={org.id}
								className={`dropdown-item ${selectedOrg?.id === org.id ? "selected" : ""}`}
								onClick={() => handleSelect(org)}
								type="button"
								role="option"
								aria-selected={selectedOrg?.id === org.id}
							>
								<div className="org-info">
									<span className="item-name">{org.name}</span>
									<span className="item-slug">{org.slug}</span>
								</div>
								{selectedOrg?.id === org.id && (
									<svg
										className="check-icon"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<polyline points="20,6 9,17 4,12" />
									</svg>
								)}
							</button>
						))}
					</div>
				</div>
			)}

			<style jsx>{`
				@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&display=swap");

				.org-selector {
					position: relative;
					font-family: "IBM Plex Sans", sans-serif;
				}

				.org-button {
					display: flex;
					align-items: center;
					gap: 0.5rem;
					padding: 0.5rem 0.75rem;
					background: linear-gradient(
						135deg,
						rgba(251, 191, 36, 0.1),
						rgba(245, 158, 11, 0.05)
					);
					border: 1px solid rgba(251, 191, 36, 0.25);
					border-radius: 6px;
					color: #fbbf24;
					font-size: 0.8125rem;
					font-weight: 500;
					cursor: pointer;
					transition: all 0.15s ease;
				}

				.org-button:hover {
					background: linear-gradient(
						135deg,
						rgba(251, 191, 36, 0.15),
						rgba(245, 158, 11, 0.1)
					);
					border-color: rgba(251, 191, 36, 0.35);
				}

				.org-button:focus {
					outline: none;
					border-color: rgba(251, 191, 36, 0.5);
					box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.1);
				}

				.org-icon {
					width: 16px;
					height: 16px;
					opacity: 0.8;
				}

				.org-name {
					max-width: 120px;
					overflow: hidden;
					text-overflow: ellipsis;
					white-space: nowrap;
				}

				.chevron {
					width: 14px;
					height: 14px;
					opacity: 0.6;
					transition: transform 0.15s ease;
				}

				.chevron.open {
					transform: rotate(180deg);
				}

				.dropdown {
					position: absolute;
					top: calc(100% + 8px);
					right: 0;
					min-width: 220px;
					max-width: 280px;
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
					display: flex;
					align-items: center;
					justify-content: space-between;
					padding: 0.75rem 1rem;
				}

				.header-label {
					font-size: 0.75rem;
					font-weight: 500;
					color: #64748b;
					text-transform: uppercase;
					letter-spacing: 0.05em;
				}

				.header-badge {
					padding: 0.125rem 0.5rem;
					background: rgba(251, 191, 36, 0.15);
					border-radius: 10px;
					font-size: 0.6875rem;
					font-weight: 500;
					color: #fbbf24;
				}

				.dropdown-divider {
					height: 1px;
					background: rgba(255, 255, 255, 0.06);
				}

				.dropdown-list {
					max-height: 280px;
					overflow-y: auto;
					padding: 0.25rem 0;
				}

				.dropdown-list::-webkit-scrollbar {
					width: 6px;
				}

				.dropdown-list::-webkit-scrollbar-track {
					background: transparent;
				}

				.dropdown-list::-webkit-scrollbar-thumb {
					background: rgba(255, 255, 255, 0.1);
					border-radius: 3px;
				}

				.dropdown-item {
					display: flex;
					align-items: center;
					justify-content: space-between;
					width: 100%;
					padding: 0.625rem 1rem;
					background: transparent;
					border: none;
					color: #94a3b8;
					font-family: inherit;
					font-size: 0.8125rem;
					text-align: left;
					cursor: pointer;
					transition: all 0.1s ease;
				}

				.dropdown-item:hover {
					background: rgba(255, 255, 255, 0.03);
					color: #f1f5f9;
				}

				.dropdown-item.selected {
					background: rgba(251, 191, 36, 0.08);
					color: #fbbf24;
				}

				.org-info {
					display: flex;
					flex-direction: column;
					gap: 0.125rem;
					min-width: 0;
					flex: 1;
				}

				.item-name {
					font-weight: 500;
					overflow: hidden;
					text-overflow: ellipsis;
					white-space: nowrap;
				}

				.item-slug {
					font-size: 0.6875rem;
					color: #64748b;
					overflow: hidden;
					text-overflow: ellipsis;
					white-space: nowrap;
				}

				.dropdown-item.selected .item-slug {
					color: rgba(251, 191, 36, 0.6);
				}

				.check-icon {
					width: 16px;
					height: 16px;
					flex-shrink: 0;
					margin-left: 0.5rem;
				}
			`}</style>
		</div>
	);
}

/**
 * Hook to get the currently selected organization.
 * Returns null if no org is selected or user is not admin.
 */
export function useSelectedOrg(): Organization | null {
	const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);

	useEffect(() => {
		// Load from localStorage on mount
		if (typeof window === "undefined") return;
		try {
			const saved = localStorage.getItem(ORG_STORAGE_KEY);
			if (saved) {
				setSelectedOrg(JSON.parse(saved));
			}
		} catch {
			// Ignore parse errors
		}

		// Listen for org changes
		const handleOrgChange = (event: CustomEvent<Organization>) => {
			setSelectedOrg(event.detail);
		};

		window.addEventListener("org-changed", handleOrgChange as EventListener);
		return () => {
			window.removeEventListener("org-changed", handleOrgChange as EventListener);
		};
	}, []);

	return selectedOrg;
}
