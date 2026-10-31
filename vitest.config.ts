import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Same "@/..." imports as the app (tsconfig paths).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
