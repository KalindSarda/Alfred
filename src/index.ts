import { createApp } from "./app";
import { createTelegramApi } from "./bot/telegramApi";
import { type Bindings, getConfig } from "./config/env";
import { getDb } from "./db/client";
import { runMaintenance } from "./services/maintenance";
import { runNudges } from "./services/nudges";
import { logger } from "./utils/logger";

const app = createApp();

export default {
  fetch: app.fetch,
  /**
   * The daily job (04:30 UTC = 10:00 IST): card payment reminders, then housekeeping.
   * Locally: curl "http://localhost:8787/__scheduled?cron=30+4+*+*+*" while `npm start` is running.
   */
  async scheduled(controller: ScheduledController, env: Bindings): Promise<void> {
    logger.info("scheduled_run", { cron: controller.cron });
    const config = getConfig(env);
    const db = getDb(env.DB);
    const now = () => Date.now();

    try {
      const result = await runNudges({ db, telegram: createTelegramApi(config.TELEGRAM_BOT_TOKEN), now });
      logger.info("nudges_done", { ...result });
    } catch (error) {
      logger.error("nudges_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
    try {
      await runMaintenance(db, now());
    } catch (error) {
      logger.error("maintenance_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  },
} satisfies ExportedHandler<Bindings>;
