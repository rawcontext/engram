"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";

export interface EnvironmentConfig {
	id: string;
	name: string;
	apiUrl: string;
	wsUrl: string;
	description?: string;
	isCustom?: boolean;
}

export const DEFAULT_ENVIRONMENTS: EnvironmentConfig[] = [
	{
		id: "local",
		name: "Local",
		apiUrl: "http://localhost:6174",
		wsUrl: "ws://localhost:6174",
		description: "Local development environment",
	},
	{
		id: "production",
		name: "Production",
		apiUrl: "https://api.engram.sh",
		wsUrl: "wss://api.engram.sh",
		description: "Production environment",
	},
];

const STORAGE_KEY = "engram-console-environment";
const CUSTOM_ENVIRONMENTS_KEY = "engram-console-custom-environments";

interface EnvironmentContextValue {
	/** Current active environment */
	environment: EnvironmentConfig;
	/** All available environments (default + custom) */
	environments: EnvironmentConfig[];
	/** Switch to a different environment by ID */
	setEnvironment: (id: string) => void;
	/** Add a custom environment */
	addCustomEnvironment: (config: Omit<EnvironmentConfig, "id" | "isCustom">) => void;
	/** Remove a custom environment */
	removeCustomEnvironment: (id: string) => void;
	/** Whether we're connected to the current environment */
	isConnected: boolean;
	/** Set connection status */
	setIsConnected: (connected: boolean) => void;
}

const EnvironmentContext = createContext<EnvironmentContextValue | null>(null);

export function EnvironmentProvider({ children }: { children: ReactNode }) {
	const [environments, setEnvironments] = useState<EnvironmentConfig[]>(DEFAULT_ENVIRONMENTS);
	const [currentId, setCurrentId] = useState<string>("local");
	const [isConnected, setIsConnected] = useState(false);
	const [isHydrated, setIsHydrated] = useState(false);

	// Hydrate from localStorage on mount
	useEffect(() => {
		const storedId = localStorage.getItem(STORAGE_KEY);
		const storedCustom = localStorage.getItem(CUSTOM_ENVIRONMENTS_KEY);

		if (storedCustom) {
			try {
				const customEnvs = JSON.parse(storedCustom) as EnvironmentConfig[];
				setEnvironments([...DEFAULT_ENVIRONMENTS, ...customEnvs]);
			} catch {
				// Invalid JSON, ignore
			}
		}

		if (storedId) {
			setCurrentId(storedId);
		}

		setIsHydrated(true);
	}, []);

	const environment = useMemo(() => {
		return environments.find((e) => e.id === currentId) ?? environments[0];
	}, [environments, currentId]);

	const setEnvironment = useCallback((id: string) => {
		setCurrentId(id);
		localStorage.setItem(STORAGE_KEY, id);
		setIsConnected(false); // Reset connection status on environment change
	}, []);

	const addCustomEnvironment = useCallback((config: Omit<EnvironmentConfig, "id" | "isCustom">) => {
		const id = `custom-${Date.now()}`;
		const newEnv: EnvironmentConfig = { ...config, id, isCustom: true };

		setEnvironments((prev) => {
			const updated = [...prev, newEnv];
			const customOnly = updated.filter((e) => e.isCustom);
			localStorage.setItem(CUSTOM_ENVIRONMENTS_KEY, JSON.stringify(customOnly));
			return updated;
		});

		return id;
	}, []);

	const removeCustomEnvironment = useCallback(
		(id: string) => {
			setEnvironments((prev) => {
				const updated = prev.filter((e) => e.id !== id);
				const customOnly = updated.filter((e) => e.isCustom);
				localStorage.setItem(CUSTOM_ENVIRONMENTS_KEY, JSON.stringify(customOnly));

				// If we removed the current environment, switch to local
				if (currentId === id) {
					setCurrentId("local");
					localStorage.setItem(STORAGE_KEY, "local");
				}

				return updated;
			});
		},
		[currentId],
	);

	const value = useMemo(
		(): EnvironmentContextValue => ({
			environment,
			environments,
			setEnvironment,
			addCustomEnvironment,
			removeCustomEnvironment,
			isConnected,
			setIsConnected,
		}),
		[
			environment,
			environments,
			setEnvironment,
			addCustomEnvironment,
			removeCustomEnvironment,
			isConnected,
		],
	);

	// Prevent hydration mismatch by not rendering until hydrated
	if (!isHydrated) {
		return null;
	}

	return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>;
}

export function useEnvironment(): EnvironmentContextValue {
	const context = useContext(EnvironmentContext);
	if (!context) {
		throw new Error("useEnvironment must be used within an EnvironmentProvider");
	}
	return context;
}
