import { createContext } from "react";

/**
 * Context for highlighted nodes to avoid prop drilling and re-renders.
 * Holds a Set of node IDs to support highlighting the entire parent chain.
 */
export const HighlightContext = createContext<Set<string>>(new Set());
