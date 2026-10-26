import { createApp } from "./app";
import type { Bindings } from "./config/env";
import { logger } from "./utils/logger";

const app = createApp();

export default {
  fetch: app.fetch,
  // Daily cron (04:30 UTC = 10:00 IST). The nudge job is added in a later slice.
  async scheduled(controller: ScheduledController): Promise<void> {
    logger.info("scheduled_run", { cron: controller.cron });
  },
} satisfies ExportedHandler<Bindings>;
