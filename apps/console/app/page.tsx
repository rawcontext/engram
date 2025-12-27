"use client";

import { AreaChart, Badge, Text, Title } from "@tremor/react";
import {
	Activity,
	AlertTriangle,
	Bell,
	ChevronDown,
	Clock,
	Cpu,
	Database,
	ExternalLink,
	Plus,
	Rocket,
	ScrollText,
	Server,
	Trash2,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { type ServiceHealth, useApiClient } from "@/lib/api-client";
import { MetricsGrid } from "./components/MetricsGrid";
import { ServiceHealthGrid } from "./components/ServiceHealthGrid";

// ============================================
// Types
// ============================================

interface AlertHistoryItem {
	id: string;
	ruleId: string;
	ruleName: string;
	severity: "critical" | "warning" | "info";
	state: "firing" | "resolved";
	triggeredAt: number;
	resolvedAt?: number;
	acknowledged: boolean;
}

interface Deployment {
	id: string;
	status: "success" | "failed" | "in_progress" | "pending" | "cancelled";
	commitHash: string;
	commitMessage: string;
	branch: string;
	environment: "production" | "staging" | "development";
	duration?: number;
	deployedAt: number;
	deployedBy: string;
	version?: string;
}

// ============================================
// Utility Functions
// ============================================

function formatTimeAgo(timestamp: number): string {
	const diff = Date.now() - timestamp;
	if (diff < 60000) return "Just now";
	if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
	if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
	return `${Math.floor(diff / 86400000)}d ago`;
}

function getSeverityColor(severity: "critical" | "warning" | "info"): string {
	switch (severity) {
		case "critical":
			return "--console-red";
		case "warning":
			return "--console-amber";
		case "info":
			return "--console-cyan";
	}
}

function getDeploymentStatusColor(status: string): string {
	switch (status) {
		case "success":
			return "--console-green";
		case "failed":
			return "--console-red";
		case "in_progress":
			return "--console-cyan";
		case "pending":
			return "--console-amber";
		default:
			return "--text-muted";
	}
}

// ============================================
// Alert Banner Component
// ============================================

function AlertBanner({ alerts, isLoading }: { alerts: AlertHistoryItem[]; isLoading: boolean }) {
	const [isExpanded, setIsExpanded] = useState(false);
	const firingAlerts = alerts.filter((a) => a.state === "firing");

	if (isLoading) {
		return (
			<div className="panel p-4 animate-pulse">
				<div className="flex items-center gap-3">
					<div className="w-5 h-5 rounded-full bg-[rgb(var(--console-surface))]" />
					<div className="h-4 w-32 rounded bg-[rgb(var(--console-surface))]" />
				</div>
			</div>
		);
	}

	if (firingAlerts.length === 0) {
		return (
			<div className="panel p-4 border-[rgba(var(--console-green),0.2)]">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="w-8 h-8 rounded-lg bg-[rgba(var(--console-green),0.15)] flex items-center justify-center">
							<Bell className="w-4 h-4 text-[rgb(var(--console-green))]" />
						</div>
						<div>
							<span className="font-mono text-sm text-[rgb(var(--console-green))]">
								No active alerts
							</span>
							<span className="text-xs text-[rgb(var(--text-muted))] ml-2">
								All systems nominal
							</span>
						</div>
					</div>
					<Link
						href="/alerts"
						className="text-xs font-mono text-[rgb(var(--text-muted))] hover:text-[rgb(var(--console-cyan))] transition-colors flex items-center gap-1"
					>
						View history
						<ExternalLink className="w-3 h-3" />
					</Link>
				</div>
			</div>
		);
	}

	const criticalCount = firingAlerts.filter((a) => a.severity === "critical").length;
	const warningCount = firingAlerts.filter((a) => a.severity === "warning").length;

	return (
		<div
			className={`panel overflow-hidden transition-all ${
				criticalCount > 0
					? "ring-1 ring-[rgb(var(--console-red))] border-[rgba(var(--console-red),0.3)]"
					: "ring-1 ring-[rgb(var(--console-amber))] border-[rgba(var(--console-amber),0.3)]"
			}`}
		>
			{/* Header */}
			<button
				type="button"
				onClick={() => setIsExpanded(!isExpanded)}
				className="w-full p-4 flex items-center justify-between hover:bg-[rgba(var(--console-surface),0.3)] transition-colors"
			>
				<div className="flex items-center gap-3">
					<div
						className={`w-8 h-8 rounded-lg flex items-center justify-center ${
							criticalCount > 0
								? "bg-[rgba(var(--console-red),0.2)]"
								: "bg-[rgba(var(--console-amber),0.2)]"
						}`}
					>
						<AlertTriangle
							className={`w-4 h-4 ${
								criticalCount > 0
									? "text-[rgb(var(--console-red))] animate-pulse"
									: "text-[rgb(var(--console-amber))]"
							}`}
						/>
					</div>
					<div className="flex items-center gap-3">
						<span
							className={`font-mono text-sm font-medium ${
								criticalCount > 0
									? "text-[rgb(var(--console-red))]"
									: "text-[rgb(var(--console-amber))]"
							}`}
						>
							{firingAlerts.length} Active Alert{firingAlerts.length !== 1 ? "s" : ""}
						</span>
						<div className="flex items-center gap-2">
							{criticalCount > 0 && (
								<span className="px-2 py-0.5 rounded text-xs font-mono bg-[rgba(var(--console-red),0.2)] text-[rgb(var(--console-red))]">
									{criticalCount} critical
								</span>
							)}
							{warningCount > 0 && (
								<span className="px-2 py-0.5 rounded text-xs font-mono bg-[rgba(var(--console-amber),0.2)] text-[rgb(var(--console-amber))]">
									{warningCount} warning
								</span>
							)}
						</div>
					</div>
				</div>
				<div className="flex items-center gap-3">
					<Link
						href="/alerts"
						onClick={(e) => e.stopPropagation()}
						className="text-xs font-mono text-[rgb(var(--text-muted))] hover:text-[rgb(var(--console-cyan))] transition-colors flex items-center gap-1"
					>
						Manage alerts
						<ExternalLink className="w-3 h-3" />
					</Link>
					<ChevronDown
						className={`w-5 h-5 text-[rgb(var(--text-muted))] transition-transform ${
							isExpanded ? "rotate-180" : ""
						}`}
					/>
				</div>
			</button>

			{/* Expanded Alert List */}
			{isExpanded && (
				<div className="border-t border-[rgba(var(--console-cyan),0.1)]">
					{firingAlerts.slice(0, 5).map((alert) => {
						const severityColor = getSeverityColor(alert.severity);
						return (
							<Link
								key={alert.id}
								href="/alerts"
								className="flex items-center gap-4 px-4 py-3 border-b border-[rgba(var(--console-cyan),0.05)] last:border-b-0 hover:bg-[rgba(var(--console-cyan),0.02)] transition-colors"
							>
								<div
									className="w-2 h-2 rounded-full animate-pulse"
									style={{ background: `rgb(var(${severityColor}))` }}
								/>
								<span
									className="px-2 py-0.5 rounded text-xs font-mono uppercase"
									style={{
										background: `rgba(var(${severityColor}), 0.15)`,
										color: `rgb(var(${severityColor}))`,
									}}
								>
									{alert.severity}
								</span>
								<span className="flex-1 font-mono text-sm text-[rgb(var(--text-primary))] truncate">
									{alert.ruleName}
								</span>
								<span className="text-xs font-mono text-[rgb(var(--text-muted))]">
									{formatTimeAgo(alert.triggeredAt)}
								</span>
							</Link>
						);
					})}
				</div>
			)}
		</div>
	);
}

// ============================================
// Quick Actions Component
// ============================================

const QUICK_ACTIONS = [
	{
		id: "logs",
		label: "View Logs",
		icon: ScrollText,
		href: "/logs",
		color: "--console-cyan",
	},
	{
		id: "deploy",
		label: "Deployments",
		icon: Rocket,
		href: "/deployments",
		color: "--console-purple",
	},
	{
		id: "alerts",
		label: "Add Alert",
		icon: Plus,
		href: "/alerts?action=create",
		color: "--console-amber",
	},
	{
		id: "tools",
		label: "Clear Caches",
		icon: Trash2,
		href: "/tools",
		color: "--console-red",
	},
];

function QuickActions() {
	return (
		<div className="flex items-center gap-2">
			{QUICK_ACTIONS.map((action) => {
				const Icon = action.icon;
				return (
					<Link
						key={action.id}
						href={action.href}
						className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[rgb(var(--console-surface))] border border-[rgba(var(--console-cyan),0.1)] hover:border-[rgba(var(--console-cyan),0.3)] hover:bg-[rgba(var(--console-cyan),0.05)] transition-all group"
					>
						<Icon
							className="w-4 h-4 transition-colors"
							style={{ color: `rgb(var(${action.color}))` }}
						/>
						<span className="font-mono text-xs text-[rgb(var(--text-secondary))] group-hover:text-[rgb(var(--text-primary))] transition-colors">
							{action.label}
						</span>
					</Link>
				);
			})}
		</div>
	);
}

// ============================================
// Activity Feed Component
// ============================================

function ActivityFeed({
	alerts,
	deployments,
	isLoading,
}: {
	alerts: AlertHistoryItem[];
	deployments: Deployment[];
	isLoading: boolean;
}) {
	// Combine and sort activities by time
	const activities = [
		...alerts.slice(0, 3).map((a) => ({
			type: "alert" as const,
			id: a.id,
			title: a.ruleName,
			severity: a.severity,
			state: a.state,
			timestamp: a.triggeredAt,
			href: "/alerts",
		})),
		...deployments.slice(0, 3).map((d) => ({
			type: "deployment" as const,
			id: d.id,
			title: d.commitMessage.slice(0, 50),
			status: d.status,
			environment: d.environment,
			timestamp: d.deployedAt,
			href: "/deployments",
		})),
	].sort((a, b) => b.timestamp - a.timestamp);

	if (isLoading) {
		return (
			<div className="panel p-5">
				<div className="flex items-center gap-2 mb-4">
					<div className="h-4 w-24 rounded bg-[rgb(var(--console-surface))] animate-pulse" />
				</div>
				<div className="space-y-3">
					{[1, 2, 3].map((i) => (
						<div key={i} className="flex items-center gap-3 animate-pulse">
							<div className="w-8 h-8 rounded-lg bg-[rgb(var(--console-surface))]" />
							<div className="flex-1">
								<div className="h-4 w-32 rounded bg-[rgb(var(--console-surface))] mb-1" />
								<div className="h-3 w-20 rounded bg-[rgb(var(--console-surface))]" />
							</div>
						</div>
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="panel p-5">
			<div className="flex items-center justify-between mb-4">
				<Title className="!text-[rgb(var(--text-primary))] !font-display flex items-center gap-2">
					<Zap className="w-4 h-4 text-[rgb(var(--console-amber))]" />
					Activity
				</Title>
			</div>

			<div className="space-y-3">
				{activities.slice(0, 5).map((activity) => {
					if (activity.type === "alert") {
						const severityColor = getSeverityColor(activity.severity);
						const isResolved = activity.state === "resolved";
						return (
							<Link
								key={activity.id}
								href={activity.href}
								className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-[rgb(var(--console-surface))] transition-colors group"
							>
								<div
									className="w-8 h-8 rounded-lg flex items-center justify-center"
									style={{ background: `rgba(var(${severityColor}), 0.15)` }}
								>
									<AlertTriangle
										className="w-4 h-4"
										style={{ color: `rgb(var(${severityColor}))` }}
									/>
								</div>
								<div className="flex-1 min-w-0">
									<div className="font-mono text-sm text-[rgb(var(--text-primary))] truncate">
										{activity.title}
									</div>
									<div className="flex items-center gap-2">
										<span
											className={`text-xs font-mono ${
												isResolved
													? "text-[rgb(var(--console-green))]"
													: `text-[rgb(var(${severityColor}))]`
											}`}
										>
											{isResolved ? "Resolved" : "Firing"}
										</span>
										<span className="text-xs text-[rgb(var(--text-dim))]">•</span>
										<span className="text-xs text-[rgb(var(--text-muted))]">
											{formatTimeAgo(activity.timestamp)}
										</span>
									</div>
								</div>
							</Link>
						);
					}

					const statusColor = getDeploymentStatusColor(activity.status);
					return (
						<Link
							key={activity.id}
							href={activity.href}
							className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-[rgb(var(--console-surface))] transition-colors group"
						>
							<div className="w-8 h-8 rounded-lg bg-[rgba(var(--console-purple),0.15)] flex items-center justify-center">
								<Rocket className="w-4 h-4 text-[rgb(var(--console-purple))]" />
							</div>
							<div className="flex-1 min-w-0">
								<div className="font-mono text-sm text-[rgb(var(--text-primary))] truncate">
									{activity.title}
								</div>
								<div className="flex items-center gap-2">
									<span
										className="text-xs font-mono capitalize"
										style={{ color: `rgb(var(${statusColor}))` }}
									>
										{activity.status.replace("_", " ")}
									</span>
									<span className="text-xs text-[rgb(var(--text-dim))]">•</span>
									<span className="text-xs text-[rgb(var(--text-muted))]">
										{activity.environment}
									</span>
									<span className="text-xs text-[rgb(var(--text-dim))]">•</span>
									<span className="text-xs text-[rgb(var(--text-muted))]">
										{formatTimeAgo(activity.timestamp)}
									</span>
								</div>
							</div>
						</Link>
					);
				})}

				{activities.length === 0 && (
					<div className="text-center py-4">
						<Text className="!text-[rgb(var(--text-muted))]">No recent activity</Text>
					</div>
				)}
			</div>
		</div>
	);
}

// ============================================
// Sparkline Data
// ============================================

const sparklineData = [
	{ time: "00:00", value: 45 },
	{ time: "04:00", value: 52 },
	{ time: "08:00", value: 78 },
	{ time: "12:00", value: 95 },
	{ time: "16:00", value: 88 },
	{ time: "20:00", value: 62 },
	{ time: "24:00", value: 48 },
];

// ============================================
// Main Page Component
// ============================================

export default function OverviewPage() {
	const router = useRouter();
	const apiClient = useApiClient();
	const [alerts, setAlerts] = useState<AlertHistoryItem[]>([]);
	const [deployments, setDeployments] = useState<Deployment[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	// Fetch alerts and deployments
	const fetchActivityData = useCallback(async () => {
		try {
			const [alertsData, deploymentsData] = await Promise.all([
				apiClient.getAlertHistory(10),
				apiClient.getDeployments(),
			]);
			setAlerts(alertsData.alerts);
			setDeployments(deploymentsData);
		} catch {
			// Mock data for demo
			setAlerts([
				{
					id: "alert-1",
					ruleId: "rule-1",
					ruleName: "High Latency",
					severity: "warning",
					state: "firing",
					triggeredAt: Date.now() - 300000,
					acknowledged: false,
				},
				{
					id: "alert-2",
					ruleId: "rule-2",
					ruleName: "Error Rate Spike",
					severity: "critical",
					state: "resolved",
					triggeredAt: Date.now() - 3600000,
					resolvedAt: Date.now() - 1800000,
					acknowledged: true,
				},
			]);
			setDeployments([
				{
					id: "dep-1",
					status: "success",
					commitHash: "abc123",
					commitMessage: "feat: add new search endpoint",
					branch: "main",
					environment: "production",
					duration: 145000,
					deployedAt: Date.now() - 7200000,
					deployedBy: "chris@cheney.dev",
					version: "v1.2.3",
				},
				{
					id: "dep-2",
					status: "in_progress",
					commitHash: "def456",
					commitMessage: "fix: memory leak in aggregator",
					branch: "main",
					environment: "staging",
					deployedAt: Date.now() - 600000,
					deployedBy: "ci@github.com",
				},
			]);
		} finally {
			setIsLoading(false);
		}
	}, [apiClient]);

	useEffect(() => {
		fetchActivityData();
	}, [fetchActivityData]);

	// Poll for updates
	useEffect(() => {
		const interval = setInterval(fetchActivityData, 30000);
		return () => clearInterval(interval);
	}, [fetchActivityData]);

	function handleServiceClick(service: ServiceHealth) {
		router.push(`/services/${service.name.toLowerCase()}`);
	}

	const firingAlerts = alerts.filter((a) => a.state === "firing");

	return (
		<div className="space-y-6 animate-fade-in">
			{/* Alert Banner - Always at top */}
			<AlertBanner alerts={alerts} isLoading={isLoading} />

			{/* Page Header with Quick Actions */}
			<div className="flex items-center justify-between flex-wrap gap-4">
				<div>
					<h1 className="font-display text-2xl text-[rgb(var(--text-primary))]">System Overview</h1>
					<p className="text-sm text-[rgb(var(--text-muted))] mt-1">
						Real-time infrastructure monitoring
					</p>
				</div>
				<div className="flex items-center gap-4">
					<QuickActions />
					<Badge
						color={firingAlerts.length > 0 ? "amber" : "emerald"}
						size="lg"
						className="font-mono"
					>
						{firingAlerts.length > 0
							? `${firingAlerts.length} Alerts Active`
							: "All Systems Operational"}
					</Badge>
				</div>
			</div>

			{/* Key Metrics - Live Data */}
			<MetricsGrid pollInterval={10000} />

			{/* Charts, Resources, and Activity Feed */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				{/* Request Volume Chart */}
				<div className="lg:col-span-2 panel p-5">
					<div className="flex items-center justify-between mb-4">
						<div>
							<Title className="!text-[rgb(var(--text-primary))] !font-display">
								Request Volume
							</Title>
							<Text className="!text-[rgb(var(--text-muted))]">Last 24 hours</Text>
						</div>
						<Badge color="blue" className="font-mono">
							Live
						</Badge>
					</div>
					<AreaChart
						className="h-48"
						data={sparklineData}
						index="time"
						categories={["value"]}
						colors={["cyan"]}
						showLegend={false}
						showGridLines={false}
						showXAxis={true}
						showYAxis={false}
						curveType="natural"
					/>
				</div>

				{/* Activity Feed - Right column */}
				<ActivityFeed alerts={alerts} deployments={deployments} isLoading={isLoading} />
			</div>

			{/* Resources Quick Stats */}
			<div className="panel p-5">
				<Title className="!text-[rgb(var(--text-primary))] !font-display mb-4">Resources</Title>
				<div className="grid grid-cols-2 md:grid-cols-4 gap-6">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<Cpu className="w-4 h-4 text-[rgb(var(--console-cyan))]" />
							<span className="text-sm text-[rgb(var(--text-secondary))]">CPU</span>
						</div>
						<div className="flex items-center gap-2">
							<div className="w-24 h-2 rounded-full bg-[rgb(var(--console-surface))]">
								<div className="w-[34%] h-full rounded-full bg-gradient-to-r from-[rgb(var(--console-cyan))] to-[rgb(var(--console-blue))]" />
							</div>
							<span className="font-mono text-xs text-[rgb(var(--text-muted))]">34%</span>
						</div>
					</div>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<Database className="w-4 h-4 text-[rgb(var(--console-purple))]" />
							<span className="text-sm text-[rgb(var(--text-secondary))]">Memory</span>
						</div>
						<div className="flex items-center gap-2">
							<div className="w-24 h-2 rounded-full bg-[rgb(var(--console-surface))]">
								<div className="w-[67%] h-full rounded-full bg-gradient-to-r from-[rgb(var(--console-purple))] to-[rgb(var(--console-blue))]" />
							</div>
							<span className="font-mono text-xs text-[rgb(var(--text-muted))]">67%</span>
						</div>
					</div>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<Server className="w-4 h-4 text-[rgb(var(--console-green))]" />
							<span className="text-sm text-[rgb(var(--text-secondary))]">Disk</span>
						</div>
						<div className="flex items-center gap-2">
							<div className="w-24 h-2 rounded-full bg-[rgb(var(--console-surface))]">
								<div className="w-[45%] h-full rounded-full bg-gradient-to-r from-[rgb(var(--console-green))] to-[rgb(var(--console-cyan))]" />
							</div>
							<span className="font-mono text-xs text-[rgb(var(--text-muted))]">45%</span>
						</div>
					</div>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<Activity className="w-4 h-4 text-[rgb(var(--console-amber))]" />
							<span className="text-sm text-[rgb(var(--text-secondary))]">Network</span>
						</div>
						<div className="flex items-center gap-2">
							<div className="w-24 h-2 rounded-full bg-[rgb(var(--console-surface))]">
								<div className="w-[23%] h-full rounded-full bg-gradient-to-r from-[rgb(var(--console-amber))] to-[rgb(var(--console-green))]" />
							</div>
							<span className="font-mono text-xs text-[rgb(var(--text-muted))]">23%</span>
						</div>
					</div>
				</div>
			</div>

			{/* Service Health Grid - Live Data */}
			<ServiceHealthGrid onServiceClick={handleServiceClick} pollInterval={5000} />
		</div>
	);
}
