import app from "./app";
import { logger } from "./lib/logger";
import { startBot } from "./bot";
import { runMigrations } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Auto-create tables on startup (works on Railway and Replit)
  try {
    await runMigrations();
    logger.info("Database migrations completed");
  } catch (migErr) {
    logger.error({ err: migErr }, "Database migration failed");
  }

  // Initialise bot in webhook mode
  const bot = startBot();

  // Determine webhook URL — Railway sets WEBHOOK_URL, Replit sets REPLIT_DOMAINS
  const webhookUrl =
    process.env["WEBHOOK_URL"] ??
    (process.env["REPLIT_DOMAINS"]
      ? `https://${process.env["REPLIT_DOMAINS"].split(",")[0]}/api/telegram-webhook`
      : null);

  if (!webhookUrl) {
    logger.error("No webhook URL available — set WEBHOOK_URL or REPLIT_DOMAINS");
    return;
  }

  try {
    await bot.setWebHook(webhookUrl);
    logger.info({ webhookUrl }, "Telegram webhook registered");
  } catch (webhookErr) {
    logger.error({ err: webhookErr }, "Failed to register Telegram webhook");
  }

  // Keep-alive ping (only needed on Replit)
  if (process.env["REPLIT_DOMAINS"]) {
    const keepAliveUrl = `https://${process.env["REPLIT_DOMAINS"].split(",")[0]}/api/healthz`;
    setInterval(async () => {
      try {
        const res = await fetch(keepAliveUrl);
        logger.info({ status: res.status }, "Keep-alive ping sent");
      } catch (pingErr) {
        logger.warn({ err: pingErr }, "Keep-alive ping failed");
      }
    }, 4 * 60 * 1000);
    logger.info({ keepAliveUrl }, "Keep-alive pinger started");
  }
});
