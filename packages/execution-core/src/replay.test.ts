import { describe, it, expect } from "bun:test";
import { ReplayEngine } from "./replay";

describe("ReplayEngine", () => {
    it("should exist", () => {
        expect(new ReplayEngine()).toBeDefined();
    });
});
