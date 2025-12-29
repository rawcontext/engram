"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("Dashboard error:", error);
	}, [error]);

	return (
		<div className="min-h-screen bg-background flex items-center justify-center">
			<div className="text-center space-y-4 max-w-md px-4">
				<h2 className="text-2xl font-semibold">Something went wrong</h2>
				<p className="text-muted-foreground">
					{error.message || "An unexpected error occurred while loading the dashboard."}
				</p>
				<div className="flex gap-2 justify-center">
					<Button onClick={() => reset()}>Try again</Button>
					<Button variant="outline" onClick={() => window.location.reload()}>
						Reload page
					</Button>
				</div>
			</div>
		</div>
	);
}
