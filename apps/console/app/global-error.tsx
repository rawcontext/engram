"use client";

import { useEffect } from "react";

export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("Global error:", error);
	}, [error]);

	return (
		<html lang="en">
			<body>
				<div
					style={{
						minHeight: "100vh",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						backgroundColor: "#0a0a0a",
						color: "#fafafa",
					}}
				>
					<div style={{ textAlign: "center", maxWidth: "400px", padding: "1rem" }}>
						<h2 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Something went wrong</h2>
						<p style={{ color: "#a1a1aa", marginBottom: "1rem" }}>
							{error.message || "An unexpected error occurred."}
						</p>
						<button
							type="button"
							onClick={() => reset()}
							style={{
								padding: "0.5rem 1rem",
								backgroundColor: "#3b82f6",
								color: "white",
								border: "none",
								borderRadius: "0.375rem",
								cursor: "pointer",
								marginRight: "0.5rem",
							}}
						>
							Try again
						</button>
						<button
							type="button"
							onClick={() => window.location.reload()}
							style={{
								padding: "0.5rem 1rem",
								backgroundColor: "transparent",
								color: "#fafafa",
								border: "1px solid #3f3f46",
								borderRadius: "0.375rem",
								cursor: "pointer",
							}}
						>
							Reload page
						</button>
					</div>
				</div>
			</body>
		</html>
	);
}
