"use client";

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

type Theme = "dark" | "light" | "system";
type ResolvedTheme = "dark" | "light";

interface ThemeContextValue {
	theme: Theme;
	resolvedTheme: ResolvedTheme;
	setTheme: (theme: Theme) => void;
	toggle: () => void;
}

const STORAGE_KEY = "engram-console-theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
	if (typeof window === "undefined") return "dark";
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<Theme>("system");
	const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("dark");
	const [isHydrated, setIsHydrated] = useState(false);

	// Hydrate from localStorage
	useEffect(() => {
		const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
		if (stored && ["dark", "light", "system"].includes(stored)) {
			setThemeState(stored);
		}
		setIsHydrated(true);
	}, []);

	// Resolve theme and apply to document
	useEffect(() => {
		if (!isHydrated) return;

		const resolved = theme === "system" ? getSystemTheme() : theme;
		setResolvedTheme(resolved);

		// Apply to document
		document.documentElement.setAttribute("data-theme", resolved);
	}, [theme, isHydrated]);

	// Listen for system theme changes
	useEffect(() => {
		if (theme !== "system") return;

		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		const handler = (e: MediaQueryListEvent) => {
			setResolvedTheme(e.matches ? "dark" : "light");
			document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
		};

		mediaQuery.addEventListener("change", handler);
		return () => mediaQuery.removeEventListener("change", handler);
	}, [theme]);

	const setTheme = useCallback((newTheme: Theme) => {
		setThemeState(newTheme);
		localStorage.setItem(STORAGE_KEY, newTheme);
	}, []);

	const toggle = useCallback(() => {
		const next = resolvedTheme === "dark" ? "light" : "dark";
		setTheme(next);
	}, [resolvedTheme, setTheme]);

	const value = useMemo(
		(): ThemeContextValue => ({
			theme,
			resolvedTheme,
			setTheme,
			toggle,
		}),
		[theme, resolvedTheme, setTheme, toggle],
	);

	// Prevent flash by not rendering until hydrated
	if (!isHydrated) {
		return null;
	}

	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return context;
}
