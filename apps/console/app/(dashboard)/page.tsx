"use client";

import {
	AlertTriangle,
	Bell,
	ChevronDown,
	ExternalLink,
	Plus,
	Rocket,
	ScrollText,
	Trash2,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { MetricsGrid } from "@/components/dashboard/metrics-grid";
import { ServiceHealthGrid } from "@/components/dashboard/service-health-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { type ServiceHealth, useApiClient } from "@/lib/api-client";

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

function getSeverityVariant(severity: "critical" | "warning" | "info") {
	switch (severity) {
		case "critical":
			return "destructive";
		case "warning":
			return "secondary";
		case "info":
			return "default";
	}
}

function getDeploymentStatusVariant(status: string) {
	switch (status) {
		case "success":
			return "default";
		case "failed":
			return "destructive";
		case "in_progress":
			return "secondary";
		case "pending":
			return "outline";
		default:
			return "outline";
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
			<Card>
				<CardContent className="p-4">
					<div className="flex items-center gap-3">
						<Skeleton className="h-5 w-5 rounded-full" />
						<Skeleton className="h-4 w-32" />
					</div>
				</CardContent>
			</Card>
		);
	}

	if (firingAlerts.length === 0) {
		return (
			<Card className="border-green-500/20">
				<CardContent className="p-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/15">
								<Bell className="h-4 w-4 text-green-500" />
							</div>
							<div>
								<span className="font-mono text-sm text-green-500">No active alerts</span>
								<span className="text-xs text-muted-foreground ml-2">All systems nominal</span>
							</div>
						</div>
						<Link
							href="/alerts"
							className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
						>
							View history
							<ExternalLink className="h-3 w-3" />
						</Link>
					</div>
				</CardContent>
			</Card>
		);
	}

	const criticalCount = firingAlerts.filter((a) => a.severity === "critical").length;
	const warningCount = firingAlerts.filter((a) => a.severity === "warning").length;

	return (
		<Card
			className={`overflow-hidden ${
				criticalCount > 0
					? "ring-1 ring-destructive border-destructive/30"
					: "ring-1 ring-amber-500 border-amber-500/30"
			}`}
		>
			<Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="w-full p-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
					>
						<div className="flex items-center gap-3">
							<div
								className={`flex h-8 w-8 items-center justify-center rounded-lg ${
									criticalCount > 0 ? "bg-destructive/20" : "bg-amber-500/20"
								}`}
							>
								<AlertTriangle
									className={`h-4 w-4 ${
										criticalCount > 0 ? "text-destructive animate-pulse" : "text-amber-500"
									}`}
								/>
							</div>
							<div className="flex items-center gap-3">
								<span
									className={`font-mono text-sm font-medium ${
										criticalCount > 0 ? "text-destructive" : "text-amber-500"
									}`}
								>
									{firingAlerts.length} Active Alert{firingAlerts.length !== 1 ? "s" : ""}
								</span>
								<div className="flex items-center gap-2">
									{criticalCount > 0 && (
										<Badge variant="destructive" className="font-mono text-xs">
											{criticalCount} critical
										</Badge>
									)}
									{warningCount > 0 && (
										<Badge
											variant="secondary"
											className="font-mono text-xs bg-amber-500/10 text-amber-500"
										>
											{warningCount} warning
										</Badge>
									)}
								</div>
							</div>
						</div>
						<div className="flex items-center gap-3">
							<Link
								href="/alerts"
								onClick={(e) => e.stopPropagation()}
								className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
							>
								Manage alerts
								<ExternalLink className="h-3 w-3" />
							</Link>
							<ChevronDown
								className={`h-5 w-5 text-muted-foreground transition-transform ${
									isExpanded ? "rotate-180" : ""
								}`}
							/>
						</div>
					</button>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<div className="border-t">
						{firingAlerts.slice(0, 5).map((alert) => (
							<Link
								key={alert.id}
								href="/alerts"
								className="flex items-center gap-4 px-4 py-3 border-b last:border-b-0 hover:bg-muted/30 transition-colors"
							>
								<div
									className={`h-2 w-2 rounded-full animate-pulse ${
										alert.severity === "critical"
											? "bg-destructive"
											: alert.severity === "warning"
												? "bg-amber-500"
												: "bg-primary"
									}`}
								/>
								<Badge variant={getSeverityVariant(alert.severity)} className="font-mono text-xs">
									{alert.severity}
								</Badge>
								<span className="flex-1 font-mono text-sm truncate">{alert.ruleName}</span>
								<span className="text-xs font-mono text-muted-foreground">
									{formatTimeAgo(alert.triggeredAt)}
								</span>
							</Link>
						))}
					</div>
				</CollapsibleContent>
			</Collapsible>
		</Card>
	);
}

// ============================================
// Quick Actions Component
// ============================================

const QUICK_ACTIONS = [
	{ id: "logs", label: "View Logs", icon: ScrollText, href: "/logs" },
	{ id: "deploy", label: "Deployments", icon: Rocket, href: "/deployments" },
	{ id: "alerts", label: "Add Alert", icon: Plus, href: "/alerts?action=create" },
	{ id: "tools", label: "Clear Caches", icon: Trash2, href: "/tools" },
];

function QuickActions() {
	return (
		<div className="flex items-center gap-2">
			{QUICK_ACTIONS.map((action) => {
				const Icon = action.icon;
				return (
					<Button key={action.id} variant="outline" size="sm" asChild className="gap-2">
						<Link href={action.href}>
							<Icon className="h-4 w-4" />
							<span className="font-mono text-xs">{action.label}</span>
						</Link>
					</Button>
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
			<Card>
				<CardHeader>
					<Skeleton className="h-4 w-24" />
				</CardHeader>
				<CardContent className="space-y-3">
					{[1, 2, 3].map((i) => (
						<div key={i} className="flex items-center gap-3">
							<Skeleton className="h-8 w-8 rounded-lg" />
							<div className="flex-1">
								<Skeleton className="h-4 w-32 mb-1" />
								<Skeleton className="h-3 w-20" />
							</div>
						</div>
					))}
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="text-base flex items-center gap-2">
					<Zap className="h-4 w-4 text-amber-500" />
					Activity
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				{activities.slice(0, 5).map((activity) => {
					if (activity.type === "alert") {
						const isResolved = activity.state === "resolved";
						return (
							<Link
								key={activity.id}
								href={activity.href}
								className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-muted/50 transition-colors group"
							>
								<div
									className={`flex h-8 w-8 items-center justify-center rounded-lg ${
										activity.severity === "critical"
											? "bg-destructive/15"
											: activity.severity === "warning"
												? "bg-amber-500/15"
												: "bg-primary/15"
									}`}
								>
									<AlertTriangle
										className={`h-4 w-4 ${
											activity.severity === "critical"
												? "text-destructive"
												: activity.severity === "warning"
													? "text-amber-500"
													: "text-primary"
										}`}
									/>
								</div>
								<div className="flex-1 min-w-0">
									<div className="font-mono text-sm truncate">{activity.title}</div>
									<div className="flex items-center gap-2 text-xs">
										<span className={isResolved ? "text-green-500" : "text-muted-foreground"}>
											{isResolved ? "Resolved" : "Firing"}
										</span>
										<span className="text-muted-foreground">•</span>
										<span className="text-muted-foreground">
											{formatTimeAgo(activity.timestamp)}
										</span>
									</div>
								</div>
							</Link>
						);
					}

					return (
						<Link
							key={activity.id}
							href={activity.href}
							className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-muted/50 transition-colors group"
						>
							<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet/15">
								<Rocket className="h-4 w-4 text-violet" />
							</div>
							<div className="flex-1 min-w-0">
								<div className="font-mono text-sm truncate">{activity.title}</div>
								<div className="flex items-center gap-2 text-xs">
									<Badge
										variant={getDeploymentStatusVariant(activity.status)}
										className="font-mono text-[10px] h-4"
									>
										{activity.status.replace("_", " ")}
									</Badge>
									<span className="text-muted-foreground">{activity.environment}</span>
									<span className="text-muted-foreground">•</span>
									<span className="text-muted-foreground">{formatTimeAgo(activity.timestamp)}</span>
								</div>
							</div>
						</Link>
					);
				})}

				{activities.length === 0 && (
					<div className="text-center py-4">
						<p className="text-sm text-muted-foreground">No recent activity</p>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

// ============================================
// Main Page Component
// ============================================

export default function OverviewPage() {
	const [mounted, setMounted] = useState(false);
	const router = useRouter();
	const apiClient = useApiClient();
	const [alerts, setAlerts] = useState<AlertHistoryItem[]>([]);
	const [deployments, setDeployments] = useState<Deployment[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	const fetchActivityData = useCallback(async () => {
		try {
			const [alertsData, deploymentsData] = await Promise.all([
				apiClient.getAlertHistory(10),
				apiClient.getDeployments(),
			]);
			setAlerts(alertsData.alerts);
			setDeployments(deploymentsData);
		} catch (err) {
			console.error("Failed to fetch activity data:", err);
		} finally {
			setIsLoading(false);
		}
	}, [apiClient]);

	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		if (mounted) {
			fetchActivityData();
		}
	}, [mounted, fetchActivityData]);

	useEffect(() => {
		if (!mounted) return;
		const interval = setInterval(fetchActivityData, 30000);
		return () => clearInterval(interval);
	}, [mounted, fetchActivityData]);

	// Return null during SSR to prevent hydration mismatch
	if (!mounted) {
		return null;
	}

	function handleServiceClick(service: ServiceHealth) {
		router.push(`/services/${service.name.toLowerCase()}`);
	}

	const firingAlerts = alerts.filter((a) => a.state === "firing");

	return (
		<div className="space-y-6">
			{/* Alert Banner */}
			<AlertBanner alerts={alerts} isLoading={isLoading} />

			{/* Page Header with Quick Actions */}
			<div className="flex items-center justify-between flex-wrap gap-4">
				<div>
					<h1 className="text-2xl font-semibold">System Overview</h1>
					<p className="text-sm text-muted-foreground mt-1">Real-time infrastructure monitoring</p>
				</div>
				<div className="flex items-center gap-4">
					<QuickActions />
					<Badge
						variant={firingAlerts.length > 0 ? "secondary" : "default"}
						className={`font-mono ${
							firingAlerts.length > 0
								? "bg-amber-500/10 text-amber-500"
								: "bg-green-500/10 text-green-500"
						}`}
					>
						{firingAlerts.length > 0
							? `${firingAlerts.length} Alerts Active`
							: "All Systems Operational"}
					</Badge>
				</div>
			</div>

			{/* Key Metrics */}
			<MetricsGrid pollInterval={10000} />

			{/* Activity Feed */}
			<ActivityFeed alerts={alerts} deployments={deployments} isLoading={isLoading} />

			{/* Service Health Grid */}
			<ServiceHealthGrid onServiceClick={handleServiceClick} pollInterval={5000} />
		</div>
	);
}
