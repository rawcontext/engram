"use client";

import { EnvironmentProvider } from "../lib/environment";
import { ThemeProvider } from "../lib/theme";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
	return (
		<ThemeProvider>
			<EnvironmentProvider>{children}</EnvironmentProvider>
		</ThemeProvider>
	);
}
