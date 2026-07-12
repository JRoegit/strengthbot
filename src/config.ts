import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseChannelIdList(value: string | undefined, fallback: string): string[] {
  const configuredIds = value
    ?.split(/[\s,]+/)
    .map((channelId) => channelId.trim())
    .filter(Boolean) ?? [];

  return configuredIds.length > 0 ? configuredIds : [fallback];
}

const discordChannelId = requireEnv("DISCORD_CHANNEL_ID");

export const config = {
  discordToken: requireEnv("DISCORD_TOKEN"),
  discordChannelId,
  commandChannelIds: parseChannelIdList(process.env.COMMAND_CHANNEL_IDS, discordChannelId),
  openAiApiKey: requireEnv("OPENAI_API_KEY"),
  openAiModel: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
  dataFile: path.resolve(process.env.DATA_FILE?.trim() || "./data/submissions.json"),
  penaltyFile: path.resolve(process.env.PENALTY_FILE?.trim() || "./data/penalties.json"),
  blacklistFile: path.resolve(process.env.BLACKLIST_FILE?.trim() || "./data/blacklist.json"),
  devRoleId: process.env.DEV_ROLE_ID?.trim() || ""
};
