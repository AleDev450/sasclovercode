import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount between tests so one test cannot see another's DOM.
afterEach(() => {
  cleanup();
});
