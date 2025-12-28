"use client";

import { SparkAreaChart } from "@tremor/react";
import { Activity, AlertCircle, ArrowDownRight, ArrowUpRight, Clock, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type MetricData, useApiClient } from "@/lib/api-client";

const METRIC_ICONS: Record<string, typeof Zap> = {
	requests: Zap,
	errors: AlertCircle,
	latency: Clock,
	sessions: Activity,
};

const METRIC_COLORS: Record<string, string> = {
	requests: "--console-cyan",
	errors: "--console-red",
	latency: "--console-amber",
	sessions: "--console-purple",
};

// Determine if the change is positive for this metric type
function isPositiveChange(metricId: string, change: number): boolean {
	// For error rate and latency, negative change is good
	if (metricId === "errors" || metricId === "latency") {
		return change <= 0;
	}
	// For requests and sessions, positive change is good
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
}

function MetricCard({ metric, isLoading }: MetricCardProps) {
	const Icon = METRIC_ICONS[metric.id] || Zap;
	const colorVar = METRIC_COLORS[metric.id] || "--console-cyan";
	const isPositive = isPositiveChange(metric.id, metric.change);

	// Transform sparkline data for Tremor chart
	const chartData = metric.sparkline.map((point, idx) => ({
		index: idx,
		value: point.value,
	}));

	return (
		<div className="panel p-5 hover-lift group relative overflow-hidden">
			{/* Subtle background glow on hover */}
			<div
				className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none`}
				style={{
					background: `radial-gradient(ellipse at bottom right, rgba(var(${colorVar}), 0.05) 0%, transparent 70%)`,
				}}
			/>

			{/* Header: Icon + Change Badge */}
			<div className="flex items-start justify-between mb-3 relative">
				<div
					className="w-10 h-10 rounded-lg flex items-center justify-center transition-transform group-hover:scale-105"
					style={{ background: `rgba(var(${colorVar}), 0.1)` }}
				>
					<Icon className="w-5 h-5" style={{ color: `rgb(var(${colorVar}))` }} />
				</div>
				<div
					className={`flex items-center gap-1 text-sm font-mono ${
						isPositive ? "text-[rgb(var(--console-green))]" : "text-[rgb(var(--console-red))]"
					}`}
				>
					{isPositive ? (
						<ArrowUpRight className="w-4 h-4" />
					) : (
						<ArrowDownRight className="w-4 h-4" />
					)}
					{formatChange(metric.change, metric.changeUnit)}
				</div>
			</div>

			{/* Value */}
			<div className="metric-value relative">
				{isLoading ? (
					<div className="h-8 w-24 rounded bg-[rgb(var(--console-surface))] animate-pulse" />
				) : (
					formatValue(metric.value, metric.unit)
				)}
			</div>

			{/* Label */}
			<div className="metric-label mt-1">{metric.title}</div>

			{/* Sparkline - positioned at bottom right */}
			<div className="absolute bottom-3 right-3 w-20 h-8 opacity-40 group-hover:opacity-70 transition-opacity">
				<SparkAreaChart
					data={chartData}
					categories={["value"]}
					index="index"
					colors={[metric.id === "errors" ? "red" : metric.id === "latency" ? "amber" : "cyan"]}
					className="h-8 w-full"
					curveType="natural"
				/>
			</div>
		</div>
	);
}

function SkeletonCard() {
	return (
		<div className="panel p-5 animate-pulse">
			<div className="flex items-start justify-between mb-3">
				<div className="w-10 h-10 rounded-lg bg-[rgb(var(--console-surface))]" />
				<div className="h-5 w-16 rounded bg-[rgb(var(--console-surface))]" />
			</div>
			<div className="h-8 w-28 rounded bg-[rgb(var(--console-surface))] mb-2" />
			<div className="h-4 w-20 rounded bg-[rgb(var(--console-surface))]" />
		</div>
	);
}

export interface MetricsGridProps {
	/** Polling interval in milliseconds. Default: 10000 */
	pollInterval?: number;
}

export function MetricsGrid({ pollInterval = 10000 }: MetricsGridProps) {
	const apiClient = useApiClient();
	const [metrics, setMetrics] = useState<MetricData[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isRefreshing, setIsRefreshing] = useState(false);

	const fetchMetrics = useCallback(
		async (isInitial = false) => {
			if (isInitial) {
				setIsLoading(true);
			} else {
				setIsRefreshing(true);
			}

			try {
				const data = await apiClient.getSystemMetrics();
				setMetrics(data);
			} catch (err) {
				console.error("Failed to fetch metrics:", err);
			} finally {
				setIsLoading(false);
				setIsRefreshing(false);
			}
		},
		[apiClient],
	);

	// Initial fetch
	useEffect(() => {
		fetchMetrics(true);
	}, [fetchMetrics]);

	// Polling
	useEffect(() => {
		if (pollInterval <= 0) return;

		const interval = setInterval(() => fetchMetrics(false), pollInterval);
		return () => clearInterval(interval);
	}, [fetchMetrics, pollInterval]);

	if (isLoading) {
		return (
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
				{Array.from({ length: 4 }).map((_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton items
					<SkeletonCard key={i} />
				))}
			</div>
		);
	}

	return (
		<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 stagger">
			{metrics.map((metric) => (
				<MetricCard key={metric.id} metric={metric} isLoading={isRefreshing} />
			))}
		</div>
	);
}
