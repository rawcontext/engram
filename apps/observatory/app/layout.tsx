import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Engram | Neural Observatory",
	description: "Observe and analyze AI consciousness streams",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body className="grid-bg">
				<div className="relative z-10">{children}</div>
			</body>
		</html>
	);
}
