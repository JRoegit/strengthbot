import OpenAI from "openai";
import { parseCompactNumberToString } from "./numberUtils.js";
import type { ParsedSubmission } from "./types.js";

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "username",
    "packsOpened",
    "battlesWon",
    "incomePerSecond",
    "bestCard"
  ],
  properties: {
    username: { type: "string" },
    packsOpened: { type: "string" },
    battlesWon: { type: "string" },
    incomePerSecond: { type: "string" },
    bestCard: { type: "string" }
  }
} as const;

function sanitizeUsername(username: string): string {
  return username.trim();
}

function validateParsedSubmission(parsed: ParsedSubmission): ParsedSubmission {
  if (!parsed.username) {
    throw new Error("Parsed username was empty.");
  }

  if (Object.values(parsed).some((value) => typeof value === "string" && !value.trim())) {
    throw new Error("Parsed submission contained an empty field.");
  }

  return parsed;
}

export class VisionParser {
  private readonly client: OpenAI;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new OpenAI({ apiKey });
  }

  async parseImage(imageUrl: string): Promise<{ parsed: ParsedSubmission; rawText: string }> {
    const response = await this.client.responses.create({
      model: this.model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You extract leaderboard submission stats from a game screenshot.",
                "Only use the blue stats menu box in the screenshot.",
                "Ignore all other scoreboards, overlays, HUD elements, captions, and background text outside that blue box.",
                "Inside the blue box, the top centered line is the username.",
                "Then extract the four values shown top to bottom inside the box as packsOpened, battlesWon, incomePerSecond, bestCard.",
                "Labels may be in English, German, Italian, or another localized language.",
                "Return each numeric field exactly as it appears, preserving suffixes like K, M, B, T, Qa, Qt and decorations like $ or /s if present.",
                "The image may be blurry, discolored, skewed, cropped, or photographed from a screen.",
                "If a character is slightly ambiguous, choose the most likely reading from the blue box only."
              ].join(" ")
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Extract the username and the four stat values from the blue stats box only.",
                "Do not read values from any leaderboard or overlay outside the blue box."
              ].join(" ")
            },
            {
              type: "input_image",
              image_url: imageUrl,
              detail: "high"
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "discord_stat_submission",
          schema: OUTPUT_SCHEMA,
          strict: true
        }
      },
      max_output_tokens: 200
    });

    const rawText = response.output_text;
    if (!rawText) {
      throw new Error("OpenAI response did not include output_text.");
    }

    const payload = JSON.parse(rawText) as Record<string, string>;
    const parsed: ParsedSubmission = validateParsedSubmission({
      username: sanitizeUsername(payload.username),
      packsOpened: parseCompactNumberToString(payload.packsOpened),
      battlesWon: parseCompactNumberToString(payload.battlesWon),
      incomePerSecond: parseCompactNumberToString(payload.incomePerSecond),
      bestCard: parseCompactNumberToString(payload.bestCard)
    });

    return { parsed, rawText };
  }
}
