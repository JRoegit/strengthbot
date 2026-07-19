import { randomUUID } from "node:crypto";
import {
  Attachment,
  AttachmentBuilder,
  Client,
  Events,
  GuildMember,
  GatewayIntentBits,
  Message,
  Partials
} from "discord.js";
import { BlacklistStore } from "./blacklistStore.js";
import { config } from "./config.js";
import { parseCompactNumberToString, parseDurationToSecondsString, subtractClamped } from "./numberUtils.js";
import { PenaltyStore } from "./penaltyStore.js";
import { ScheduleStore } from "./scheduleStore.js";
import { VisionParser } from "./openaiParser.js";
import { SubmissionStore } from "./storage.js";
import type { SortableSubmissionField } from "./storage.js";
import type { PenaltyProfile, ScheduledMessage, StoredSubmission } from "./types.js";

type LeaderboardCategory = SortableSubmissionField;

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

const DISCORD_INVITE_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.com\/invite|discord\.gg)\/[a-z0-9-]+/i;
const COMMAND_PREFIX = ".";
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const commandChannelIds = new Set(config.commandChannelIds);

function isImageAttachment(attachment: Attachment): boolean {
  return attachment.contentType?.startsWith("image/")
    || /\.(png|jpe?g|webp|bmp)$/i.test(attachment.name ?? "");
}

async function extractFirstImage(message: Message): Promise<Attachment | null> {
  const imageAttachment = message.attachments.find((attachment) => isImageAttachment(attachment));
  return imageAttachment ?? null;
}

function containsDiscordInvite(content: string): boolean {
  return DISCORD_INVITE_PATTERN.test(content);
}

function isCommandMessage(content: string): boolean {
  return content.trim().startsWith(COMMAND_PREFIX);
}

function canUseCommandsInChannel(channelId: string): boolean {
  return commandChannelIds.has(channelId);
}

async function handleInviteSpam(message: Message): Promise<boolean> {
  if (!message.inGuild()) {
    return false;
  }

  if (!containsDiscordInvite(message.content)) {
    return false;
  }

  try {
    await message.delete();
  } catch (error) {
    console.error(`Failed to delete invite spam message ${message.id}`, error);
  }

  try {
    await message.guild.members.ban(message.author.id, {
      deleteMessageSeconds: 7 * 24 * 60 * 60,
      reason: `Posted a Discord invite link in #${message.channelId}`
    });
    console.log(`Banned ${message.author.tag} (${message.author.id}) for posting a Discord invite link in ${message.channelId}.`);
  } catch (error) {
    console.error(`Failed to ban ${message.author.tag} (${message.author.id}) for invite spam`, error);
  }

  return true;
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
    || error.message.includes("Could not parse duration value")
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

function canRunDevCommand(member: GuildMember | null): boolean {
  if (!config.devRoleId) {
    return false;
  }

  return member?.roles.cache.has(config.devRoleId) ?? false;
}

function formatStoredStatsMessage(): string {
  return [
    "## Your Stats",
    "",
    "👤 **Username:** {username}",
    "💪 **Highest Strength:** {highestStrength} {strengthRank}",
    "🏆 **Highest Wins:** {highestWins} {winsRank}",
    "🔄 **Rebirths:** {rebirths} {rebirthsRank}",
    "⏱️ **Time Played:** {timePlayed} {timeRank}"
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
    .replace("{highestStrength}", formatLeaderboardValue("highestStrength", submission.highestStrength))
    .replace("{strengthRank}", formatRank(store.getRankByUserId(submission.userId, "highestStrength")))
    .replace("{highestWins}", formatLeaderboardValue("highestWins", submission.highestWins))
    .replace("{winsRank}", formatRank(store.getRankByUserId(submission.userId, "highestWins")))
    .replace("{rebirths}", formatLeaderboardValue("rebirths", submission.rebirths))
    .replace("{rebirthsRank}", formatRank(store.getRankByUserId(submission.userId, "rebirths")))
    .replace("{timePlayed}", formatLeaderboardValue("timePlayed", submission.timePlayed))
    .replace("{timeRank}", formatRank(store.getRankByUserId(submission.userId, "timePlayed")));
}

function parseTopCategory(value: string): LeaderboardCategory | null {
  const normalized = value.trim().toLowerCase();

  if (normalized === "strength" || normalized === "higheststrength") {
    return "highestStrength";
  }

  if (normalized === "wins" || normalized === "win" || normalized === "highestwins") {
    return "highestWins";
  }

  if (normalized === "rebirth" || normalized === "rebirths") {
    return "rebirths";
  }

  if (normalized === "time" || normalized === "timeplayed" || normalized === "playtime") {
    return "timePlayed";
  }

  return null;
}

function parseSettableStatName(value: string): SortableSubmissionField | null {
  const normalized = value.trim().toLowerCase();

  if (normalized === "strength" || normalized === "higheststrength") {
    return "highestStrength";
  }

  if (normalized === "wins" || normalized === "win" || normalized === "highestwins") {
    return "highestWins";
  }

  if (normalized === "rebirth" || normalized === "rebirths") {
    return "rebirths";
  }

  if (normalized === "time" || normalized === "timeplayed" || normalized === "playtime") {
    return "timePlayed";
  }

  return null;
}

function getCategoryLabel(category: LeaderboardCategory): string {
  switch (category) {
    case "highestStrength":
      return "Highest Strength";
    case "highestWins":
      return "Highest Wins";
    case "rebirths":
      return "Rebirths";
    case "timePlayed":
      return "Time Played";
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
    "Qt",
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

function formatDurationValue(value: string): string {
  let remaining = BigInt(value);
  const days = remaining / 86_400n;
  remaining %= 86_400n;
  const hours = remaining / 3_600n;
  remaining %= 3_600n;
  const minutes = remaining / 60n;
  const seconds = remaining % 60n;

  const parts: string[] = [];
  if (days > 0n) {
    parts.push(`${days}d`);
  }
  if (hours > 0n) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0n) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0n || parts.length === 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ");
}

function formatLeaderboardValue(category: LeaderboardCategory, value: string): string {
  if (category === "timePlayed") {
    return formatDurationValue(value);
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

function escapeCsvField(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function buildLeaderboardCsv(category: LeaderboardCategory): Buffer {
  const rows = store.getTopByCategory(category, 10).map((submission) => [
    submission.vip ? "true" : "false",
    escapeCsvField(submission.username),
    escapeCsvField(formatLeaderboardValue(category, submission[category]))
  ].join(","));

  return Buffer.from(["IsVIP,Name,Value", ...rows].join("\r\n"), "utf8");
}

function getCategoryFileName(category: LeaderboardCategory): string {
  switch (category) {
    case "highestStrength":
      return "strength";
    case "highestWins":
      return "wins";
    case "rebirths":
      return "rebirths";
    case "timePlayed":
      return "time";
  }
}

function buildHelpReply(): string {
  const lines = [
    "## Bot Commands",
    "",
    "❓ **.help** — Show this command list",
    "👤 **.me** — Show your currently stored stats and rankings",
    "🔎 **.user <playerId|username>** — Look up another player's stored stats",
    "🏆 **.top strength** — Show the top 10 by highest strength",
    "🏆 **.top wins** — Show the top 10 by highest wins",
    "🏆 **.top rebirths** — Show the top 10 by rebirths",
    "🏆 **.top time** — Show the top 10 by time played"
  ];

  if (config.devRoleId) {
    lines.push("🛠️ **.backlog** — Admin-only backfill of missing users from submission history");
  }

  if (config.devRoleId) {
    lines.push("🧹 **.remove <playerId>** — Dev-only removal of a stored player entry");
    lines.push("⚖️ **.penalize <playerId> <strength> <wins> <rebirths> <time>** — Dev-only deductions applied on future submissions");
    lines.push("🖼️ **.submission <playerId|username>** — Dev-only lookup of the stored submission image");
    lines.push("🗑️ **.purge** — Dev-only cleanup of submissions whose stored image no longer exists");
  }

  if (config.devRoleId) {
    lines.push("📝 **.set <playerId> <statname> <quantity>** — Dev-only override of one stored stat");
  }

  if (config.devRoleId) {
    lines.push("\u{1F6AB} **.blacklist <playerId>** — Dev-only removal plus future submission blocking");
  }

  if (config.devRoleId) {
    lines.push("\u{1F4C4} **.csv <statname>** \u2014 Dev-only top 10 CSV export for one stat");
    lines.push("\u{1F4C5} **.schedule <epochtime> <channelId> <message>** \u2014 Dev-only scheduled message");
  }

  if (config.devRoleId && config.vipRoleId) {
    lines.push("\u2B50 **.vip @playername** — Dev-only VIP role and leaderboard access");
  }

  return lines.join("\n");
}

function applyPenalty(submission: StoredSubmission, penalty: PenaltyProfile | null): StoredSubmission {
  if (!penalty) {
    return submission;
  }

  return {
    ...submission,
    highestStrength: subtractClamped(submission.highestStrength, penalty.highestStrength),
    highestWins: subtractClamped(submission.highestWins, penalty.highestWins),
    rebirths: subtractClamped(submission.rebirths, penalty.rebirths),
    timePlayed: subtractClamped(submission.timePlayed, penalty.timePlayed)
  };
}

async function storeParsedSubmission(message: Message, imageUrl: string): Promise<StoredSubmission> {
  const { parsed, rawText } = await parser.parseImage(imageUrl);
  const existingSubmission = store.getLatestByUserId(message.author.id);

  const submission: StoredSubmission = {
    id: randomUUID(),
    messageId: message.id,
    channelId: message.channelId,
    guildId: message.guildId,
    userId: message.author.id,
    submittedAt: message.createdAt.toISOString(),
    imageUrl,
    rawModelOutput: rawText,
    vip: existingSubmission?.vip ?? false,
    ...parsed
  };

  const penalizedSubmission = applyPenalty(submission, penaltyStore.getByUserId(message.author.id));
  store.insert(penalizedSubmission);
  return penalizedSubmission;
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
  let skippedBlacklistedCount = 0;
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

      if (blacklistStore.hasUserId(historyMessage.author.id)) {
        skippedBlacklistedCount += 1;
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

  if (!config.devRoleId) {
    return "\u26A0\uFE0F `.backlog` is not configured yet. Set `DEV_ROLE_ID` in the bot's environment.";
  }

  if (!canRunDevCommand(commandMessage.member)) {
    return "\u26D4 You don't have permission to run `.backlog`.";
  }
  return null;
}

function runDevCommandPreflight(commandMessage: Message, commandName: string): string | null {
  if (!commandMessage.inGuild()) {
    return `\u26D4 \`${commandName}\` can only be used inside the server.`;
  }

  if (!config.devRoleId) {
    return `\u26A0\uFE0F \`${commandName}\` is not configured yet. Set \`DEV_ROLE_ID\` in the bot's environment.`;
  }

  if (!canRunDevCommand(commandMessage.member)) {
    return `\u26D4 You don't have permission to run \`${commandName}\`.`;
  }

  return null;
}

function runVipCommandPreflight(commandMessage: Message): string | null {
  const devCommandError = runDevCommandPreflight(commandMessage, ".vip");
  if (devCommandError) {
    return devCommandError;
  }

  if (!config.vipRoleId) {
    return "\u26A0\uFE0F `.vip` is not configured yet. Set `VIP_ROLE_ID` in the bot's environment.";
  }

  return null;
}

function buildPenalizeUsageReply(): string {
  return "ℹ️ Use `.penalize <playerId> <strength> <wins> <rebirths> <time>`.";
}

function buildSetUsageReply(): string {
  return "\u2139\uFE0F Use `.set <playerId> <statname> <quantity>`. Stat names: `strength`, `wins`, `rebirths`, `time`.";
}

function findSubmissionByLookup(lookup: string): StoredSubmission | null {
  const trimmedLookup = lookup.trim();
  if (!trimmedLookup) {
    return null;
  }

  const byUserId = store.getLatestByUserId(trimmedLookup);
  if (byUserId) {
    return byUserId;
  }

  return store.getLatestByUsername(trimmedLookup);
}

async function imageStillExists(imageUrl: string): Promise<boolean> {
  try {
    const headResponse = await fetch(imageUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000)
    });

    if (headResponse.ok) {
      return true;
    }

    if (headResponse.status !== 405) {
      return false;
    }
  } catch {
    // Fall through to a GET request in case HEAD is unsupported or blocked.
  }

  try {
    const getResponse = await fetch(imageUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000)
    });

    return getResponse.ok;
  } catch {
    return false;
  }
}

async function runPurgeSubmissions(): Promise<string> {
  const submissions = store.list();
  let checkedCount = 0;
  let removedCount = 0;

  for (const submission of submissions) {
    checkedCount += 1;

    if (!submission.imageUrl) {
      continue;
    }

    const exists = await imageStillExists(submission.imageUrl);
    if (exists) {
      continue;
    }

    store.removeByUserId(submission.userId);
    removedCount += 1;
  }

  return [
    "## Purge Complete",
    "",
    `🧾 **Submissions checked:** ${checkedCount}`,
    `🗑️ **Removed submissions:** ${removedCount}`,
    `✅ **Remaining submissions:** ${checkedCount - removedCount}`
  ].join("\n");
}

function parsePenaltyArguments(content: string): {
  userId: string;
  highestStrength: string;
  highestWins: string;
  rebirths: string;
  timePlayed: string;
} {
  const [, userId = "", strength = "", wins = "", rebirths = "", time = ""] = content.trim().split(/\s+/);

  if (!userId || !strength || !wins || !rebirths || !time) {
    throw new Error("Missing penalty arguments.");
  }

  return {
    userId,
    highestStrength: parseCompactNumberToString(strength),
    highestWins: parseCompactNumberToString(wins),
    rebirths: parseCompactNumberToString(rebirths),
    timePlayed: parseDurationToSecondsString(time)
  };
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [
    Partials.Message,
    Partials.Channel
  ]
});

const store = new SubmissionStore(config.dataFile);
const penaltyStore = new PenaltyStore(config.penaltyFile);
const blacklistStore = new BlacklistStore(config.blacklistFile);
const scheduleStore = new ScheduleStore(config.scheduleFile);
const parser = new VisionParser(config.openAiApiKey, config.openAiModel);

let scheduleTimer: NodeJS.Timeout | null = null;
let isDeliveringScheduledMessages = false;

function armScheduleTimer(): void {
  if (scheduleTimer) {
    clearTimeout(scheduleTimer);
    scheduleTimer = null;
  }

  const nextSchedule = scheduleStore.list()[0];
  if (!nextSchedule) {
    return;
  }

  const delay = Math.min(Math.max(nextSchedule.sendAt - Date.now(), 0), MAX_TIMER_DELAY_MS);
  scheduleTimer = setTimeout(() => {
    scheduleTimer = null;
    void deliverDueScheduledMessages();
  }, delay);
}

async function deliverDueScheduledMessages(): Promise<void> {
  if (isDeliveringScheduledMessages) {
    return;
  }

  isDeliveringScheduledMessages = true;

  try {
    const dueSchedules = scheduleStore.list().filter((schedule) => schedule.sendAt <= Date.now());

    for (const schedule of dueSchedules) {
      try {
        const channel = await client.channels.fetch(schedule.channelId);
        if (!channel || !channel.isSendable() || channel.isDMBased() || channel.guildId !== schedule.guildId) {
          throw new Error("The scheduled channel is unavailable or is not a sendable server channel.");
        }

        await channel.send(schedule.content);
        console.log(`Sent scheduled message ${schedule.id} to channel ${schedule.channelId}.`);
      } catch (error) {
        console.error(`Failed to send scheduled message ${schedule.id} to channel ${schedule.channelId}`, error);
      } finally {
        scheduleStore.removeById(schedule.id);
      }
    }
  } finally {
    isDeliveringScheduledMessages = false;
    armScheduleTimer();
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Monitoring submission channel ${config.discordChannelId}`);
  console.log(`Command channels: ${config.commandChannelIds.join(", ")}`);
  armScheduleTimer();
});

client.on(Events.MessageDelete, async (message) => {
  if (message.channelId !== config.discordChannelId) {
    return;
  }

  const removedSubmission = store.removeByMessageId(message.id);
  if (!removedSubmission) {
    return;
  }

  console.log(`Removed submission for ${removedSubmission.username} because message ${message.id} was deleted.`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) {
    return;
  }

  if (await handleInviteSpam(message)) {
    return;
  }

  if (isCommandMessage(message.content) && !canUseCommandsInChannel(message.channelId)) {
    await message.reply("Commands can only be used in the configured command channel.").catch(() => undefined);
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

  if (message.content.trim().toLowerCase().startsWith(".user")) {
    const lookup = message.content.trim().slice(".user".length).trim();
    if (!lookup) {
      await message.reply("ℹ️ Use `.user <playerId>` or `.user <username>`.");
      return;
    }

    const submission = findSubmissionByLookup(lookup);
    if (!submission) {
      await message.reply(`📭 I couldn't find any stored stats for **${lookup}**.`);
      return;
    }

    await message.reply(buildMeReply(submission));
    return;
  }

  if (message.content.trim().toLowerCase() === ".help") {
    await message.reply(buildHelpReply());
    return;
  }

  if (/^\.vip(?:\s|$)/i.test(message.content.trim())) {
    const permissionResult = runVipCommandPreflight(message);
    if (permissionResult) {
      await message.reply(permissionResult);
      return;
    }

    const mentionedUser = message.mentions.users.first();
    if (!mentionedUser) {
      await message.reply("\u2139\uFE0F Use `.vip @playername` and tag the Discord member who should receive VIP.");
      return;
    }

    const targetMember = message.mentions.members?.get(mentionedUser.id)
      ?? await message.guild!.members.fetch(mentionedUser.id).catch(() => null);
    if (!targetMember) {
      await message.reply("\u26A0\uFE0F I couldn't find that member in this server.");
      return;
    }

    if (mentionedUser.bot) {
      await message.reply("\u26A0\uFE0F VIP can only be given to a player, not a bot.");
      return;
    }

    try {
      await targetMember.roles.add(config.vipRoleId, `VIP granted by ${message.author.tag} (${message.author.id})`);

      let submission = store.setVipByUserId(mentionedUser.id, true);
      const createdSubmission = submission === null;

      if (!submission) {
        submission = {
          id: randomUUID(),
          messageId: `vip:${mentionedUser.id}`,
          channelId: message.channelId,
          guildId: message.guildId,
          userId: mentionedUser.id,
          submittedAt: new Date().toISOString(),
          imageUrl: "",
          rawModelOutput: "",
          username: targetMember.displayName,
          highestStrength: "0",
          highestWins: "0",
          rebirths: "0",
          timePlayed: "0",
          vip: true
        };
        store.insert(submission);
      }

      await message.reply([
        "\u2B50 **VIP granted**",
        "",
        `**Player:** ${targetMember}`,
        `**Leaderboard entry:** ${createdSubmission ? "Created with all stats set to 0" : "Existing submission marked as VIP"}`,
        "The configured VIP role has been added."
      ].join("\n"));
      return;
    } catch (error) {
      console.error(`Failed to grant VIP to ${mentionedUser.tag} (${mentionedUser.id})`, error);
      await message.reply("\u26A0\uFE0F I couldn't grant VIP. Check that the bot has Manage Roles and that its highest role is above the configured VIP role.");
      return;
    }
  }

  if (message.content.trim().toLowerCase().startsWith(".penalize")) {
    const permissionResult = runDevCommandPreflight(message, ".penalize");
    if (permissionResult) {
      await message.reply(permissionResult);
      return;
    }

    try {
      const penaltyArgs = parsePenaltyArguments(message.content);
      const penalty: PenaltyProfile = {
        ...penaltyArgs,
        updatedAt: new Date().toISOString()
      };

      penaltyStore.upsert(penalty);

      await message.reply([
        "⚖️ **Penalty saved**",
        "",
        `**Player ID:** ${penalty.userId}`,
        "These deductions will be applied to future submissions from this Discord user.",
        `**Highest Strength deduction:** ${formatCompactValue(penalty.highestStrength)}`,
        `**Highest Wins deduction:** ${formatCompactValue(penalty.highestWins)}`,
        `**Rebirths deduction:** ${formatCompactValue(penalty.rebirths)}`,
        `**Time Played deduction:** ${formatDurationValue(penalty.timePlayed)}`
      ].join("\n"));
      return;
    } catch (error) {
      if (error instanceof Error && (error.message.includes("Missing penalty arguments.") || error.message.includes("Could not parse numeric value") || error.message.includes("Could not parse duration value") || error.message.includes("Unsupported numeric value"))) {
        await message.reply(`${buildPenalizeUsageReply()} Numeric values can use suffixes like \`1.2K\`, \`3M\`, or \`4Qa\`; time can use values like \`15m30s\`, \`2h\`, or \`1:30:00\`.`);
        return;
      }

      console.error("Failed to save penalty", error);
      await message.reply("⚠️ I couldn't save that penalty. Please try again.");
      return;
    }
  }

  if (message.content.trim().toLowerCase().startsWith(".submission")) {
    const permissionResult = runDevCommandPreflight(message, ".submission");
    if (permissionResult) {
      await message.reply(permissionResult);
      return;
    }

    const lookup = message.content.trim().slice(".submission".length).trim();
    if (!lookup) {
      await message.reply("ℹ️ Use `.submission <playerId>` or `.submission <username>`.");
      return;
    }

    const submission = findSubmissionByLookup(lookup);
    if (!submission) {
      await message.reply(`📭 I couldn't find a stored submission for **${lookup}**.`);
      return;
    }

    if (!submission.imageUrl) {
      await message.reply(`\u{1F4ED} **${submission.username}** has a leaderboard entry, but no submission image yet.`);
      return;
    }

    await message.reply({
      content: [
        "🖼️ **Stored Submission Image**",
        "",
        `**Username:** ${submission.username}`,
        `**Player ID:** ${submission.userId}`
      ].join("\n"),
      files: [
        new AttachmentBuilder(submission.imageUrl)
      ]
    });
    return;
  }

  if (message.content.trim().toLowerCase() === ".purge") {
    const permissionResult = runDevCommandPreflight(message, ".purge");
    if (permissionResult) {
      await message.reply(permissionResult);
      return;
    }

    await message.reply("🧹 Checking stored submission images. This may take a little while...");
    const result = await runPurgeSubmissions();
    await message.reply(result);
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

  if (message.content.trim().toLowerCase().startsWith(".blacklist")) {
    const permissionResult = runDevCommandPreflight(message, ".blacklist");
    if (permissionResult) {
      await message.reply(permissionResult);
      return;
    }

    const [, playerId = ""] = message.content.trim().split(/\s+/, 2);
    if (!playerId) {
      await message.reply("ℹ️ Use `.blacklist <playerId>` to remove a stored entry and ignore future submissions from that Discord user.");
      return;
    }

    const removedSubmission = store.removeByUserId(playerId);
    blacklistStore.add({
      userId: playerId,
      blacklistedAt: new Date().toISOString()
    });

    if (!removedSubmission) {
      await message.reply([
        "🚫 **User blacklisted**",
        "",
        `**Player ID:** ${playerId}`,
        "There was no current stored submission to remove, but future submissions from this user will now be ignored."
      ].join("\n"));
      return;
    }

    await message.reply([
      "🚫 **User blacklisted**",
      "",
      `**Username:** ${removedSubmission.username}`,
      `**Player ID:** ${removedSubmission.userId}`,
      "Their stored submission was removed and future submissions from this user will now be ignored."
    ].join("\n"));
    return;
  }

  if (message.content.trim().toLowerCase().startsWith(".remove")) {
    const permissionResult = runDevCommandPreflight(message, ".remove");
    if (permissionResult) {
      await message.reply(permissionResult);
      return;
    }

    const [, playerId = ""] = message.content.trim().split(/\s+/, 2);
    if (!playerId) {
      await message.reply("ℹ️ Use `.remove <playerId>` to remove a stored entry by Discord user ID.");
      return;
    }

    const removedSubmission = store.removeByUserId(playerId);
    if (!removedSubmission) {
      await message.reply(`📭 No stored entry was found for player ID **${playerId}**.`);
      return;
    }

    await message.reply(`🧹 Removed stored entry for **${removedSubmission.username}** (${removedSubmission.userId}).`);
    return;
  }

  if (message.content.trim().toLowerCase().startsWith(".set")) {
    const permissionResult = runDevCommandPreflight(message, ".set");
    if (permissionResult) {
      await message.reply(permissionResult);
      return;
    }

    const [, playerId = "", statName = "", quantity = ""] = message.content.trim().split(/\s+/, 4);
    if (!playerId || !statName || !quantity) {
      await message.reply(buildSetUsageReply());
      return;
    }

    const category = parseSettableStatName(statName);
    if (!category) {
      await message.reply(buildSetUsageReply());
      return;
    }

    try {
      const normalizedQuantity = category === "timePlayed"
        ? parseDurationToSecondsString(quantity)
        : parseCompactNumberToString(quantity);
      const updatedSubmission = store.updateStatByUserId(playerId, category, normalizedQuantity);

      if (!updatedSubmission) {
        await message.reply(`No stored entry was found for player ID **${playerId}**.`);
        return;
      }

      await message.reply([
        "\u{1F4DD} **Stat updated**",
        "",
        `**Username:** ${updatedSubmission.username}`,
        `**Player ID:** ${updatedSubmission.userId}`,
        `**${getCategoryLabel(category)}:** ${formatLeaderboardValue(category, updatedSubmission[category])}`
      ].join("\n"));
      return;
    } catch (error) {
      if (error instanceof Error && (error.message.includes("Could not parse numeric value") || error.message.includes("Could not parse duration value") || error.message.includes("Unsupported numeric value"))) {
        await message.reply(`${buildSetUsageReply()} Quantities can use suffixes like \`1.23K\`, \`4M\`, or \`2Qa\`; time can use values like \`15m30s\`, \`2h\`, or \`1:30:00\`.`);
        return;
      }

      console.error("Failed to set stored stat", error);
      await message.reply("\u26A0\uFE0F I couldn't update that stored stat. Please try again.");
      return;
    }
  }

  if (/^\.schedule(?:\s|$)/i.test(message.content.trim())) {
    const permissionResult = runDevCommandPreflight(message, ".schedule");
    if (permissionResult) {
      await message.reply(permissionResult);
      return;
    }

    const scheduleMatch = message.content.trim().match(/^\.schedule\s+(\S+)\s+(\S+)\s+([\s\S]+)$/i);
    if (!scheduleMatch) {
      await message.reply("\u2139\uFE0F Use `.schedule <epochtime> <channelId> <message>`. The epoch time must be in seconds.");
      return;
    }

    const [, epochInput, channelInput, scheduledContent] = scheduleMatch;
    const channelMentionMatch = channelInput.match(/^<#(\d+)>$/);
    const channelId = channelMentionMatch?.[1] ?? channelInput;
    const sendAtSeconds = /^\d+$/.test(epochInput) ? Number(epochInput) : Number.NaN;
    const sendAt = sendAtSeconds * 1000;

    if (!Number.isSafeInteger(sendAtSeconds) || !Number.isSafeInteger(sendAt) || Number.isNaN(new Date(sendAt).getTime())) {
      await message.reply("\u26A0\uFE0F The epoch time must be a valid Unix timestamp in seconds.");
      return;
    }

    if (sendAt <= Date.now()) {
      await message.reply("\u26A0\uFE0F The scheduled time must be in the future.");
      return;
    }

    if (!/^\d+$/.test(channelId)) {
      await message.reply("\u26A0\uFE0F The channel ID must be a valid Discord channel ID or channel mention.");
      return;
    }

    if (scheduledContent.length > 2_000) {
      await message.reply("\u26A0\uFE0F The scheduled message cannot be longer than 2,000 characters.");
      return;
    }

    const targetChannel = await message.client.channels.fetch(channelId).catch(() => null);
    if (!targetChannel || !targetChannel.isSendable() || targetChannel.isDMBased() || targetChannel.guildId !== message.guildId) {
      await message.reply("\u26A0\uFE0F I can't send messages to that channel. Make sure it is a message channel in this server and that I can access it.");
      return;
    }

    const schedule: ScheduledMessage = {
      id: randomUUID(),
      guildId: message.guildId!,
      channelId,
      content: scheduledContent,
      sendAt,
      createdBy: message.author.id,
      createdAt: new Date().toISOString()
    };

    scheduleStore.insert(schedule);
    armScheduleTimer();

    await message.reply([
      "\u{1F4C5} **Message scheduled**",
      "",
      `**Channel:** <#${channelId}>`,
      `**Send time:** <t:${sendAtSeconds}:F> (<t:${sendAtSeconds}:R>)`,
      `**Message length:** ${scheduledContent.length} characters`
    ].join("\n"));
    return;
  }

  if (/^\.csv(?:\s|$)/i.test(message.content.trim())) {
    const permissionResult = runDevCommandPreflight(message, ".csv");
    if (permissionResult) {
      await message.reply(permissionResult);
      return;
    }

    const [, categoryInput = ""] = message.content.trim().split(/\s+/, 2);
    const category = parseTopCategory(categoryInput);
    if (!category) {
      await message.reply("\u2139\uFE0F Use `.csv strength`, `.csv wins`, `.csv rebirths`, or `.csv time`.");
      return;
    }

    await message.reply({
      files: [
        new AttachmentBuilder(buildLeaderboardCsv(category), {
          name: `leaderboard-${getCategoryFileName(category)}.csv`
        })
      ]
    });
    return;
  }

  if (message.content.trim().toLowerCase().startsWith(".top")) {
    const [, categoryInput = ""] = message.content.trim().split(/\s+/, 2);
    const category = parseTopCategory(categoryInput);

    if (!category) {
      await message.reply("ℹ️ Use `.top strength`, `.top wins`, `.top rebirths`, or `.top time`.");
      return;
    }

    await message.reply(buildTopReply(category));
    return;
  }

  if (message.channelId !== config.discordChannelId) {
    return;
  }

  if (blacklistStore.hasUserId(message.author.id)) {
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
