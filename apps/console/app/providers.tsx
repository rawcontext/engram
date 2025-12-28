"use client";

import type { ReactNode } from "react";
import { EnvironmentProvider } from "../lib/environment";
import { ThemeProvider } from "../lib/theme";

export function Providers({ children }: { children: ReactNode }) {
	return (
		<ThemeProvider>
			<EnvironmentProvider>{children}</EnvironmentProvider>
		</ThemeProvider>
	);
}
