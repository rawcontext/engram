import type { Metadata } from "next";
import "./globals.css";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { Providers } from "./providers";

export const metadata: Metadata = {
	title: "Console | Engram",
	description: "Infrastructure monitoring and management console for Engram",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body className="antialiased">
				<Providers>
					<Sidebar />
					<Header />
					<main className="ml-[var(--sidebar-width)] pt-[var(--header-height)] min-h-screen relative z-10">
						<div className="p-6">{children}</div>
					</main>
				</Providers>
			</body>
		</html>
	);
}
