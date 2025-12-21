"use client";

import { Component, type ReactNode } from "react";
import { GlassPanel } from "./GlassPanel";

interface ErrorBoundaryProps {
	children: ReactNode;
	fallback?: ReactNode;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
	errorInfo: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = {
			hasError: false,
			error: null,
			errorInfo: null,
		};
	}

	static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: { componentStack: string }): void {
		console.error("Error boundary caught an error:", error, errorInfo);
		this.setState({
			error,
			errorInfo: errorInfo.componentStack,
		});
	}

	handleReset = (): void => {
		this.setState({
			hasError: false,
			error: null,
			errorInfo: null,
		});
	};

	render(): ReactNode {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback;
			}

			return (
				<div className="min-h-screen flex items-center justify-center p-6">
					<GlassPanel className="max-w-2xl w-full">
						<div className="space-y-6">
							<div className="flex items-center gap-3">
								<div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
									<svg
										className="w-6 h-6 text-red-500"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
										/>
									</svg>
								</div>
								<div>
									<h2 className="text-xl font-bold text-white">Something went wrong</h2>
									<p className="text-sm text-gray-400">
										An unexpected error occurred in the application
									</p>
								</div>
							</div>

							{this.state.error && (
								<div className="space-y-2">
									<p className="text-sm font-semibold text-gray-300">Error details:</p>
									<div className="bg-black/30 rounded-lg p-4 font-mono text-sm text-red-400 overflow-x-auto">
										<p className="font-semibold">{this.state.error.name}</p>
										<p className="text-gray-300">{this.state.error.message}</p>
									</div>
								</div>
							)}

							{this.state.errorInfo && (
								<details className="group">
									<summary className="text-sm font-semibold text-gray-300 cursor-pointer hover:text-white transition-colors">
										Component Stack
									</summary>
									<div className="mt-2 bg-black/30 rounded-lg p-4 font-mono text-xs text-gray-400 overflow-x-auto">
										<pre className="whitespace-pre-wrap">{this.state.errorInfo}</pre>
									</div>
								</details>
							)}

							<div className="flex gap-3">
								<button
									type="button"
									onClick={this.handleReset}
									className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
								>
									Try again
								</button>
								<button
									type="button"
									onClick={() => {
										window.location.href = "/";
									}}
									className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium"
								>
									Return home
								</button>
							</div>
						</div>
					</GlassPanel>
				</div>
			);
		}

		return this.props.children;
	}
}
