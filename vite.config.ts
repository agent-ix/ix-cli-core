/// <reference types="vitest" />
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts({ rollupTypes: true, include: ["src"] })],
  build: {
    lib: {
      entry: "src/index.ts",
      fileName: () => "index.js",
      formats: ["es"],
    },
    target: "node18",
    rollupOptions: {
      external: [
        /^node:/,
        /^react($|\/)/,
        "yaml",
        "zod",
        "age-encryption",
        "@napi-rs/keyring",
        /^@napi-rs\/keyring-/,
        "@agent-ix/ix-ui-cli",
        "@clack/prompts",
        "@oclif/core",
      ],
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
