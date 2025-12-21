import "./globals.css";
import type { Metadata } from "next";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";

export const metadata: Metadata = {
	title: "Engram | Neural Observatory",
	description: "Observe and analyze AI consciousness streams",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body className="grid-bg">
				<ErrorBoundary>
					<div className="relative z-10">{children}</div>
				</ErrorBoundary>
			</body>
		</html>
	);
}
