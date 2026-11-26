import { createApp } from "./app";
import { createTelegramApi } from "./bot/telegramApi";
import { type Bindings, getConfig } from "./config/env";
import { getDb } from "./db/client";
import { runCron } from "./services/cronPlan";
import { logger } from "./utils/logger";

const app = createApp();

export default {
  fetch: app.fetch,
  /**
   * The scheduled work, one cron expression at a time (see `src/services/cronPlan.ts` for what each one does and why they are
   * split: every invocation has to stay under the Workers Free limit of 50 D1 queries).
   * Locally: curl "http://localhost:8787/__scheduled?cron=30+4+*+*+*" while `npm start` is running.
   */
  async scheduled(controller: ScheduledController, env: Bindings): Promise<void> {
    logger.info("scheduled_run", { cron: controller.cron });
    const config = getConfig(env);
    await runCron(controller.cron, {
      db: getDb(env.DB),
      telegram: createTelegramApi(config.TELEGRAM_BOT_TOKEN),
      now: () => Date.now(),
      fetch: (input, init) => fetch(input, init),
    });
  },
} satisfies ExportedHandler<Bindings>;
