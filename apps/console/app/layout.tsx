import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
	title: "Console | Engram",
	description: "Infrastructure monitoring and management console for Engram",
};

// Script to prevent flash of wrong theme
const themeScript = `
(function() {
  const stored = localStorage.getItem('engram-console-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = stored === 'light' ? 'light' : stored === 'dark' ? 'dark' : (prefersDark ? 'dark' : 'light');
  document.documentElement.classList.add(theme);
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: Theme script prevents FOUC */}
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
			</head>
			<body className="antialiased" suppressHydrationWarning>
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
