import { createApp } from "./app";
import { createTelegramApi } from "./bot/telegramApi";
import { type Bindings, getConfig } from "./config/env";
import { getDb } from "./db/client";
import { runMaintenance } from "./services/maintenance";
import { materializeAllEmi } from "./services/emi";
import { runDebtReminders } from "./services/debtJob";
import { runRecurring } from "./services/recurringJob";
import { runHoldReminders, runNudges } from "./services/nudges";
import { todayIst } from "./domain/dates";
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

    // Instalments first, so a statement that has just come round already holds its EMI when reminders are worked out.
    try {
      const added = await materializeAllEmi(db, todayIst(new Date(now())), (error) =>
        logger.error("emi_user_failed", { error: error instanceof Error ? error.message : "unknown" }),
      );
      logger.info("emi_instalments_added", { added });
    } catch (error) {
      logger.error("emi_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
    try {
      const recurring = await runRecurring({ db, telegram: createTelegramApi(config.TELEGRAM_BOT_TOKEN), now });
      logger.info("recurring_done", { ...recurring });
    } catch (error) {
      logger.error("recurring_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
    try {
      const debtsResult = await runDebtReminders({ db, telegram: createTelegramApi(config.TELEGRAM_BOT_TOKEN), now });
      logger.info("debt_reminders_done", { ...debtsResult });
    } catch (error) {
      logger.error("debt_reminders_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
    try {
      const result = await runNudges({ db, telegram: createTelegramApi(config.TELEGRAM_BOT_TOKEN), now });
      logger.info("nudges_done", { ...result });
    } catch (error) {
      logger.error("nudges_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
    try {
      const holdsResult = await runHoldReminders({ db, telegram: createTelegramApi(config.TELEGRAM_BOT_TOKEN), now });
      logger.info("hold_reminders_done", { ...holdsResult });
    } catch (error) {
      logger.error("hold_reminders_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
    try {
      await runMaintenance(db, now());
    } catch (error) {
      logger.error("maintenance_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  },
} satisfies ExportedHandler<Bindings>;
