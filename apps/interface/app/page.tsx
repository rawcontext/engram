"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
    const [sessionId, setSessionId] = useState("");
    const router = useRouter();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (sessionId) {
            router.push(`/session/${sessionId}`);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
            <div className="p-8 bg-white dark:bg-gray-800 rounded shadow-md w-full max-w-md">
                <h1 className="text-2xl font-bold mb-6 text-center">Soul System Interface</h1>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="sessionId" className="block text-sm font-medium mb-1">
                            Enter Session ID
                        </label>
                        <input
                            id="sessionId"
                            type="text"
                            value={sessionId}
                            onChange={(e) => setSessionId(e.target.value)}
                            placeholder="e.g. uuid-..."
                            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
                            autoFocus
                        />
                    </div>
                    <button
                        type="submit"
                        className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors"
                    >
                        View Session
                    </button>
                </form>
            </div>
        </div>
    );
}
