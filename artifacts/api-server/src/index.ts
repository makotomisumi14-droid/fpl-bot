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

// On Replit (dev), don't touch the webhook — Railway owns it
const isRailway = Boolean(process.env["WEBHOOK_URL"]);
const isReplit = Boolean(process.env["REPLIT_DOMAINS"]);

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, isRailway, isReplit }, "Server listening");

  // Auto-create DB tables on startup
  try {
    await runMigrations();
    logger.info("Database migrations completed");
  } catch (migErr) {
    logger.error({ err: migErr }, "Database migration failed — bot may not work");
  }

  // Only start bot + register webhook on Railway
  // On Replit dev server, leave Railway's webhook alone
  if (!isRailway && isReplit) {
    logger.info("Running on Replit dev — skipping webhook registration (Railway owns it)");

    // Keep-alive ping so Replit doesn't sleep (useful while testing locally)
    const keepAliveUrl = `https://${process.env["REPLIT_DOMAINS"]!.split(",")[0]}/api/healthz`;
    setInterval(async () => {
      try {
        const res = await fetch(keepAliveUrl);
        logger.info({ status: res.status }, "Keep-alive ping sent");
      } catch (pingErr) {
        logger.warn({ err: pingErr }, "Keep-alive ping failed");
      }
    }, 4 * 60 * 1000);
    return;
  }

  // Railway: start bot + register webhook
  const bot = startBot();
  const webhookUrl = process.env["WEBHOOK_URL"]!;

  try {
    await bot.setWebHook(webhookUrl);
    logger.info({ webhookUrl }, "Telegram webhook registered");
  } catch (webhookErr) {
    logger.error({ err: webhookErr }, "Failed to register Telegram webhook");
  }
});
