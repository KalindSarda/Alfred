import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations("./drizzle");
      return {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      };
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    // Conversation tests set up a user, accounts and a linked chat; give them room when the suite runs in parallel.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["./test/setup.ts"],
  },
});
