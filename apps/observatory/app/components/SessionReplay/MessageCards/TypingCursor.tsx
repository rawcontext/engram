"use client";

import { memo } from "react";

// Animated typing cursor - Amber accent
function TypingCursorInner() {
	return (
		<span
			style={{
				display: "inline-block",
				width: "2px",
				height: "1em",
				marginLeft: "2px",
				background: "rgb(251, 191, 36)",
				verticalAlign: "text-bottom",
				animation: "cursorBlink 1s step-end infinite",
				boxShadow: "0 0 8px rgba(251, 191, 36, 0.8)",
			}}
		/>
	);
}

export const TypingCursor = memo(TypingCursorInner);
