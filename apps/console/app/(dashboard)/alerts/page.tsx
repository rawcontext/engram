// biome-ignore-all lint/a11y/noLabelWithoutControl: using custom Select components
"use client";

import {
	AlertTriangle,
	Bell,
	BellOff,
	Check,
	CheckCircle2,
	ChevronDown,
	Clock,
	Edit3,
	ExternalLink,
	Loader2,
	Mail,
	MessageSquare,
	Plus,
	Send,
	Shield,
	Trash2,
	Webhook,
	X,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApiClient } from "@/lib/api-client";

// ============================================
// Types
// ============================================

interface AlertRule {
	id: string;
	name: string;
	metric: string;
	condition: "greater_than" | "less_than" | "equals";
	threshold: number;
	duration: number;
	severity: "critical" | "warning" | "info";
	enabled: boolean;
	status: "active" | "triggered" | "muted";
	channels: string[];
	lastTriggered?: number;
}

interface NotificationChannel {
	id: string;
	name: string;
	type: "slack" | "email" | "webhook" | "pagerduty";
	config: Record<string, string>;
	verified: boolean;
	createdAt: number;
}

interface AlertHistoryItem {
	id: string;
	ruleId: string;
	ruleName: string;
	severity: "critical" | "warning" | "info";
	state: "firing" | "resolved";
	triggeredAt: number;
	resolvedAt?: number;
	acknowledged: boolean;
	acknowledgedBy?: string;
}

type Metric = "latency" | "error_rate" | "memory" | "cpu" | "queue_depth";
type Condition = "greater_than" | "less_than" | "equals";
type Severity = "critical" | "warning" | "info";
type ChannelType = "slack" | "email" | "webhook" | "pagerduty";

// ============================================
// Constants
// ============================================

const METRICS: { value: Metric; label: string; unit: string }[] = [
	{ value: "latency", label: "Latency", unit: "ms" },
	{ value: "error_rate", label: "Error Rate", unit: "%" },
	{ value: "memory", label: "Memory Usage", unit: "%" },
	{ value: "cpu", label: "CPU Usage", unit: "%" },
	{ value: "queue_depth", label: "Queue Depth", unit: "msgs" },
];

const CONDITIONS: { value: Condition; label: string; symbol: string }[] = [
	{ value: "greater_than", label: "Greater than", symbol: ">" },
	{ value: "less_than", label: "Less than", symbol: "<" },
	{ value: "equals", label: "Equals", symbol: "=" },
];

const SEVERITIES: { value: Severity; label: string; color: string }[] = [
	{ value: "critical", label: "Critical", color: "--destructive" },
	{ value: "warning", label: "Warning", color: "--warning" },
	{ value: "info", label: "Info", color: "--primary" },
];

const CHANNEL_TYPES: { value: ChannelType; label: string; icon: typeof Mail }[] = [
	{ value: "slack", label: "Slack", icon: MessageSquare },
	{ value: "email", label: "Email", icon: Mail },
	{ value: "webhook", label: "Webhook", icon: Webhook },
	{ value: "pagerduty", label: "PagerDuty", icon: Zap },
];

const DURATIONS = [
	{ value: 60, label: "1 minute" },
	{ value: 300, label: "5 minutes" },
	{ value: 600, label: "10 minutes" },
	{ value: 900, label: "15 minutes" },
	{ value: 1800, label: "30 minutes" },
];

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

function formatDuration(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m`;
}

function getSeverityColor(severity: Severity): string {
	switch (severity) {
		case "critical":
			return "--destructive";
		case "warning":
			return "--warning";
		case "info":
			return "--primary";
	}
}

function getStatusColor(status: string): string {
	switch (status) {
		case "triggered":
		case "firing":
			return "--destructive";
		case "resolved":
			return "--success";
		case "muted":
			return "--muted-foreground";
		default:
			return "--success";
	}
}

// ============================================
// Custom Select Component
// ============================================

function Select<T extends string>({
	value,
	options,
	onChange,
	label,
	placeholder,
}: {
	value: T | "";
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
	label?: string;
	placeholder?: string;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const selected = options.find((o) => o.value === value);

	return (
		<div className="relative">
			{label && <label className="metric-label block mb-2">{label}</label>}
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				className="w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-secondary border border-primary/15 hover:border-primary/30 transition-colors font-mono text-sm text-foreground"
			>
				<span className={selected ? "" : "text-muted-foreground"}>
					{selected?.label || placeholder || "Select..."}
				</span>
				<ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
			</button>

			{isOpen && (
				<>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: overlay dismissal */}
					<div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
					<div className="absolute left-0 right-0 top-full mt-2 z-20 py-1 rounded-lg bg-card border border-primary/20 shadow-xl shadow-black/30 max-h-48 overflow-auto">
						{options.map((option) => (
							<button
								type="button"
								key={option.value}
								onClick={() => {
									onChange(option.value);
									setIsOpen(false);
								}}
								className={`w-full px-4 py-2 text-left text-sm font-mono transition-colors ${
									option.value === value
										? "text-primary bg-primary/10"
										: "text-muted-foreground hover:text-foreground hover:bg-secondary"
								}`}
							>
								{option.label}
							</button>
						))}
					</div>
				</>
			)}
		</div>
	);
}

// ============================================
// Multi-Select Component
// ============================================

function MultiSelect({
	values,
	options,
	onChange,
	label,
	placeholder,
}: {
	values: string[];
	options: { value: string; label: string }[];
	onChange: (values: string[]) => void;
	label?: string;
	placeholder?: string;
}) {
	const [isOpen, setIsOpen] = useState(false);

	const toggle = (value: string) => {
		if (values.includes(value)) {
			onChange(values.filter((v) => v !== value));
		} else {
			onChange([...values, value]);
		}
	};

	return (
		<div className="relative">
			{label && <label className="metric-label block mb-2">{label}</label>}
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				className="w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-secondary border border-primary/15 hover:border-primary/30 transition-colors text-left"
			>
				{values.length > 0 ? (
					<div className="flex flex-wrap gap-1">
						{values.map((v) => {
							const opt = options.find((o) => o.value === v);
							return (
								<span
									key={v}
									className="px-2 py-0.5 rounded text-xs font-mono bg-primary/15 text-primary"
								>
									{opt?.label || v}
								</span>
							);
						})}
					</div>
				) : (
					<span className="text-sm text-muted-foreground">{placeholder || "Select..."}</span>
				)}
				<ChevronDown
					className={`w-4 h-4 flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
				/>
			</button>

			{isOpen && (
				<>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: overlay dismissal */}
					<div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
					<div className="absolute left-0 right-0 top-full mt-2 z-20 py-1 rounded-lg bg-card border border-primary/20 shadow-xl shadow-black/30 max-h-48 overflow-auto">
						{options.map((option) => (
							<button
								type="button"
								key={option.value}
								onClick={() => toggle(option.value)}
								className="w-full px-4 py-2 text-left text-sm font-mono transition-colors flex items-center gap-3 text-muted-foreground hover:text-foreground hover:bg-secondary"
							>
								<div
									className={`w-4 h-4 rounded border flex items-center justify-center ${
										values.includes(option.value)
											? "border-primary bg-primary"
											: "border-muted-foreground"
									}`}
								>
									{values.includes(option.value) && (
										<Check className="w-3 h-3 text-primary-foreground" />
									)}
								</div>
								{option.label}
							</button>
						))}
					</div>
				</>
			)}
		</div>
	);
}

// ============================================
// Toggle Switch Component
// ============================================

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
	return (
		<button
			type="button"
			onClick={() => onChange(!enabled)}
			className={`relative w-11 h-6 rounded-full transition-colors ${
				enabled ? "bg-primary" : "bg-secondary"
			}`}
		>
			<div
				className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
					enabled ? "translate-x-6" : "translate-x-1"
				}`}
			/>
		</button>
	);
}

// ============================================
// Modal Component
// ============================================

function Modal({
	isOpen,
	onClose,
	title,
	children,
}: {
	isOpen: boolean;
	onClose: () => void;
	title: string;
	children: React.ReactNode;
}) {
	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop */}
			<div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
			<div className="relative panel p-6 max-w-lg w-full max-h-[85vh] overflow-auto animate-fade-in">
				{/* Header */}
				<div className="flex items-center justify-between mb-6">
					<h3 className="font-display text-lg text-foreground">{title}</h3>
					<button
						type="button"
						onClick={onClose}
						className="p-2 rounded-lg hover:bg-secondary transition-colors"
					>
						<X className="w-5 h-5 text-muted-foreground" />
					</button>
				</div>
				{children}
			</div>
		</div>
	);
}

// ============================================
// Alert Rule Card Component
// ============================================

function AlertRuleCard({
	rule,
	channels,
	onEdit,
	onDelete,
	onToggle,
}: {
	rule: AlertRule;
	channels: NotificationChannel[];
	onEdit: () => void;
	onDelete: () => void;
	onToggle: (enabled: boolean) => void;
}) {
	const severityColor = getSeverityColor(rule.severity);
	const statusColor = getStatusColor(rule.status);
	const metric = METRICS.find((m) => m.value === rule.metric);
	const condition = CONDITIONS.find((c) => c.value === rule.condition);

	return (
		<div
			className={`panel p-4 hover-lift group transition-all ${
				rule.status === "triggered" ? "ring-1 ring-destructive" : ""
			}`}
		>
			{/* Header row */}
			<div className="flex items-start justify-between mb-3">
				<div className="flex items-center gap-3">
					{/* Status indicator */}
					<div
						className={`w-2.5 h-2.5 rounded-full ${
							rule.status === "triggered" ? "animate-pulse" : ""
						}`}
						style={{ background: `var(${statusColor})` }}
					/>
					<div>
						<h4 className="font-mono text-sm font-medium text-foreground">{rule.name}</h4>
						<div className="flex items-center gap-2 mt-1">
							<span
								className="px-2 py-0.5 rounded text-xs font-mono uppercase"
								style={{
									background: `color-mix(in oklch, var(${severityColor}) 15%, transparent)`,
									color: `var(${severityColor})`,
								}}
							>
								{rule.severity}
							</span>
							<span className="text-xs text-muted-foreground font-mono uppercase">
								{rule.status}
							</span>
						</div>
					</div>
				</div>

				{/* Actions */}
				<div className="flex items-center gap-2">
					<Toggle enabled={rule.enabled} onChange={onToggle} />
				</div>
			</div>

			{/* Condition display */}
			<div className="p-3 rounded-lg bg-secondary mb-3 font-mono text-sm">
				<span className="text-primary">{metric?.label}</span>
				<span className="text-muted-foreground mx-2">{condition?.symbol}</span>
				<span className="text-warning">
					{rule.threshold}
					{metric?.unit}
				</span>
				<span className="text-muted-foreground mx-2">for</span>
				<span className="text-violet">{formatDuration(rule.duration)}</span>
			</div>

			{/* Channels */}
			<div className="flex items-center gap-2 mb-3">
				<span className="text-xs text-muted-foreground">Notify:</span>
				<div className="flex flex-wrap gap-1">
					{rule.channels.map((channelId) => {
						const channel = channels.find((c) => c.id === channelId);
						const ChannelIcon = CHANNEL_TYPES.find((t) => t.value === channel?.type)?.icon || Bell;
						return (
							<span
								key={channelId}
								className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-secondary text-muted-foreground"
							>
								<ChannelIcon className="w-3 h-3" />
								{channel?.name || channelId}
							</span>
						);
					})}
				</div>
			</div>

			{/* Footer */}
			<div className="flex items-center justify-between pt-3 border-t border-primary/10">
				<span className="text-xs text-muted-foreground font-mono">
					{rule.lastTriggered
						? `Last triggered ${formatTimeAgo(rule.lastTriggered)}`
						: "Never triggered"}
				</span>
				<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
					<button
						type="button"
						onClick={onEdit}
						className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-primary transition-colors"
					>
						<Edit3 className="w-4 h-4" />
					</button>
					<button
						type="button"
						onClick={onDelete}
						className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-destructive transition-colors"
					>
						<Trash2 className="w-4 h-4" />
					</button>
				</div>
			</div>
		</div>
	);
}

// ============================================
// Notification Channel Card Component
// ============================================

function ChannelCard({
	channel,
	onTest,
	onDelete,
	isTesting,
}: {
	channel: NotificationChannel;
	onTest: () => void;
	onDelete: () => void;
	isTesting: boolean;
}) {
	const typeInfo = CHANNEL_TYPES.find((t) => t.value === channel.type);
	const Icon = typeInfo?.icon || Bell;

	return (
		<div className="p-4 rounded-lg bg-secondary border border-primary/10 hover:border-primary/20 transition-colors group">
			<div className="flex items-start justify-between">
				<div className="flex items-center gap-3">
					<div className="w-9 h-9 rounded-lg bg-violet/10 flex items-center justify-center">
						<Icon className="w-4 h-4 text-violet" />
					</div>
					<div>
						<div className="font-mono text-sm text-foreground">{channel.name}</div>
						<div className="flex items-center gap-2 mt-1">
							<span className="text-xs text-muted-foreground uppercase">{channel.type}</span>
							{channel.verified && (
								<span className="flex items-center gap-1 text-xs text-success">
									<CheckCircle2 className="w-3 h-3" />
									Verified
								</span>
							)}
						</div>
					</div>
				</div>

				<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
					<button
						type="button"
						onClick={onTest}
						disabled={isTesting}
						className="p-2 rounded-lg hover:bg-card text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
					>
						{isTesting ? (
							<Loader2 className="w-4 h-4 animate-spin" />
						) : (
							<Send className="w-4 h-4" />
						)}
					</button>
					<button
						type="button"
						onClick={onDelete}
						className="p-2 rounded-lg hover:bg-card text-muted-foreground hover:text-destructive transition-colors"
					>
						<Trash2 className="w-4 h-4" />
					</button>
				</div>
			</div>

			{/* Config preview */}
			<div className="mt-3 text-xs font-mono text-muted-foreground truncate">
				{channel.type === "email" && channel.config.emails}
				{channel.type === "slack" && `#${channel.config.channel}`}
				{channel.type === "webhook" && channel.config.url}
				{channel.type === "pagerduty" && `Key: ${channel.config.routingKey?.slice(0, 12)}...`}
			</div>
		</div>
	);
}

// ============================================
// Alert History Row Component
// ============================================

function AlertHistoryRow({
	alert,
	onAcknowledge,
}: {
	alert: AlertHistoryItem;
	onAcknowledge: () => void;
}) {
	const severityColor = getSeverityColor(alert.severity);
	const stateColor = getStatusColor(alert.state);

	return (
		<div className="flex items-center gap-4 px-4 py-3 border-b border-primary/5 hover:bg-primary/5 transition-colors">
			{/* State indicator */}
			<div
				className={`w-2 h-2 rounded-full flex-shrink-0 ${alert.state === "firing" ? "animate-pulse" : ""}`}
				style={{ background: `var(${stateColor})` }}
			/>

			{/* Timestamp */}
			<div className="w-28 flex-shrink-0">
				<div className="font-mono text-xs text-muted-foreground">
					{new Date(alert.triggeredAt).toLocaleTimeString()}
				</div>
				<div className="font-mono text-[10px] text-muted-foreground/60">
					{new Date(alert.triggeredAt).toLocaleDateString()}
				</div>
			</div>

			{/* Rule name */}
			<div className="flex-1 min-w-0">
				<div className="font-mono text-sm text-foreground truncate">{alert.ruleName}</div>
			</div>

			{/* Severity */}
			<span
				className="px-2 py-1 rounded text-xs font-mono uppercase flex-shrink-0"
				style={{
					background: `color-mix(in oklch, var(${severityColor}) 15%, transparent)`,
					color: `var(${severityColor})`,
				}}
			>
				{alert.severity}
			</span>

			{/* State */}
			<span
				className="w-20 text-center px-2 py-1 rounded text-xs font-mono uppercase flex-shrink-0"
				style={{
					background: `color-mix(in oklch, var(${stateColor}) 15%, transparent)`,
					color: `var(${stateColor})`,
				}}
			>
				{alert.state}
			</span>

			{/* Actions */}
			<div className="w-24 flex-shrink-0 flex justify-end">
				{alert.state === "firing" && !alert.acknowledged && (
					<button
						type="button"
						onClick={onAcknowledge}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-warning/10 text-warning hover:bg-warning/20 transition-colors"
					>
						<Check className="w-3.5 h-3.5" />
						Ack
					</button>
				)}
				{alert.acknowledged && (
					<span className="flex items-center gap-1 text-xs text-success">
						<CheckCircle2 className="w-3.5 h-3.5" />
						Ack'd
					</span>
				)}
			</div>
		</div>
	);
}

// ============================================
// Alert Rule Form Modal
// ============================================

function AlertRuleModal({
	isOpen,
	onClose,
	onSave,
	channels,
	editingRule,
}: {
	isOpen: boolean;
	onClose: () => void;
	onSave: (rule: Omit<AlertRule, "id" | "enabled" | "status" | "lastTriggered">) => void;
	channels: NotificationChannel[];
	editingRule?: AlertRule;
}) {
	const [name, setName] = useState(editingRule?.name || "");
	const [metric, setMetric] = useState<Metric | "">((editingRule?.metric as Metric) || "");
	const [condition, setCondition] = useState<Condition | "">(editingRule?.condition || "");
	const [threshold, setThreshold] = useState(editingRule?.threshold?.toString() || "");
	const [duration, setDuration] = useState(editingRule?.duration || 300);
	const [severity, setSeverity] = useState<Severity>(editingRule?.severity || "warning");
	const [selectedChannels, setSelectedChannels] = useState<string[]>(editingRule?.channels || []);
	const [isSaving, setIsSaving] = useState(false);

	const handleSave = async () => {
		if (!name || !metric || !condition || !threshold) return;

		setIsSaving(true);
		await onSave({
			name,
			metric,
			condition,
			threshold: Number.parseFloat(threshold),
			duration,
			severity,
			channels: selectedChannels,
		});
		setIsSaving(false);
		onClose();
	};

	const selectedMetric = METRICS.find((m) => m.value === metric);

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title={editingRule ? "Edit Alert Rule" : "Create Alert Rule"}
		>
			<div className="space-y-5">
				{/* Name */}
				<div>
					<label className="metric-label block mb-2">Rule Name</label>
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="e.g., High Latency Alert"
						className="w-full px-4 py-2.5 rounded-lg bg-secondary border border-primary/15 focus:border-primary/40 focus:outline-none font-mono text-sm text-foreground placeholder:text-muted-foreground/60"
					/>
				</div>

				{/* Metric & Condition */}
				<div className="grid grid-cols-2 gap-4">
					<Select
						value={metric}
						options={METRICS}
						onChange={setMetric}
						label="Metric"
						placeholder="Select metric..."
					/>
					<Select
						value={condition}
						options={CONDITIONS}
						onChange={setCondition}
						label="Condition"
						placeholder="Select..."
					/>
				</div>

				{/* Threshold & Duration */}
				<div className="grid grid-cols-2 gap-4">
					<div>
						<label className="metric-label block mb-2">Threshold</label>
						<div className="relative">
							<input
								type="number"
								value={threshold}
								onChange={(e) => setThreshold(e.target.value)}
								placeholder="0"
								className="w-full px-4 py-2.5 pr-12 rounded-lg bg-secondary border border-primary/15 focus:border-primary/40 focus:outline-none font-mono text-sm text-foreground"
							/>
							{selectedMetric && (
								<span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono">
									{selectedMetric.unit}
								</span>
							)}
						</div>
					</div>
					<Select
						value={duration.toString() as "60" | "300" | "600" | "900" | "1800"}
						options={DURATIONS.map((d) => ({ value: d.value.toString(), label: d.label }))}
						onChange={(v) => setDuration(Number.parseInt(v, 10))}
						label="Duration"
					/>
				</div>

				{/* Severity */}
				<div>
					<label className="metric-label block mb-2">Severity</label>
					<div className="flex gap-2">
						{SEVERITIES.map((s) => (
							<button
								type="button"
								key={s.value}
								onClick={() => setSeverity(s.value)}
								className={`flex-1 py-2.5 rounded-lg font-mono text-sm font-medium transition-all ${
									severity === s.value
										? "ring-2 ring-offset-2 ring-offset-card"
										: "opacity-50 hover:opacity-80"
								}`}
								style={{
									background: `color-mix(in oklch, var(${s.color}) 20%, transparent)`,
									color: `var(${s.color})`,
									...(severity === s.value && { boxShadow: `0 0 0 2px var(${s.color})` }),
								}}
							>
								{s.label}
							</button>
						))}
					</div>
				</div>

				{/* Notification Channels */}
				<MultiSelect
					values={selectedChannels}
					options={channels.map((c) => ({ value: c.id, label: c.name }))}
					onChange={setSelectedChannels}
					label="Notification Channels"
					placeholder="Select channels..."
				/>

				{/* Actions */}
				<div className="flex gap-3 pt-4">
					<button
						type="button"
						onClick={onClose}
						className="flex-1 px-4 py-3 rounded-lg bg-secondary border border-primary/15 text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors font-mono text-sm"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleSave}
						disabled={!name || !metric || !condition || !threshold || isSaving}
						className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-primary to-violet text-primary-foreground font-mono text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
					>
						{isSaving ? (
							<>
								<Loader2 className="w-4 h-4 animate-spin" />
								Saving...
							</>
						) : (
							<>
								<Check className="w-4 h-4" />
								{editingRule ? "Update Rule" : "Create Rule"}
							</>
						)}
					</button>
				</div>
			</div>
		</Modal>
	);
}

// ============================================
// Channel Form Modal
// ============================================

function ChannelModal({
	isOpen,
	onClose,
	onSave,
}: {
	isOpen: boolean;
	onClose: () => void;
	onSave: (channel: { name: string; type: ChannelType; config: Record<string, string> }) => void;
}) {
	const [name, setName] = useState("");
	const [type, setType] = useState<ChannelType | "">("slack");
	const [config, setConfig] = useState<Record<string, string>>({});
	const [isSaving, setIsSaving] = useState(false);

	const handleSave = async () => {
		if (!name || !type) return;

		setIsSaving(true);
		await onSave({ name, type, config });
		setIsSaving(false);
		onClose();
	};

	const renderConfigFields = () => {
		switch (type) {
			case "slack":
				return (
					<>
						<div>
							<label className="metric-label block mb-2">Webhook URL</label>
							<input
								type="url"
								value={config.webhookUrl || ""}
								onChange={(e) => setConfig({ ...config, webhookUrl: e.target.value })}
								placeholder="https://hooks.slack.com/services/..."
								className="w-full px-4 py-2.5 rounded-lg bg-secondary border border-primary/15 focus:border-primary/40 focus:outline-none font-mono text-sm text-foreground placeholder:text-muted-foreground/60"
							/>
						</div>
						<div>
							<label className="metric-label block mb-2">Channel</label>
							<input
								type="text"
								value={config.channel || ""}
								onChange={(e) => setConfig({ ...config, channel: e.target.value })}
								placeholder="alerts"
								className="w-full px-4 py-2.5 rounded-lg bg-secondary border border-primary/15 focus:border-primary/40 focus:outline-none font-mono text-sm text-foreground placeholder:text-muted-foreground/60"
							/>
						</div>
					</>
				);
			case "email":
				return (
					<div>
						<label className="metric-label block mb-2">Email Addresses</label>
						<input
							type="text"
							value={config.emails || ""}
							onChange={(e) => setConfig({ ...config, emails: e.target.value })}
							placeholder="team@example.com, oncall@example.com"
							className="w-full px-4 py-2.5 rounded-lg bg-secondary border border-primary/15 focus:border-primary/40 focus:outline-none font-mono text-sm text-foreground placeholder:text-muted-foreground/60"
						/>
						<p className="text-xs text-muted-foreground mt-1.5">
							Separate multiple emails with commas
						</p>
					</div>
				);
			case "webhook":
				return (
					<div>
						<label className="metric-label block mb-2">Webhook URL</label>
						<input
							type="url"
							value={config.url || ""}
							onChange={(e) => setConfig({ ...config, url: e.target.value })}
							placeholder="https://api.example.com/webhook"
							className="w-full px-4 py-2.5 rounded-lg bg-secondary border border-primary/15 focus:border-primary/40 focus:outline-none font-mono text-sm text-foreground placeholder:text-muted-foreground/60"
						/>
					</div>
				);
			case "pagerduty":
				return (
					<div>
						<label className="metric-label block mb-2">Routing Key</label>
						<input
							type="text"
							value={config.routingKey || ""}
							onChange={(e) => setConfig({ ...config, routingKey: e.target.value })}
							placeholder="Integration routing key"
							className="w-full px-4 py-2.5 rounded-lg bg-secondary border border-primary/15 focus:border-primary/40 focus:outline-none font-mono text-sm text-foreground placeholder:text-muted-foreground/60"
						/>
					</div>
				);
			default:
				return null;
		}
	};

	return (
		<Modal isOpen={isOpen} onClose={onClose} title="Add Notification Channel">
			<div className="space-y-5">
				{/* Name */}
				<div>
					<label className="metric-label block mb-2">Channel Name</label>
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="e.g., Engineering Slack"
						className="w-full px-4 py-2.5 rounded-lg bg-secondary border border-primary/15 focus:border-primary/40 focus:outline-none font-mono text-sm text-foreground placeholder:text-muted-foreground/60"
					/>
				</div>

				{/* Type */}
				<div>
					<label className="metric-label block mb-2">Channel Type</label>
					<div className="grid grid-cols-4 gap-2">
						{CHANNEL_TYPES.map((t) => {
							const Icon = t.icon;
							return (
								<button
									type="button"
									key={t.value}
									onClick={() => {
										setType(t.value);
										setConfig({});
									}}
									className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all ${
										type === t.value
											? "border-primary bg-primary/10"
											: "border-primary/10 bg-secondary hover:border-primary/30"
									}`}
								>
									<Icon
										className={`w-5 h-5 ${
											type === t.value ? "text-primary" : "text-muted-foreground"
										}`}
									/>
									<span
										className={`text-xs font-mono ${
											type === t.value ? "text-primary" : "text-muted-foreground"
										}`}
									>
										{t.label}
									</span>
								</button>
							);
						})}
					</div>
				</div>

				{/* Config fields */}
				{type && <div className="space-y-4">{renderConfigFields()}</div>}

				{/* Actions */}
				<div className="flex gap-3 pt-4">
					<button
						type="button"
						onClick={onClose}
						className="flex-1 px-4 py-3 rounded-lg bg-secondary border border-primary/15 text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors font-mono text-sm"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleSave}
						disabled={!name || !type || isSaving}
						className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-violet to-primary text-primary-foreground font-mono text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
					>
						{isSaving ? (
							<>
								<Loader2 className="w-4 h-4 animate-spin" />
								Adding...
							</>
						) : (
							<>
								<Plus className="w-4 h-4" />
								Add Channel
							</>
						)}
					</button>
				</div>
			</div>
		</Modal>
	);
}

// ============================================
// Main Page Component
// ============================================

export default function AlertsPage() {
	const apiClient = useApiClient();
	const [rules, setRules] = useState<AlertRule[]>([]);
	const [channels, setChannels] = useState<NotificationChannel[]>([]);
	const [history, setHistory] = useState<AlertHistoryItem[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [showRuleModal, setShowRuleModal] = useState(false);
	const [showChannelModal, setShowChannelModal] = useState(false);
	const [editingRule, setEditingRule] = useState<AlertRule | undefined>();
	const [testingChannel, setTestingChannel] = useState<string | null>(null);

	// Fetch data
	const fetchData = useCallback(async () => {
		setIsLoading(true);
		try {
			const [rulesData, channelsData, historyData] = await Promise.all([
				apiClient.getAlertRules(),
				apiClient.getNotificationChannels(),
				apiClient.getAlertHistory(),
			]);
			setRules(rulesData.rules);
			setChannels(channelsData.channels);
			setHistory(historyData.alerts);
		} catch (err) {
			console.error("Failed to fetch alert data:", err);
			// Keep empty state - no mock data
		} finally {
			setIsLoading(false);
		}
	}, [apiClient]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	// Handlers
	const handleSaveRule = async (
		ruleData: Omit<AlertRule, "id" | "enabled" | "status" | "lastTriggered">,
	) => {
		if (editingRule) {
			await apiClient.updateAlertRule(editingRule.id, ruleData);
		} else {
			await apiClient.createAlertRule(ruleData);
		}
		fetchData();
		setEditingRule(undefined);
	};

	const handleDeleteRule = async (id: string) => {
		await apiClient.deleteAlertRule(id);
		setRules((prev) => prev.filter((r) => r.id !== id));
	};

	const handleToggleRule = async (id: string, enabled: boolean) => {
		await apiClient.updateAlertRule(id, { enabled });
		setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
	};

	const handleSaveChannel = async (channel: {
		name: string;
		type: ChannelType;
		config: Record<string, string>;
	}) => {
		await apiClient.createNotificationChannel(channel);
		fetchData();
	};

	const handleTestChannel = async (id: string) => {
		setTestingChannel(id);
		try {
			await apiClient.testNotificationChannel(id);
		} finally {
			setTestingChannel(null);
		}
	};

	const handleDeleteChannel = async (id: string) => {
		await apiClient.deleteNotificationChannel(id);
		setChannels((prev) => prev.filter((c) => c.id !== id));
	};

	const handleAcknowledge = async (id: string) => {
		await apiClient.acknowledgeAlert(id);
		setHistory((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
	};

	const firingCount = rules.filter((r) => r.status === "triggered").length;

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-display text-2xl text-foreground flex items-center gap-3">
						<div
							className={`w-8 h-8 rounded-lg flex items-center justify-center ${
								firingCount > 0
									? "bg-gradient-to-br from-destructive to-warning"
									: "bg-gradient-to-br from-warning to-destructive"
							}`}
						>
							{firingCount > 0 ? (
								<AlertTriangle className="w-4 h-4 text-white" />
							) : (
								<Bell className="w-4 h-4 text-warning-foreground" />
							)}
						</div>
						Alert Configuration
						{firingCount > 0 && (
							<span className="px-2 py-1 rounded-full text-xs font-mono bg-destructive/20 text-destructive animate-pulse">
								{firingCount} firing
							</span>
						)}
					</h1>
					<p className="text-sm text-muted-foreground mt-1 ml-11">
						Manage alert rules and notification channels
					</p>
				</div>
			</div>

			{/* Main Grid */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				{/* Alert Rules - Left Column (2/3 width) */}
				<div className="lg:col-span-2 space-y-4">
					{/* Section header */}
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Shield className="w-4 h-4 text-primary" />
							<h2 className="font-display text-base text-foreground">Alert Rules</h2>
							<span className="px-2 py-0.5 rounded-full text-xs font-mono bg-secondary text-muted-foreground">
								{rules.length}
							</span>
						</div>
						<button
							type="button"
							onClick={() => {
								setEditingRule(undefined);
								setShowRuleModal(true);
							}}
							className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-violet text-primary-foreground font-mono text-sm font-medium hover:shadow-lg hover:shadow-primary/20 transition-all"
						>
							<Plus className="w-4 h-4" />
							New Rule
						</button>
					</div>

					{/* Rules list */}
					{isLoading ? (
						<div className="space-y-4">
							{[1, 2, 3].map((i) => (
								<div key={i} className="panel p-4 animate-pulse">
									<div className="flex items-center gap-3 mb-3">
										<div className="w-3 h-3 rounded-full bg-secondary" />
										<div className="h-4 w-32 rounded bg-secondary" />
									</div>
									<div className="h-12 rounded bg-secondary mb-3" />
									<div className="h-4 w-24 rounded bg-secondary" />
								</div>
							))}
						</div>
					) : (
						<div className="space-y-4 stagger">
							{rules.map((rule) => (
								<AlertRuleCard
									key={rule.id}
									rule={rule}
									channels={channels}
									onEdit={() => {
										setEditingRule(rule);
										setShowRuleModal(true);
									}}
									onDelete={() => handleDeleteRule(rule.id)}
									onToggle={(enabled) => handleToggleRule(rule.id, enabled)}
								/>
							))}
						</div>
					)}
				</div>

				{/* Notification Channels - Right Column (1/3 width) */}
				<div className="space-y-4">
					{/* Section header */}
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<ExternalLink className="w-4 h-4 text-violet" />
							<h2 className="font-display text-base text-foreground">Channels</h2>
						</div>
						<button
							type="button"
							onClick={() => setShowChannelModal(true)}
							className="p-2 rounded-lg bg-secondary hover:bg-violet/20 text-muted-foreground hover:text-violet transition-colors"
						>
							<Plus className="w-4 h-4" />
						</button>
					</div>

					{/* Channels list */}
					<div className="space-y-3">
						{channels.map((channel) => (
							<ChannelCard
								key={channel.id}
								channel={channel}
								onTest={() => handleTestChannel(channel.id)}
								onDelete={() => handleDeleteChannel(channel.id)}
								isTesting={testingChannel === channel.id}
							/>
						))}
						{channels.length === 0 && !isLoading && (
							<div className="panel p-6 text-center">
								<BellOff className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
								<p className="text-sm text-muted-foreground">No notification channels configured</p>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Alert History */}
			<div className="panel overflow-hidden">
				{/* Section header */}
				<div className="flex items-center justify-between px-4 py-4 border-b border-primary/10">
					<div className="flex items-center gap-2">
						<Clock className="w-4 h-4 text-warning" />
						<h2 className="font-display text-base text-foreground">Alert History</h2>
					</div>
				</div>

				{/* History table */}
				<div className="max-h-80 overflow-auto">
					{history.length > 0 ? (
						history.map((alert) => (
							<AlertHistoryRow
								key={alert.id}
								alert={alert}
								onAcknowledge={() => handleAcknowledge(alert.id)}
							/>
						))
					) : (
						<div className="p-8 text-center">
							<CheckCircle2 className="w-8 h-8 text-success mx-auto mb-3" />
							<p className="text-sm text-muted-foreground">No recent alerts</p>
						</div>
					)}
				</div>
			</div>

			{/* Modals */}
			<AlertRuleModal
				isOpen={showRuleModal}
				onClose={() => {
					setShowRuleModal(false);
					setEditingRule(undefined);
				}}
				onSave={handleSaveRule}
				channels={channels}
				editingRule={editingRule}
			/>

			<ChannelModal
				isOpen={showChannelModal}
				onClose={() => setShowChannelModal(false)}
				onSave={handleSaveChannel}
			/>
		</div>
	);
}
