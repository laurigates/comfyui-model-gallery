import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/js/**/*.test.js"],
    environment: "node",
  },
  resolve: {
    alias: {
      "../../../scripts/app.js": resolve(__dirname, "tests/js/__mocks__/app.js"),
    },
  },
});
