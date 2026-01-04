"use client";

import {
	AlertCircle,
	ArrowDown,
	CircleDollarSign,
	Cpu,
	HardDrive,
	Layers,
	MemoryStick,
	Server,
	Sparkles,
	TrendingDown,
	TrendingUp,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { getHetznerClient, type ServerInfo } from "@/lib/hetzner";

// ============================================
// Types & Constants
// ============================================

interface RerankerCosts {
	tier: "fast" | "accurate" | "code" | "llm";
	requestCount: number;
	costPer1000: number;
	totalCost: number;
}

const RERANKER_TIER_CONFIG: Record<
	RerankerCosts["tier"],
	{ label: string; icon: typeof Zap; color: string; description: string }
> = {
	fast: {
		label: "FlashRank",
		icon: Zap,
		color: "green-500",
		description: "~10ms latency",
	},
	accurate: {
		label: "BGE Cross-Encoder",
		icon: Layers,
		color: "blue-500",
		description: "~50ms latency",
	},
	code: {
		label: "Jina Code",
		icon: Cpu,
		color: "purple-500",
		description: "Code-optimized",
	},
	llm: {
		label: "Gemini Flash",
		icon: Sparkles,
		color: "amber-500",
		description: "LLM inference",
	},
};

// Mock reranker usage data (would come from actual metrics in production)
const MOCK_RERANKER_COSTS: RerankerCosts[] = [
	{ tier: "fast", requestCount: 125000, costPer1000: 0.0, totalCost: 0.0 },
	{ tier: "accurate", requestCount: 45000, costPer1000: 0.02, totalCost: 0.9 },
	{ tier: "code", requestCount: 18000, costPer1000: 0.03, totalCost: 0.54 },
	{ tier: "llm", requestCount: 8500, costPer1000: 0.15, totalCost: 1.28 },
];

// ============================================
// Helper Functions
// ============================================

function formatCurrency(amount: number, currency = "EUR"): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency,
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(amount);
}

function formatNumber(num: number): string {
	if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
	if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
	return num.toString();
}

// ============================================
// Server Cost Card Component
// ============================================

function ServerCostCard({ server }: { server: ServerInfo }) {
	const isRunning = server.status === "running";

	return (
		<Card className="relative overflow-hidden transition-all hover:shadow-lg hover:shadow-primary/5 group">
			{/* Top border accent - color based on cost */}
			<div
				className={`absolute top-0 left-0 right-0 h-0.5 ${
					isRunning ? "bg-gradient-to-r from-green-500/80 to-green-500/20" : "bg-muted-foreground"
				}`}
			/>

			<CardHeader className="pb-2">
				<div className="flex items-start justify-between">
					<div className="flex items-center gap-3">
						<div
							className={`flex h-10 w-10 items-center justify-center rounded-lg transition-transform group-hover:scale-105 ${
								isRunning ? "bg-green-500/10" : "bg-muted"
							}`}
						>
							<Server
								className={`h-5 w-5 ${isRunning ? "text-green-500" : "text-muted-foreground"}`}
							/>
						</div>
						<div>
							<CardTitle className="text-sm font-mono font-medium group-hover:text-primary transition-colors">
								{server.name}
							</CardTitle>
							<p className="text-xs text-muted-foreground">{server.location}</p>
						</div>
					</div>
					<Badge variant="outline" className="font-mono bg-primary/5">
						{server.serverType}
					</Badge>
				</div>
			</CardHeader>

			<CardContent className="space-y-3">
				{/* Specs Grid */}
				<div className="grid grid-cols-3 gap-3">
					<div className="space-y-0.5">
						<div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
							<Cpu className="w-3 h-3" />
							CPU
						</div>
						<div className="font-mono text-sm">
							{server.cores} {server.cpuType === "dedicated" ? "vCPU" : "cores"}
						</div>
					</div>
					<div className="space-y-0.5">
						<div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
							<MemoryStick className="w-3 h-3" />
							RAM
						</div>
						<div className="font-mono text-sm">{server.memory} GB</div>
					</div>
					<div className="space-y-0.5">
						<div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
							<HardDrive className="w-3 h-3" />
							Disk
						</div>
						<div className="font-mono text-sm">{server.disk} GB</div>
					</div>
				</div>

				{/* Cost */}
				<div className="pt-2 border-t flex items-center justify-between">
					<div className="text-[10px] uppercase tracking-wider text-muted-foreground">
						Monthly Cost
					</div>
					{server.monthlyCost ? (
						<div className="text-right">
							<div className="font-mono text-lg font-semibold text-foreground">
								{formatCurrency(server.monthlyCost.gross, server.monthlyCost.currency)}
							</div>
							<div className="text-[10px] text-muted-foreground font-mono">
								{formatCurrency(server.monthlyCost.net, server.monthlyCost.currency)} net
							</div>
						</div>
					) : (
						<span className="text-xs text-muted-foreground font-mono">—</span>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

// ============================================
// Reranker Cost Row Component
// ============================================

function RerankerCostRow({ costs, maxRequests }: { costs: RerankerCosts; maxRequests: number }) {
	const config = RERANKER_TIER_CONFIG[costs.tier];
	const Icon = config.icon;
	const percentage = (costs.requestCount / maxRequests) * 100;

	return (
		<div className="group">
			<div className="flex items-center justify-between mb-1.5">
				<div className="flex items-center gap-2">
					<div
						className={`w-6 h-6 rounded-md flex items-center justify-center bg-${config.color}/10`}
					>
						<Icon className={`w-3.5 h-3.5 text-${config.color}`} />
					</div>
					<div>
						<div className="font-mono text-sm font-medium text-foreground">{config.label}</div>
						<div className="text-[10px] text-muted-foreground">{config.description}</div>
					</div>
				</div>
				<div className="text-right">
					<div className="font-mono text-sm font-semibold text-foreground">
						{costs.totalCost > 0 ? formatCurrency(costs.totalCost, "USD") : "Free"}
					</div>
					<div className="text-[10px] text-muted-foreground font-mono">
						{formatNumber(costs.requestCount)} reqs
					</div>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<Progress value={percentage} className={`h-1.5 flex-1 [&>div]:bg-${config.color}`} />
				<span className="text-[10px] font-mono text-muted-foreground w-16 text-right">
					${costs.costPer1000}/1K
				</span>
			</div>
		</div>
	);
}

// ============================================
// Cost Trend Mini Chart Component
// ============================================

function CostTrendMiniChart({ data, trend }: { data: number[]; trend: "up" | "down" | "stable" }) {
	const max = Math.max(...data);
	const min = Math.min(...data);
	const range = max - min || 1;

	return (
		<div className="flex items-end gap-0.5 h-8">
			{data.map((value, i) => {
				const height = ((value - min) / range) * 100;
				const isLast = i === data.length - 1;
				return (
					<div
						key={`trend-${i}-${value}`}
						className={`w-2 rounded-sm transition-all ${
							isLast
								? trend === "up"
									? "bg-destructive"
									: trend === "down"
										? "bg-green-500"
										: "bg-primary"
								: "bg-muted-foreground/30"
						}`}
						style={{ height: `${Math.max(height, 10)}%` }}
					/>
				);
			})}
		</div>
	);
}

// ============================================
// Skeleton Components
// ============================================

function ServerCostCardSkeleton() {
	return (
		<Card>
			<CardHeader className="pb-2">
				<div className="flex items-start justify-between">
					<div className="flex items-center gap-3">
						<Skeleton className="h-10 w-10 rounded-lg" />
						<div className="space-y-2">
							<Skeleton className="h-4 w-24" />
							<Skeleton className="h-3 w-20" />
						</div>
					</div>
					<Skeleton className="h-5 w-16" />
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="grid grid-cols-3 gap-3">
					{Array.from({ length: 3 }).map((_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items
						<div key={i} className="space-y-1">
							<Skeleton className="h-3 w-10" />
							<Skeleton className="h-4 w-12" />
						</div>
					))}
				</div>
				<div className="pt-2 border-t flex items-center justify-between">
					<Skeleton className="h-3 w-20" />
					<Skeleton className="h-6 w-16" />
				</div>
			</CardContent>
		</Card>
	);
}

function RerankerCostSkeleton() {
	return (
		<div className="space-y-4">
			{Array.from({ length: 4 }).map((_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items
				<div key={i} className="space-y-2">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Skeleton className="w-6 h-6 rounded-md" />
							<div className="space-y-1">
								<Skeleton className="h-4 w-24" />
								<Skeleton className="h-3 w-16" />
							</div>
						</div>
						<Skeleton className="h-4 w-16" />
					</div>
					<Skeleton className="h-1.5 w-full" />
				</div>
			))}
		</div>
	);
}

// ============================================
// Main Component
// ============================================

export interface CostTrackingProps {
	pollInterval?: number;
	showHeader?: boolean;
}

export function CostTracking({ pollInterval = 60000, showHeader = true }: CostTrackingProps) {
	const [servers, setServers] = useState<ServerInfo[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

	// Mock trend data (would come from historical metrics)
	const monthlyTrend = useMemo(() => [42, 45, 43, 48, 52, 49], []);
	const trendDirection = useMemo(() => {
		if (monthlyTrend.length < 2) return "stable" as const;
		const last = monthlyTrend[monthlyTrend.length - 1];
		const prev = monthlyTrend[monthlyTrend.length - 2];
		if (last > prev * 1.05) return "up" as const;
		if (last < prev * 0.95) return "down" as const;
		return "stable" as const;
	}, [monthlyTrend]);

	const fetchServers = useCallback(async (initial = false) => {
		if (initial) setIsLoading(true);
		try {
			const hetzner = getHetznerClient();
			const serverList = await hetzner.listServers();

			// Fetch server info with costs in parallel
			const serversWithCosts = await Promise.all(
				serverList.map((s) => hetzner.getServerInfo(s.id)),
			);

			setServers(serversWithCosts);
			setError(null);
			setLastUpdate(new Date());
		} catch (err) {
			console.error("Failed to fetch server costs:", err);
			setError(err instanceof Error ? err.message : "Failed to connect to Hetzner");
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchServers(true);
	}, [fetchServers]);

	useEffect(() => {
		if (pollInterval <= 0) return;
		const interval = setInterval(() => fetchServers(false), pollInterval);
		return () => clearInterval(interval);
	}, [fetchServers, pollInterval]);

	// Calculate totals
	const totalInfraCost = useMemo(
		() => servers.reduce((sum, s) => sum + (s.monthlyCost?.gross ?? 0), 0),
		[servers],
	);

	const totalRerankerCost = useMemo(
		() => MOCK_RERANKER_COSTS.reduce((sum, r) => sum + r.totalCost, 0),
		[],
	);

	const totalRequests = useMemo(
		() => MOCK_RERANKER_COSTS.reduce((sum, r) => sum + r.requestCount, 0),
		[],
	);

	const maxRerankerRequests = useMemo(
		() => Math.max(...MOCK_RERANKER_COSTS.map((r) => r.requestCount)),
		[],
	);

	const costPer1000Requests = useMemo(() => {
		if (totalRequests === 0) return 0;
		return ((totalInfraCost + totalRerankerCost) / totalRequests) * 1000;
	}, [totalInfraCost, totalRerankerCost, totalRequests]);

	if (error && isLoading) {
		return (
			<Card>
				{showHeader && (
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<CircleDollarSign className="w-5 h-5 text-primary" />
							Cost Tracking
						</CardTitle>
					</CardHeader>
				)}
				<CardContent>
					<div className="flex flex-col items-center justify-center py-12 text-center">
						<AlertCircle className="h-12 w-12 text-destructive mb-4" />
						<p className="text-sm text-muted-foreground mb-4">{error}</p>
						<Button variant="outline" size="sm" onClick={() => fetchServers(true)}>
							Retry
						</Button>
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			{showHeader && (
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-500 to-primary flex items-center justify-center shadow-lg shadow-green-500/20">
							<CircleDollarSign className="w-5 h-5 text-background" />
						</div>
						<div>
							<h2 className="font-display text-xl text-foreground">Cost Tracking</h2>
							<p className="text-sm text-muted-foreground">Infrastructure and API costs</p>
						</div>
					</div>
					{lastUpdate && (
						<span className="text-[10px] text-muted-foreground font-mono">
							{lastUpdate.toLocaleTimeString()}
						</span>
					)}
				</div>
			)}

			{/* Summary Cards */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				{/* Total Monthly Cost */}
				<Card className="relative overflow-hidden">
					<div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/80 to-primary/20" />
					<CardContent className="pt-4">
						<div className="flex items-start justify-between">
							<div>
								<div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
									Total Monthly
								</div>
								{isLoading ? (
									<Skeleton className="h-8 w-24" />
								) : (
									<div className="font-mono text-2xl font-bold text-foreground">
										{formatCurrency(totalInfraCost + totalRerankerCost, "EUR")}
									</div>
								)}
								<div className="flex items-center gap-1 mt-1">
									{trendDirection === "up" ? (
										<>
											<TrendingUp className="w-3 h-3 text-destructive" />
											<span className="text-[10px] text-destructive font-mono">+6.1%</span>
										</>
									) : trendDirection === "down" ? (
										<>
											<TrendingDown className="w-3 h-3 text-green-500" />
											<span className="text-[10px] text-green-500 font-mono">-3.2%</span>
										</>
									) : (
										<span className="text-[10px] text-muted-foreground font-mono">No change</span>
									)}
									<span className="text-[10px] text-muted-foreground">vs last month</span>
								</div>
							</div>
							<CostTrendMiniChart data={monthlyTrend} trend={trendDirection} />
						</div>
					</CardContent>
				</Card>

				{/* Infrastructure Cost */}
				<Card className="relative overflow-hidden">
					<div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500/80 to-blue-500/20" />
					<CardContent className="pt-4">
						<div className="flex items-start justify-between">
							<div>
								<div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
									<Server className="w-3 h-3" />
									Infrastructure
								</div>
								{isLoading ? (
									<Skeleton className="h-8 w-20" />
								) : (
									<div className="font-mono text-2xl font-bold text-foreground">
										{formatCurrency(totalInfraCost, "EUR")}
									</div>
								)}
								<div className="text-[10px] text-muted-foreground mt-1">
									{servers.length} server{servers.length !== 1 ? "s" : ""}
								</div>
							</div>
							<div className="flex flex-col items-end gap-1">
								{servers.slice(0, 3).map((s) => (
									<Badge key={s.id} variant="outline" className="text-[10px] font-mono px-1.5 py-0">
										{s.name}
									</Badge>
								))}
								{servers.length > 3 && (
									<span className="text-[10px] text-muted-foreground">
										+{servers.length - 3} more
									</span>
								)}
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Cost per 1K Requests */}
				<Card className="relative overflow-hidden">
					<div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-green-500/80 to-green-500/20" />
					<CardContent className="pt-4">
						<div className="flex items-start justify-between">
							<div>
								<div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
									<Zap className="w-3 h-3" />
									Cost / 1K Requests
								</div>
								{isLoading ? (
									<Skeleton className="h-8 w-16" />
								) : (
									<div className="font-mono text-2xl font-bold text-green-500">
										{formatCurrency(costPer1000Requests, "EUR")}
									</div>
								)}
								<div className="text-[10px] text-muted-foreground mt-1">
									{formatNumber(totalRequests)} total requests
								</div>
							</div>
							<div className="flex items-center gap-1 text-green-500">
								<ArrowDown className="w-4 h-4" />
								<span className="font-mono text-sm font-semibold">12%</span>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Detailed Breakdown */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Server Costs */}
				<div className="space-y-4">
					<div className="flex items-center gap-2">
						<Server className="h-4 w-4 text-primary" />
						<span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
							Server Breakdown
						</span>
						<div className="flex-1 h-px bg-border" />
					</div>

					{isLoading ? (
						<div className="grid gap-4">
							{Array.from({ length: 2 }).map((_, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items
								<ServerCostCardSkeleton key={i} />
							))}
						</div>
					) : servers.length === 0 ? (
						<Card>
							<CardContent className="py-8 text-center">
								<Server className="w-12 h-12 mx-auto opacity-30 mb-3" />
								<p className="text-sm text-muted-foreground">No servers found</p>
							</CardContent>
						</Card>
					) : (
						<div className="grid gap-4">
							{servers.map((server) => (
								<ServerCostCard key={server.id} server={server} />
							))}
						</div>
					)}
				</div>

				{/* Reranker API Costs */}
				<div className="space-y-4">
					<div className="flex items-center gap-2">
						<Layers className="h-4 w-4 text-primary" />
						<span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
							Reranker API Costs
						</span>
						<div className="flex-1 h-px bg-border" />
					</div>

					<Card>
						<CardHeader className="pb-2">
							<div className="flex items-center justify-between">
								<CardTitle className="text-sm font-medium">This Month</CardTitle>
								<div className="text-right">
									<div className="font-mono text-lg font-semibold text-foreground">
										{formatCurrency(totalRerankerCost, "USD")}
									</div>
									<div className="text-[10px] text-muted-foreground">
										{formatNumber(totalRequests)} requests
									</div>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-4">
							{isLoading ? (
								<RerankerCostSkeleton />
							) : (
								MOCK_RERANKER_COSTS.map((costs) => (
									<RerankerCostRow
										key={costs.tier}
										costs={costs}
										maxRequests={maxRerankerRequests}
									/>
								))
							)}

							{/* Usage breakdown footer */}
							<div className="pt-3 border-t">
								<div className="flex items-center justify-between text-[10px]">
									<span className="text-muted-foreground uppercase tracking-wider">
										Avg Cost/Request
									</span>
									<span className="font-mono text-foreground">
										${totalRequests > 0 ? (totalRerankerCost / totalRequests).toFixed(6) : "0.00"}
									</span>
								</div>
								<div className="flex items-center justify-between text-[10px] mt-1">
									<span className="text-muted-foreground uppercase tracking-wider">
										Free Tier Usage
									</span>
									<span className="font-mono text-green-500">
										{formatNumber(MOCK_RERANKER_COSTS[0].requestCount)} reqs
									</span>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* Cost Optimization Tips */}
					<Card className="bg-primary/[0.02] border-primary/10">
						<CardContent className="py-4">
							<div className="flex items-start gap-3">
								<div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
									<ArrowDown className="w-4 h-4 text-green-500" />
								</div>
								<div>
									<div className="font-mono text-sm font-medium text-foreground mb-1">
										Optimization Tip
									</div>
									<p className="text-xs text-muted-foreground">
										Route simple queries to FlashRank (free) and reserve LLM reranking for complex
										semantic matches. Current LLM usage is 4.3% of requests.
									</p>
								</div>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
