import { createApp } from "./app";
import { createTelegramApi } from "./bot/telegramApi";
import { type Bindings, getConfig } from "./config/env";
import { getDb } from "./db/client";
import { runMaintenance } from "./services/maintenance";
import { runEmiCheckIns } from "./services/emiJob";
import { runLoanCheckIns } from "./services/loanJob";
import { runMandateChecks } from "./services/mandateJob";
import { runHoldingNudges, runUnitsCheckIns } from "./services/holdingsJob";
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
      const emi = await runEmiCheckIns({ db, telegram: createTelegramApi(config.TELEGRAM_BOT_TOKEN), now });
      logger.info("emi_instalments_added", { ...emi });
    } catch (error) {
      logger.error("emi_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
    try {
      const loanResult = await runLoanCheckIns({ db, telegram: createTelegramApi(config.TELEGRAM_BOT_TOKEN), now });
      logger.info("loan_instalments_added", { ...loanResult });
    } catch (error) {
      logger.error("loan_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
    try {
      const recurring = await runRecurring({ db, telegram: createTelegramApi(config.TELEGRAM_BOT_TOKEN), now });
      logger.info("recurring_done", { ...recurring });
    } catch (error) {
      logger.error("recurring_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
    try {
      const mandate = await runMandateChecks({ db, telegram: createTelegramApi(config.TELEGRAM_BOT_TOKEN), now });
      logger.info("mandate_checks_done", { ...mandate });
    } catch (error) {
      logger.error("mandate_checks_failed", { error: error instanceof Error ? error.message : "unknown" });
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
      const unitsResult = await runUnitsCheckIns({ db, telegram: createTelegramApi(config.TELEGRAM_BOT_TOKEN), now });
      logger.info("units_check_ins_done", { ...unitsResult });
    } catch (error) {
      logger.error("units_check_ins_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
    try {
      const valueResult = await runHoldingNudges({ db, telegram: createTelegramApi(config.TELEGRAM_BOT_TOKEN), now });
      logger.info("holding_nudges_done", { ...valueResult });
    } catch (error) {
      logger.error("holding_nudges_failed", { error: error instanceof Error ? error.message : "unknown" });
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
