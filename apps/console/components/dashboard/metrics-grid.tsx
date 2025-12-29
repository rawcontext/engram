"use client";

import { Activity, AlertCircle, ArrowDownRight, ArrowUpRight, Clock, Zap } from "lucide-react";
import { useEffect, useRef } from "react";
import { Area, AreaChart } from "recharts";

import { DataFreshness, StreamingDot } from "@/components/streaming";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { usePollingData } from "@/hooks/useStreamingData";
import { type MetricData, useApiClient } from "@/lib/api-client";
import { useRegisterStreamingSource } from "@/lib/streaming-context";

const METRIC_ICONS: Record<string, typeof Zap> = {
	requests: Zap,
	errors: AlertCircle,
	latency: Clock,
	sessions: Activity,
};

const METRIC_CHART_COLORS: Record<string, string> = {
	requests: "var(--chart-1)",
	errors: "var(--destructive)",
	latency: "var(--chart-3)",
	sessions: "var(--chart-5)",
};

function isPositiveChange(metricId: string, change: number): boolean {
	if (metricId === "errors" || metricId === "latency") {
		return change <= 0;
	}
	return change >= 0;
}

function formatValue(value: number, unit?: string): string {
	if (value >= 1000000) {
		return `${(value / 1000000).toFixed(1)}M${unit || ""}`;
	}
	if (value >= 1000) {
		return `${(value / 1000).toFixed(1)}k${unit || ""}`;
	}
	if (value < 1 && value > 0) {
		return `${value.toFixed(2)}${unit || ""}`;
	}
	return `${Math.round(value)}${unit || ""}`;
}

function formatChange(change: number, unit?: string): string {
	const prefix = change >= 0 ? "+" : "";
	if (Math.abs(change) < 1 && Math.abs(change) > 0) {
		return `${prefix}${change.toFixed(2)}${unit || ""}`;
	}
	return `${prefix}${change.toFixed(1)}${unit || ""}`;
}

interface MetricCardProps {
	metric: MetricData;
	isLoading: boolean;
	previousValue?: number;
}

function MetricCard({ metric, isLoading, previousValue }: MetricCardProps) {
	const Icon = METRIC_ICONS[metric.id] || Zap;
	const chartColor = METRIC_CHART_COLORS[metric.id] || "var(--chart-1)";
	const isPositive = isPositiveChange(metric.id, metric.change);

	// Detect if value just changed
	const valueChanged = previousValue !== undefined && previousValue !== metric.value;

	const chartData = metric.sparkline.map((point, idx) => ({
		index: idx,
		value: point.value,
	}));

	const chartConfig = {
		value: {
			color: chartColor,
		},
	};

	return (
		<Card className="relative overflow-hidden transition-all hover:shadow-lg hover:shadow-primary/5 group">
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<div className="flex items-center gap-2">
					<div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
						<Icon className="h-4 w-4 text-primary" />
					</div>
					<CardTitle className="text-sm font-medium text-muted-foreground">
						{metric.title}
					</CardTitle>
				</div>
				<Badge variant={isPositive ? "default" : "destructive"} className="font-mono text-xs">
					<span className="flex items-center gap-0.5">
						{isPositive ? (
							<ArrowUpRight className="h-3 w-3" />
						) : (
							<ArrowDownRight className="h-3 w-3" />
						)}
						{formatChange(metric.change, metric.changeUnit)}
					</span>
				</Badge>
			</CardHeader>
			<CardContent>
				<div
					className={`text-2xl font-bold font-mono tabular-nums transition-all duration-300 ${
						valueChanged ? "text-primary" : ""
					}`}
				>
					{isLoading ? <Skeleton className="h-8 w-24" /> : formatValue(metric.value, metric.unit)}
				</div>
				<div className="absolute bottom-2 right-2 h-10 w-24 opacity-50 transition-opacity group-hover:opacity-80">
					<ChartContainer config={chartConfig} className="h-full w-full">
						<AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
							<defs>
								<linearGradient id={`gradient-${metric.id}`} x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor={chartColor} stopOpacity={0.3} />
									<stop offset="100%" stopColor={chartColor} stopOpacity={0} />
								</linearGradient>
							</defs>
							<Area
								type="monotone"
								dataKey="value"
								stroke={chartColor}
								strokeWidth={1.5}
								fill={`url(#gradient-${metric.id})`}
							/>
						</AreaChart>
					</ChartContainer>
				</div>
			</CardContent>
		</Card>
	);
}

function MetricCardSkeleton() {
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<div className="flex items-center gap-2">
					<Skeleton className="h-8 w-8 rounded-md" />
					<Skeleton className="h-4 w-20" />
				</div>
				<Skeleton className="h-5 w-16" />
			</CardHeader>
			<CardContent>
				<Skeleton className="h-8 w-28" />
			</CardContent>
		</Card>
	);
}

export interface MetricsGridProps {
	pollInterval?: number;
}

export function MetricsGrid({ pollInterval = 10000 }: MetricsGridProps) {
	const apiClient = useApiClient();
	const prevMetricsRef = useRef<Map<string, number>>(new Map());

	// Use streaming data hook for automatic status tracking
	const {
		data: metrics,
		status,
		lastUpdate,
	} = usePollingData<MetricData[]>(() => apiClient.getSystemMetrics(), {
		pollInterval,
		staleThreshold: 30,
	});

	// Register this component as a streaming source
	useRegisterStreamingSource("metrics-grid", "System Metrics", status, lastUpdate);

	// Track previous values for change detection
	useEffect(() => {
		if (metrics) {
			const newMap = new Map<string, number>();
			for (const m of metrics) {
				newMap.set(m.id, m.value);
			}
			prevMetricsRef.current = newMap;
		}
	}, [metrics]);

	const isLoading = !metrics && status === "connecting";

	if (isLoading) {
		return (
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
				{Array.from({ length: 4 }).map((_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items
					<MetricCardSkeleton key={i} />
				))}
			</div>
		);
	}

	return (
		<DataFreshness
			status={status}
			lastUpdate={lastUpdate}
			flashColor="cyan"
			showStaleOverlay={true}
		>
			<div className="relative">
				{/* Streaming indicator in corner */}
				<div className="absolute -top-1 -right-1 z-10">
					<StreamingDot status={status} size="sm" />
				</div>

				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
					{(metrics || []).map((metric) => (
						<MetricCard
							key={metric.id}
							metric={metric}
							isLoading={false}
							previousValue={prevMetricsRef.current.get(metric.id)}
						/>
					))}
				</div>
			</div>
		</DataFreshness>
	);
}
