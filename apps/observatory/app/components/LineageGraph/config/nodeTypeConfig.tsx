import type { NodeTypeConfigMap } from "../types";

/**
 * Node type visual configurations
 * Monochrome + Amber palette:
 * - Silver/White (session): Clean, prominent session hub
 * - Amber (turn): Primary conversation unit
 * - Cyan (reasoning): Thinking/reasoning blocks
 * - Violet/Purple (toolcall): Tool execution
 */
export const nodeTypeConfig: NodeTypeConfigMap = {
	session: {
		border: "rgba(226, 232, 240, 0.8)",
		bg: "rgba(226, 232, 240, 0.1)",
		glow: "rgba(226, 232, 240, 0.5)",
		text: "rgb(226, 232, 240)",
		icon: (
			<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={1.5}
					d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
				/>
			</svg>
		),
	},
	turn: {
		border: "rgba(251, 191, 36, 0.7)",
		bg: "rgba(251, 191, 36, 0.1)",
		glow: "rgba(251, 191, 36, 0.5)",
		text: "rgb(251, 191, 36)",
		icon: (
			<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={1.5}
					d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
				/>
			</svg>
		),
	},
	reasoning: {
		border: "rgba(34, 211, 238, 0.7)",
		bg: "rgba(34, 211, 238, 0.1)",
		glow: "rgba(34, 211, 238, 0.5)",
		text: "rgb(34, 211, 238)",
		icon: (
			<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={1.5}
					d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
				/>
			</svg>
		),
	},
	toolcall: {
		border: "rgba(139, 92, 246, 0.7)",
		bg: "rgba(139, 92, 246, 0.1)",
		glow: "rgba(139, 92, 246, 0.5)",
		text: "rgb(139, 92, 246)",
		icon: (
			<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={1.5}
					d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
				/>
			</svg>
		),
	},
	// Legacy types for backwards compatibility
	thought: {
		border: "rgba(251, 191, 36, 0.7)",
		bg: "rgba(251, 191, 36, 0.1)",
		glow: "rgba(251, 191, 36, 0.5)",
		text: "rgb(251, 191, 36)",
		icon: (
			<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={1.5}
					d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
				/>
			</svg>
		),
	},
	action: {
		border: "rgba(251, 191, 36, 0.6)",
		bg: "rgba(251, 191, 36, 0.08)",
		glow: "rgba(251, 191, 36, 0.4)",
		text: "rgb(245, 158, 11)",
		icon: (
			<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={1.5}
					d="M13 10V3L4 14h7v7l9-11h-7z"
				/>
			</svg>
		),
	},
	observation: {
		border: "rgba(148, 163, 184, 0.6)",
		bg: "rgba(148, 163, 184, 0.08)",
		glow: "rgba(148, 163, 184, 0.4)",
		text: "rgb(148, 163, 184)",
		icon: (
			<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth={1.5}
					d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
				/>
			</svg>
		),
	},
	default: {
		border: "rgba(148, 163, 184, 0.4)",
		bg: "rgba(148, 163, 184, 0.08)",
		glow: "rgba(148, 163, 184, 0.25)",
		text: "rgb(148, 163, 184)",
		icon: null,
	},
};

/**
 * Get node configuration by type, with fallback to default
 */
export function getNodeConfig(nodeType: string | undefined): NodeTypeConfigMap[string] {
	const type = nodeType?.toLowerCase() || "default";
	return nodeTypeConfig[type] || nodeTypeConfig.default;
}
