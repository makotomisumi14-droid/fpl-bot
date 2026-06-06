import { Router } from "express";
import { getBot } from "../bot";
import { logger } from "../lib/logger";

const router = Router();

router.post("/telegram-webhook", (req, res) => {
  res.sendStatus(200);
  try {
    getBot().processUpdate(req.body);
  } catch (err) {
    logger.error({ err }, "Error processing Telegram update");
  }
});

export default router;
