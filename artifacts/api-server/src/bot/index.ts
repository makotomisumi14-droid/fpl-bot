import TelegramBot from "node-telegram-bot-api";
import { db, registrationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getState, setState, clearState } from "./states";

const token = process.env["TELEGRAM_BOT_TOKEN"];
const adminId = process.env["ADMIN_TELEGRAM_ID"];

if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
if (!adminId) throw new Error("ADMIN_TELEGRAM_ID is required");

const ADMIN_ID = Number(adminId);
const SQUAD_ADMIN = "@Mayra_372";
const botToken: string = token;

const REGISTRATION_DEADLINE = new Date("2026-06-13T23:59:59+05:30"); // IST midnight
const MAX_CAPTAINS = 10;

// Singleton bot instance — webhook mode, no polling
let botInstance: TelegramBot | null = null;

export function getBot(): TelegramBot {
  if (!botInstance) {
    botInstance = new TelegramBot(botToken, { polling: false });
    registerHandlers(botInstance);
    logger.info("Telegram bot initialised (webhook mode)");
  }
  return botInstance;
}

export function startBot(): TelegramBot {
  return getBot();
}

function registerHandlers(bot: TelegramBot) {
  // /start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!userId) return;

    const existing = await db
      .select()
      .from(registrationsTable)
      .where(eq(registrationsTable.telegramUserId, String(userId)))
      .limit(1);

    if (existing.length > 0) {
      const reg = existing[0];
      const statusMsg =
        reg.status === "approved"
          ? "✅ Your registration has been *approved*! Welcome to the FPL Cricket League as a captain."
          : reg.status === "rejected"
            ? "❌ Your registration was *rejected*. Contact the admin for more info."
            : "⏳ Your registration is *pending* admin approval. Please wait.";
      await bot.sendMessage(chatId, statusMsg, { parse_mode: "Markdown" });
      return;
    }

    // Check deadline
    if (new Date() > REGISTRATION_DEADLINE) {
      await bot.sendMessage(
        chatId,
        `⏰ *Registrations are closed!*\n\nThe deadline was *13 June 2026*. No more captains can register.\n\nContact the admin for more information.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Check captain limit
    const approvedCount = await db
      .select()
      .from(registrationsTable)
      .where(eq(registrationsTable.status, "approved"));
    if (approvedCount.length >= MAX_CAPTAINS) {
      await bot.sendMessage(
        chatId,
        `🚫 *Registrations are full!*\n\nAll *${MAX_CAPTAINS} captain spots* have been filled. No more registrations are being accepted.\n\nContact the admin for more information.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    await bot.sendMessage(
      chatId,
      `🏏 *Welcome to FPL Cricket League!*\n\nYou can register as a *Captain* of your team.\n\nTo get started, please enter your *team name*:`,
      { parse_mode: "Markdown" }
    );
    setState(userId, { step: "awaiting_team_name" });
  });

  // /status command
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!userId) return;

    const existing = await db
      .select()
      .from(registrationsTable)
      .where(eq(registrationsTable.telegramUserId, String(userId)))
      .limit(1);

    if (existing.length === 0) {
      await bot.sendMessage(chatId, "You have not registered yet. Use /start to register.");
      return;
    }

    const reg = existing[0];
    const statusEmoji =
      reg.status === "approved" ? "✅" : reg.status === "rejected" ? "❌" : "⏳";
    await bot.sendMessage(
      chatId,
      `${statusEmoji} *Registration Status*\n\n👥 Team: *${reg.teamName}*\n👤 Username: @${reg.telegramUsername ?? "N/A"}\nStatus: *${reg.status.toUpperCase()}*`,
      { parse_mode: "Markdown" }
    );
  });

  // /listteams command — shows all approved teams (admin only)
  bot.onText(/\/listteams/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!userId || userId !== ADMIN_ID) {
      await bot.sendMessage(chatId, "⛔ This command is for admins only.");
      return;
    }

    const approved = await db
      .select()
      .from(registrationsTable)
      .where(eq(registrationsTable.status, "approved"))
      .orderBy(registrationsTable.createdAt);

    if (approved.length === 0) {
      await bot.sendMessage(chatId, "📋 No approved teams yet.");
      return;
    }

    const teamList = approved
      .map(
        (r, i) =>
          `${i + 1}. 🏏 *${r.teamName}*\n    👤 @${r.telegramUsername ?? "N/A"} | ID: \`${r.telegramUserId}\``
      )
      .join("\n\n");

    await bot.sendMessage(
      chatId,
      `✅ *Approved Teams (${approved.length})*\n\n${teamList}`,
      { parse_mode: "Markdown" }
    );
  });

  // /admin command — admin only, lists all registrations with approve/reject buttons
  bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!userId || userId !== ADMIN_ID) {
      await bot.sendMessage(chatId, "⛔ This command is for admins only.");
      return;
    }

    const all = await db.select().from(registrationsTable).orderBy(registrationsTable.createdAt);

    if (all.length === 0) {
      await bot.sendMessage(chatId, "📋 No registrations yet.");
      return;
    }

    const pending = all.filter((r) => r.status === "pending");
    const approved = all.filter((r) => r.status === "approved");
    const rejected = all.filter((r) => r.status === "rejected");

    const formatList = (items: typeof all) =>
      items
        .map(
          (r, i) =>
            `${i + 1}. *${r.teamName}* — @${r.telegramUsername ?? "N/A"} \`(${r.telegramUserId})\``
        )
        .join("\n");

    let text = `📋 *FPL League Registrations*\n\n`;
    text += `⏳ *Pending (${pending.length})*\n${pending.length ? formatList(pending) : "_None_"}\n\n`;
    text += `✅ *Approved (${approved.length})*\n${approved.length ? formatList(approved) : "_None_"}\n\n`;
    text += `❌ *Rejected (${rejected.length})*\n${rejected.length ? formatList(rejected) : "_None_"}`;

    await bot.sendMessage(chatId, text, { parse_mode: "Markdown" });

    for (const r of pending) {
      await bot.sendMessage(
        chatId,
        `⏳ *Pending:* ${r.teamName}\n👤 @${r.telegramUsername ?? "N/A"} | ID: \`${r.telegramUserId}\``,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Approve", callback_data: `approve_${r.telegramUserId}` },
                { text: "❌ Reject", callback_data: `reject_${r.telegramUserId}` },
              ],
            ],
          },
        }
      );
    }
  });

  // /announce command — admin only, broadcasts to all approved captains
  bot.onText(/\/announce (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!userId || userId !== ADMIN_ID) {
      await bot.sendMessage(chatId, "⛔ This command is for admins only.");
      return;
    }

    const announcement = match?.[1]?.trim();
    if (!announcement) {
      await bot.sendMessage(chatId, "Usage: /announce Your message here");
      return;
    }

    const approved = await db
      .select()
      .from(registrationsTable)
      .where(eq(registrationsTable.status, "approved"));

    if (approved.length === 0) {
      await bot.sendMessage(chatId, "📋 No approved captains to announce to yet.");
      return;
    }

    let sent = 0;
    let failed = 0;
    for (const captain of approved) {
      try {
        await bot.sendMessage(
          Number(captain.telegramUserId),
          `📢 *FPL Cricket League — Announcement*\n\n${announcement}`,
          { parse_mode: "Markdown" }
        );
        sent++;
      } catch {
        failed++;
      }
    }

    await bot.sendMessage(
      chatId,
      `✅ Announcement sent!\n\n📤 Delivered: *${sent}* captain(s)${failed > 0 ? `\n❌ Failed: *${failed}* (they may have blocked the bot)` : ""}`,
      { parse_mode: "Markdown" }
    );
  });

  // /cancel command
  bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!userId) return;
    clearState(userId);
    await bot.sendMessage(chatId, "Registration cancelled. Use /start to begin again.");
  });

  // Handle all messages for conversation flow
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!userId) return;

    if (msg.text?.startsWith("/")) return;

    const state = getState(userId);

    // Step 1: Team name
    if (state.step === "awaiting_team_name") {
      if (!msg.text || msg.text.trim().length < 2) {
        await bot.sendMessage(chatId, "Please enter a valid team name (at least 2 characters).");
        return;
      }
      setState(userId, { step: "awaiting_username", teamName: msg.text.trim() });
      await bot.sendMessage(
        chatId,
        `Great! Team name: *${msg.text.trim()}*\n\nNow please enter your *Telegram username* (e.g. @YourName):`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Step 2: Telegram username
    if (state.step === "awaiting_username") {
      if (!msg.text || msg.text.trim().length < 2) {
        await bot.sendMessage(chatId, "Please enter a valid Telegram username.");
        return;
      }
      const rawUsername = msg.text.trim().replace(/^@/, "");
      setState(userId, {
        step: "awaiting_logo",
        teamName: state.teamName,
        telegramUsername: rawUsername,
      });
      await bot.sendMessage(
        chatId,
        `Got it! Username: *@${rawUsername}*\n\nNow please send your *team logo* as a photo 📸`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Step 3: Logo photo
    if (state.step === "awaiting_logo") {
      if (!msg.photo || msg.photo.length === 0) {
        await bot.sendMessage(chatId, "Please send your team logo as a *photo* image.", {
          parse_mode: "Markdown",
        });
        return;
      }

      const photo = msg.photo[msg.photo.length - 1];
      const fileId = photo.file_id;
      const teamName = state.teamName!;
      const username = state.telegramUsername ?? msg.from?.username ?? null;

      try {
        await db.insert(registrationsTable).values({
          telegramUserId: String(userId),
          telegramUsername: username,
          teamName,
          logoFileId: fileId,
          status: "pending",
        });

        clearState(userId);

        await bot.sendMessage(
          chatId,
          `✅ *Registration submitted!*\n\nYour details:\n👤 Username: @${username ?? "N/A"}\n🏏 Team: *${teamName}*\n\nThe admin will review your registration. You'll be notified once approved or rejected.`,
          { parse_mode: "Markdown" }
        );

        const captionText =
          `🆕 *New Captain Registration Request*\n\n` +
          `👤 Username: @${username ?? "N/A"}\n` +
          `🆔 User ID: \`${userId}\`\n` +
          `🏏 Team: *${teamName}*\n\n` +
          `Use the buttons below to approve or reject:`;

        await bot.sendPhoto(ADMIN_ID, fileId, {
          caption: captionText,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Approve", callback_data: `approve_${userId}` },
                { text: "❌ Reject", callback_data: `reject_${userId}` },
              ],
            ],
          },
        });
      } catch (err: any) {
        if (err?.code === "23505" || (err?.message ?? "").includes("unique")) {
          clearState(userId);
          await bot.sendMessage(
            chatId,
            "You have already submitted a registration. Use /status to check your status."
          );
        } else {
          logger.error({ err }, "Failed to save registration");
          await bot.sendMessage(chatId, "Something went wrong. Please try again later.");
        }
      }
      return;
    }

    if (state.step === "idle") {
      await bot.sendMessage(
        chatId,
        "Use /start to register as a captain or /status to check your registration."
      );
    }
  });

  // Handle admin approve/reject callbacks
  bot.on("callback_query", async (query) => {
    const adminChatId = query.message?.chat.id;
    if (!adminChatId || adminChatId !== ADMIN_ID) {
      await bot.answerCallbackQuery(query.id, { text: "Unauthorized" });
      return;
    }

    const data = query.data ?? "";
    const [action, targetUserIdStr] = data.split("_");
    const targetUserId = Number(targetUserIdStr);

    if (!action || !targetUserId) return;

    if (action === "approve") {
      await db
        .update(registrationsTable)
        .set({ status: "approved" })
        .where(eq(registrationsTable.telegramUserId, String(targetUserId)));

      await bot.answerCallbackQuery(query.id, { text: "Approved!" });
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [[{ text: "✅ Approved", callback_data: "done" }]] },
        { chat_id: adminChatId, message_id: query.message?.message_id }
      );

      // Approval message + squad instructions
      await bot.sendMessage(
        targetUserId,
        `🎉 *Congratulations! Your registration has been APPROVED!*\n\nWelcome to *FPL Cricket League* as an official Captain! 🏏🏆\n\n` +
        `📋 *Next Step — Submit Your Squad*\n\n` +
        `Please make your squad of *12 players* and send it to the league admin:\n👉 ${SQUAD_ADMIN}\n\n` +
        `Your squad should include:\n` +
        `• Player names\n` +
        `• Their roles (Batsman / Bowler / All-rounder / Wicket-keeper)\n\n` +
        `Good luck! 🌟`,
        { parse_mode: "Markdown" }
      );
    } else if (action === "reject") {
      await db
        .update(registrationsTable)
        .set({ status: "rejected" })
        .where(eq(registrationsTable.telegramUserId, String(targetUserId)));

      await bot.answerCallbackQuery(query.id, { text: "Rejected." });
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [[{ text: "❌ Rejected", callback_data: "done" }]] },
        { chat_id: adminChatId, message_id: query.message?.message_id }
      );

      await bot.sendMessage(
        targetUserId,
        `❌ Unfortunately, your FPL Cricket League captain registration has been *rejected*.\n\nPlease contact the admin for more information.`,
        { parse_mode: "Markdown" }
      );
    }
  });
}
