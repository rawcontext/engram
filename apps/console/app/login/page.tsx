"use client";

import { signIn } from "../../lib/auth-client";
import { Terminal } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginContent() {
	const searchParams = useSearchParams();
	const callbackUrl = searchParams.get("callbackUrl") || "/";

	const handleGoogleSignIn = async () => {
		await signIn.social({
			provider: "google",
			callbackURL: callbackUrl,
		});
	};

	return (
		<div className="min-h-screen bg-[rgb(var(--console-void))] flex items-center justify-center p-4">
			<div className="panel p-8 w-full max-w-md">
				{/* Logo */}
				<div className="flex items-center justify-center gap-3 mb-8">
					<div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[rgb(var(--console-cyan))] to-[rgb(var(--console-purple))] flex items-center justify-center shadow-lg shadow-[rgba(var(--console-cyan),0.3)]">
						<Terminal className="w-6 h-6 text-[rgb(var(--console-void))]" />
					</div>
					<div>
						<h1 className="font-display text-xl text-[rgb(var(--text-primary))]">Console</h1>
						<p className="font-mono text-[10px] text-[rgb(var(--text-muted))] uppercase tracking-wider">
							Engram
						</p>
					</div>
				</div>

				{/* Title */}
				<div className="text-center mb-8">
					<h2 className="font-display text-lg text-[rgb(var(--text-primary))] mb-2">
						Sign in to continue
					</h2>
					<p className="text-sm text-[rgb(var(--text-muted))]">
						Access the infrastructure monitoring console
					</p>
				</div>

				{/* Sign In Button */}
				<button
					onClick={handleGoogleSignIn}
					className="w-full panel-elevated flex items-center justify-center gap-3 px-4 py-3 rounded-lg hover:border-[rgba(var(--console-cyan),0.3)] transition-all hover-lift"
				>
					<svg className="w-5 h-5" viewBox="0 0 24 24">
						<path
							fill="currentColor"
							d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
						/>
						<path
							fill="currentColor"
							d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
						/>
						<path
							fill="currentColor"
							d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
						/>
						<path
							fill="currentColor"
							d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
						/>
					</svg>
					<span className="font-medium text-[rgb(var(--text-primary))]">Continue with Google</span>
				</button>

				{/* Footer */}
				<p className="mt-8 text-center text-xs text-[rgb(var(--text-dim))]">
					By signing in, you agree to our terms of service
				</p>
			</div>
		</div>
	);
}

export default function LoginPage() {
	return (
		<Suspense
			fallback={
				<div className="min-h-screen bg-[rgb(var(--console-void))] flex items-center justify-center">
					<div className="animate-pulse text-[rgb(var(--text-muted))]">Loading...</div>
				</div>
			}
		>
			<LoginContent />
		</Suspense>
	);
}
