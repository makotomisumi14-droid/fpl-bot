import app from "./app";
import { logger } from "./lib/logger";
import { startBot } from "./bot";

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

  // Initialise bot in webhook mode
  const bot = startBot();

  // Register webhook with Telegram
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (!domain) {
    logger.error("REPLIT_DOMAINS not set — cannot register Telegram webhook");
    return;
  }

  const webhookUrl = `https://${domain}/api/telegram-webhook`;
  try {
    await bot.setWebHook(webhookUrl);
    logger.info({ webhookUrl }, "Telegram webhook registered");
  } catch (webhookErr) {
    logger.error({ err: webhookErr }, "Failed to register Telegram webhook");
  }

  // Keep-alive: ping the health endpoint every 4 minutes so Replit never sleeps
  const keepAliveUrl = `https://${domain}/api/healthz`;
  setInterval(async () => {
    try {
      const res = await fetch(keepAliveUrl);
      logger.info({ status: res.status }, "Keep-alive ping sent");
    } catch (pingErr) {
      logger.warn({ err: pingErr }, "Keep-alive ping failed");
    }
  }, 4 * 60 * 1000); // every 4 minutes

  logger.info({ keepAliveUrl }, "Keep-alive pinger started");
});
