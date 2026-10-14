import { greet } from "../src/piCues/index.js";

describe("greet", () => {
  it("greets by name", () => {
    expect(greet("world")).toBe("Hello, world!");
  });
});
