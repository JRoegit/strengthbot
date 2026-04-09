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

export const config = {
  discordToken: requireEnv("DISCORD_TOKEN"),
  discordChannelId: requireEnv("DISCORD_CHANNEL_ID"),
  openAiApiKey: requireEnv("OPENAI_API_KEY"),
  openAiModel: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
  dataFile: path.resolve(process.env.DATA_FILE?.trim() || "./data/submissions.json"),
  penaltyFile: path.resolve(process.env.PENALTY_FILE?.trim() || "./data/penalties.json"),
  devRoleId: process.env.DEV_ROLE_ID?.trim() || ""
};
