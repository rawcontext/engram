/**
 * Design Tokens - Centralized design system constants
 * Engram Neural Observatory aesthetic: Monochrome + Amber palette
 */

// Color Palette
export const colors = {
	// Primary colors
	amber: {
		DEFAULT: "rgb(251, 191, 36)",
		light: "rgb(253, 224, 71)",
		dark: "rgb(245, 158, 11)",
		glow: "rgba(251, 191, 36, 0.5)",
		subtle: "rgba(251, 191, 36, 0.1)",
		border: "rgba(251, 191, 36, 0.3)",
	},
	cyan: {
		DEFAULT: "rgb(34, 211, 238)",
		light: "rgb(103, 232, 249)",
		dark: "rgb(6, 182, 212)",
		glow: "rgba(34, 211, 238, 0.5)",
		subtle: "rgba(34, 211, 238, 0.1)",
		border: "rgba(34, 211, 238, 0.3)",
	},
	violet: {
		DEFAULT: "rgb(139, 92, 246)",
		light: "rgb(167, 139, 250)",
		dark: "rgb(124, 58, 237)",
		glow: "rgba(139, 92, 246, 0.5)",
		subtle: "rgba(139, 92, 246, 0.1)",
		border: "rgba(139, 92, 246, 0.3)",
	},
	green: {
		DEFAULT: "rgb(34, 197, 94)",
		glow: "rgba(34, 197, 94, 0.6)",
		subtle: "rgba(34, 197, 94, 0.15)",
		border: "rgba(34, 197, 94, 0.3)",
	},
	red: {
		DEFAULT: "rgb(239, 68, 68)",
		glow: "rgba(239, 68, 68, 0.6)",
		subtle: "rgba(239, 68, 68, 0.15)",
	},
	// Neutral/Slate colors
	slate: {
		50: "rgb(248, 250, 252)",
		100: "rgb(241, 245, 249)",
		200: "rgb(226, 232, 240)",
		300: "rgb(203, 213, 225)",
		400: "rgb(148, 163, 184)",
		500: "rgb(100, 116, 139)",
		600: "rgb(71, 85, 105)",
		700: "rgb(51, 65, 85)",
		800: "rgb(30, 41, 59)",
		900: "rgb(15, 23, 42)",
	},
	// Background colors
	bg: {
		primary: "rgb(8, 10, 15)",
		secondary: "rgb(12, 14, 20)",
		tertiary: "rgb(15, 20, 30)",
		glass: "rgba(15, 20, 30, 0.6)",
		glassDark: "rgba(8, 10, 15, 0.95)",
	},
} as const;

// Typography
export const fonts = {
	display: "'Orbitron', sans-serif",
	mono: "'JetBrains Mono', monospace",
	body: "'Inter', system-ui, sans-serif",
} as const;

export const fontSizes = {
	xs: "9px",
	sm: "10px",
	base: "11px",
	md: "12px",
	lg: "14px",
	xl: "16px",
	"2xl": "20px",
	"3xl": "24px",
} as const;

// Spacing
export const spacing = {
	0: "0",
	1: "4px",
	2: "8px",
	3: "12px",
	4: "16px",
	5: "20px",
	6: "24px",
	8: "32px",
	10: "40px",
	12: "48px",
} as const;

// Border Radius
export const radii = {
	sm: "4px",
	md: "6px",
	lg: "8px",
	xl: "10px",
	"2xl": "12px",
	full: "9999px",
} as const;

// Animation timing
export const transitions = {
	fast: "0.15s cubic-bezier(0.4, 0, 0.2, 1)",
	default: "0.25s cubic-bezier(0.4, 0, 0.2, 1)",
	slow: "0.35s cubic-bezier(0.4, 0, 0.2, 1)",
	spring: "0.5s cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

// Shadows
export const shadows = {
	sm: "0 2px 8px rgba(0, 0, 0, 0.2)",
	md: "0 4px 20px rgba(0, 0, 0, 0.25)",
	lg: "0 8px 32px rgba(0, 0, 0, 0.4)",
	glow: {
		amber: "0 0 12px rgba(251, 191, 36, 0.4)",
		cyan: "0 0 12px rgba(34, 211, 238, 0.4)",
		violet: "0 0 12px rgba(139, 92, 246, 0.4)",
		green: "0 0 12px rgba(34, 197, 94, 0.4)",
	},
	inset: "inset 0 1px 0 rgba(255,255,255,0.03)",
} as const;

// Glassmorphism presets
export const glass = {
	light: {
		background: "rgba(15, 20, 30, 0.6)",
		backdropFilter: "blur(12px)",
		border: "1px solid rgba(148, 163, 184, 0.15)",
	},
	dark: {
		background: "rgba(8, 10, 15, 0.95)",
		backdropFilter: "blur(20px)",
		border: "1px solid rgba(148, 163, 184, 0.1)",
	},
	panel: {
		background: "linear-gradient(135deg, rgba(15, 20, 30, 0.95) 0%, rgba(8, 10, 15, 0.98) 100%)",
		backdropFilter: "blur(20px)",
		border: "1px solid rgba(251, 191, 36, 0.25)",
	},
} as const;

// Common gradient definitions
export const gradients = {
	amber: "linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(245, 158, 11, 0.1))",
	cyan: "linear-gradient(135deg, rgba(34, 211, 238, 0.2), rgba(6, 182, 212, 0.1))",
	violet: "linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(124, 58, 237, 0.1))",
	panel: "linear-gradient(180deg, rgba(10, 15, 25, 0.95) 0%, rgba(15, 20, 30, 0.8) 100%)",
} as const;

// Keyframe animation definitions (as CSS strings for injection)
export const keyframes = {
	pulse: `
		@keyframes pulse {
			0%, 100% { opacity: 1; transform: scale(1); }
			50% { opacity: 0.5; transform: scale(0.95); }
		}
	`,
	spin: `
		@keyframes spin {
			from { transform: rotate(0deg); }
			to { transform: rotate(360deg); }
		}
	`,
	fadeInUp: `
		@keyframes fadeInUp {
			from {
				opacity: 0;
				transform: translateY(12px) scale(0.98);
			}
			to {
				opacity: 1;
				transform: translateY(0) scale(1);
			}
		}
	`,
	float: `
		@keyframes float {
			0%, 100% { transform: translateY(0) translateX(0); opacity: 0.3; }
			25% { transform: translateY(-20px) translateX(10px); opacity: 0.6; }
			50% { transform: translateY(-10px) translateX(-5px); opacity: 0.4; }
			75% { transform: translateY(-30px) translateX(15px); opacity: 0.5; }
		}
	`,
	glow: `
		@keyframes glow {
			0%, 100% { opacity: 0.4; transform: scale(1); }
			50% { opacity: 0.8; transform: scale(1.2); }
		}
	`,
	skeletonPulse: `
		@keyframes skeletonPulse {
			0%, 100% { opacity: 0.3; }
			50% { opacity: 0.6; }
		}
	`,
} as const;

// Z-index scale
export const zIndex = {
	background: 0,
	base: 1,
	overlay: 10,
	modal: 20,
	header: 50,
	toast: 100,
} as const;
