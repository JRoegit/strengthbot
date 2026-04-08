import { randomUUID } from "node:crypto";
import {
  Attachment,
  Client,
  Events,
  GuildMember,
  GatewayIntentBits,
  Message
} from "discord.js";
import { config } from "./config.js";
import { VisionParser } from "./openaiParser.js";
import { SubmissionStore } from "./storage.js";
import type { StoredSubmission } from "./types.js";

type LeaderboardCategory = "packsOpened" | "battlesWon" | "incomePerSecond" | "bestCard";

type OpenAiLikeError = {
  status?: number;
  code?: string | null;
  type?: string | null;
  request_id?: string | null;
  error?: {
    code?: string | null;
    type?: string | null;
    message?: string | null;
  };
};

function isImageAttachment(attachment: Attachment): boolean {
  return attachment.contentType?.startsWith("image/")
    || /\.(png|jpe?g|webp|bmp)$/i.test(attachment.name ?? "");
}

async function extractFirstImage(message: Message): Promise<Attachment | null> {
  const imageAttachment = message.attachments.find((attachment) => isImageAttachment(attachment));
  return imageAttachment ?? null;
}

function isInsufficientQuotaError(error: unknown): error is OpenAiLikeError {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as OpenAiLikeError;
  return candidate.code === "insufficient_quota"
    || candidate.type === "insufficient_quota"
    || candidate.error?.code === "insufficient_quota"
    || candidate.error?.type === "insufficient_quota";
}

function isRetryableRateLimitError(error: unknown): error is OpenAiLikeError {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as OpenAiLikeError;
  return candidate.status === 429 && !isInsufficientQuotaError(candidate);
}

function isReadableParserError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("Could not parse numeric value")
    || error.message.includes("Unsupported numeric value")
    || error.message.includes("Parsed username was empty")
    || error.message.includes("Parsed submission contained an empty field")
    || error.message.includes("OpenAI response did not include output_text");
}

function buildSubmissionFailureReply(error: unknown): string {
  if (isInsufficientQuotaError(error)) {
    return [
      "\u26D4 **Submission failed**",
      "",
      "The parser is temporarily unavailable because the bot's OpenAI quota has been exhausted.",
      "Please try again later."
    ].join("\n");
  }

  if (isRetryableRateLimitError(error)) {
    return [
      "\u23F3 **Submission delayed**",
      "",
      "The parser is being rate limited right now.",
      "Please try again in a little while."
    ].join("\n");
  }

  if (isReadableParserError(error)) {
    return [
      "\u26A0\uFE0F **Submission failed**",
      "",
      "I couldn't read the screenshot clearly enough to save your stats.",
      "Please make sure the full blue stats box is visible and try again."
    ].join("\n");
  }

  return [
    "\u26A0\uFE0F **Submission failed**",
    "",
    "Something went wrong while processing your screenshot.",
    "Please try again later."
  ].join("\n");
}

function canRunBacklog(member: GuildMember | null): boolean {
  if (!config.backlogRoleId) {
    return false;
  }

  return member?.roles.cache.has(config.backlogRoleId) ?? false;
}

function formatStoredStatsMessage(): string {
  return [
    "## Your Stats",
    "",
    "👤 **Username:** {username}",
    "📦 **Packs Opened:** {packsOpened} {packsRank}",
    "⚔️ **Battles Won:** {battlesWon} {battlesRank}",
    "💸 **Cash/s:** {incomePerSecond} {cashRank}",
    "🃏 **Best Card:** {bestCard} {cardRank}"
  ].join("\n");
}

function formatRank(rank: number | null): string {
  if (rank === null) {
    return "";
  }

  return `**(#${rank})**`;
}

function buildMeReply(submission: StoredSubmission): string {
  return formatStoredStatsMessage()
    .replace("{username}", submission.username)
    .replace("{packsOpened}", formatLeaderboardValue("packsOpened", submission.packsOpened))
    .replace("{packsRank}", formatRank(store.getRankByUserId(submission.userId, "packsOpened")))
    .replace("{battlesWon}", formatLeaderboardValue("battlesWon", submission.battlesWon))
    .replace("{battlesRank}", formatRank(store.getRankByUserId(submission.userId, "battlesWon")))
    .replace("{incomePerSecond}", formatLeaderboardValue("incomePerSecond", submission.incomePerSecond))
    .replace("{cashRank}", formatRank(store.getRankByUserId(submission.userId, "incomePerSecond")))
    .replace("{bestCard}", formatLeaderboardValue("bestCard", submission.bestCard))
    .replace("{cardRank}", formatRank(store.getRankByUserId(submission.userId, "bestCard")));
}

function parseTopCategory(value: string): LeaderboardCategory | null {
  const normalized = value.trim().toLowerCase();

  if (normalized === "packs" || normalized === "pack" || normalized === "packsopened") {
    return "packsOpened";
  }

  if (normalized === "battles" || normalized === "battle" || normalized === "battleswon") {
    return "battlesWon";
  }

  if (normalized === "cash" || normalized === "income" || normalized === "incomepersecond") {
    return "incomePerSecond";
  }

  if (normalized === "card" || normalized === "bestcard") {
    return "bestCard";
  }

  return null;
}

function getCategoryLabel(category: LeaderboardCategory): string {
  switch (category) {
    case "packsOpened":
      return "Packs Opened";
    case "battlesWon":
      return "Battles Won";
    case "incomePerSecond":
      return "Cash/s";
    case "bestCard":
      return "Best Card";
  }
}

function formatCompactValue(value: string, currencyPrefix = false, perSecondSuffix = false): string {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;

  const suffixes = [
    "",
    "K",
    "M",
    "B",
    "T",
    "Qa",
    "Qd",
    "Qt",
    "Qi",
    "Sx",
    "Sp",
    "Oc",
    "No",
    "Dc"
  ];

  let divisor = 1n;
  let suffixIndex = 0;

  while (suffixIndex < suffixes.length - 1 && absolute >= divisor * 1000n) {
    divisor *= 1000n;
    suffixIndex += 1;
  }

  const whole = absolute / divisor;
  const remainder = absolute % divisor;
  let display = whole.toString();

  if (suffixIndex > 0 && remainder > 0n) {
    const decimals = ((remainder * 100n) / divisor).toString().padStart(2, "0").replace(/0+$/, "");
    if (decimals) {
      display = `${display}.${decimals}`;
    }
  }

  const prefix = currencyPrefix ? "$" : "";
  const suffix = `${suffixes[suffixIndex]}${perSecondSuffix ? "/s" : ""}`;
  const sign = negative ? "-" : "";

  return `${sign}${prefix}${display}${suffix}`;
}

function formatLeaderboardValue(category: LeaderboardCategory, value: string): string {
  if (category === "bestCard") {
    return formatCompactValue(value, true, true);
  }

  if (category === "incomePerSecond") {
    return formatCompactValue(value, false, true);
  }

  return formatCompactValue(value);
}

function buildTopReply(category: LeaderboardCategory): string {
  const topEntries = store.getTopByCategory(category, 10);

  if (topEntries.length === 0) {
    return `📭 There are no stored submissions yet for **${getCategoryLabel(category)}**.`;
  }

  const lines = topEntries.map((submission, index) => {
    const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "•";
    return `${medal} **${index + 1}. ${submission.username}** — ${formatLeaderboardValue(category, submission[category])}`;
  });

  return [`## Leaderboard`, `**Category:** ${getCategoryLabel(category)}`, "", ...lines].join("\n");
}

function buildHelpReply(): string {
  const lines = [
    "## Bot Commands",
    "",
    "❓ **.help** — Show this command list",
    "👤 **.me** — Show your currently stored stats and rankings",
    "🏆 **.top packs** — Show the top 10 by packs opened",
    "⚔️ **.top battles** — Show the top 10 by battles won",
    "💸 **.top cash** — Show the top 10 by cash per second",
    "🃏 **.top card** — Show the top 10 by best card"
  ];

  if (config.backlogRoleId) {
    lines.push("🛠️ **.backlog** — Admin-only backfill of missing users from submission history");
  }

  return lines.join("\n");
}

async function storeParsedSubmission(message: Message, imageUrl: string): Promise<StoredSubmission> {
  const { parsed, rawText } = await parser.parseImage(imageUrl);

  const submission: StoredSubmission = {
    id: randomUUID(),
    messageId: message.id,
    channelId: message.channelId,
    guildId: message.guildId,
    userId: message.author.id,
    submittedAt: message.createdAt.toISOString(),
    imageUrl,
    rawModelOutput: rawText,
    ...parsed
  };

  store.insert(submission);
  return submission;
}

async function runBacklog(commandMessage: Message): Promise<string> {
  const preflightError = await runBacklogPreflight(commandMessage);
  if (preflightError) {
    return preflightError;
  }

  const channel = await commandMessage.client.channels.fetch(config.discordChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    return "\u26A0\uFE0F I couldn't access the configured submission channel.";
  }

  const existingUserIds = new Set(store.list().map((submission) => submission.userId));
  const seenUserIds = new Set<string>();
  let lastMessageId: string | undefined;
  let scannedMessages = 0;
  let storedCount = 0;
  let skippedExistingCount = 0;
  let failedCount = 0;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before: lastMessageId });
    if (batch.size === 0) {
      break;
    }

    const messages = [...batch.values()];
    for (const historyMessage of messages) {
      scannedMessages += 1;

      if (historyMessage.author.bot) {
        continue;
      }

      if (seenUserIds.has(historyMessage.author.id)) {
        continue;
      }

      seenUserIds.add(historyMessage.author.id);

      if (existingUserIds.has(historyMessage.author.id)) {
        skippedExistingCount += 1;
        continue;
      }

      const image = await extractFirstImage(historyMessage);
      if (!image?.url) {
        continue;
      }

      try {
        await storeParsedSubmission(historyMessage, image.url);
        existingUserIds.add(historyMessage.author.id);
        storedCount += 1;
      } catch (error) {
        failedCount += 1;
        console.error(`Backlog failed for message ${historyMessage.id}`, error);
      }
    }

    lastMessageId = messages[messages.length - 1]?.id;
    if (!lastMessageId || batch.size < 100) {
      break;
    }
  }

  return [
    "## Backlog Complete",
    "",
    `📨 **Messages scanned:** ${scannedMessages}`,
    `✅ **New users imported:** ${storedCount}`,
    `⏭️ **Users skipped (already stored):** ${skippedExistingCount}`,
    `⚠️ **Failed imports:** ${failedCount}`
  ].join("\n");
}

async function runBacklogPreflight(commandMessage: Message): Promise<string | null> {
  if (!commandMessage.inGuild()) {
    return "\u26D4 `.backlog` can only be used inside the server.";
  }

  if (!config.backlogRoleId) {
    return "\u26A0\uFE0F `.backlog` is not configured yet. Set `BACKLOG_ROLE_ID` in the bot's environment.";
  }

  if (!canRunBacklog(commandMessage.member)) {
    return "\u26D4 You don't have permission to run `.backlog`.";
  }
  return null;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const store = new SubmissionStore(config.dataFile);
const parser = new VisionParser(config.openAiApiKey, config.openAiModel);

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Monitoring channel ${config.discordChannelId}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) {
    return;
  }

  if (message.content.trim().toLowerCase() === ".me") {
    const submission = store.getLatestByUserId(message.author.id);

    if (!submission) {
      await message.reply("📭 I don't have any stored stats for you yet. Submit a screenshot first.");
      return;
    }

    await message.reply(buildMeReply(submission));
    return;
  }

  if (message.content.trim().toLowerCase() === ".help") {
    await message.reply(buildHelpReply());
    return;
  }

  if (message.content.trim().toLowerCase() === ".backlog") {
    const permissionResult = await runBacklogPreflight(message);
    if (permissionResult) {
      await message.reply(permissionResult);
      return;
    }

    await message.reply("🛠️ Running backlog import. This may take a little while...");
    const result = await runBacklog(message);
    await message.reply(result);
    return;
  }

  if (message.content.trim().toLowerCase().startsWith(".top")) {
    const [, categoryInput = ""] = message.content.trim().split(/\s+/, 2);
    const category = parseTopCategory(categoryInput);

    if (!category) {
      await message.reply("ℹ️ Use `.top packs`, `.top battles`, `.top cash`, or `.top card`.");
      return;
    }

    await message.reply(buildTopReply(category));
    return;
  }

  if (message.channelId !== config.discordChannelId) {
    return;
  }

  if (store.hasMessage(message.id)) {
    return;
  }

  const image = await extractFirstImage(message);
  if (!image?.url) {
    return;
  }

  try {
    const submission = await storeParsedSubmission(message, image.url);

    await message.react("\u2705");
    console.log(`Stored submission for ${submission.username} from message ${message.id}`);
  } catch (error) {
    if (isInsufficientQuotaError(error)) {
      console.error("OpenAI quota exceeded. Check billing, credits, project limits, and the API key's project.");
      console.error(`Message ${message.id} could not be processed because the OpenAI project has insufficient quota.`);
      await message.react("\u26D4").catch(() => undefined);
      await message.reply(buildSubmissionFailureReply(error)).catch(() => undefined);
      return;
    }

    if (isRetryableRateLimitError(error)) {
      console.error(`OpenAI rate limited message ${message.id}. This is likely temporary.`, error);
      await message.react("\u23F3").catch(() => undefined);
      await message.reply(buildSubmissionFailureReply(error)).catch(() => undefined);
      return;
    }

    console.error(`Failed to parse message ${message.id}`, error);
    await message.react("\u26A0\uFE0F").catch(() => undefined);
    await message.reply(buildSubmissionFailureReply(error)).catch(() => undefined);
  }
});

client.login(config.discordToken);
