import OpenAI from "openai";
import { parseCompactNumberToString, parseDurationToSecondsString } from "./numberUtils.js";
import type { ParsedSubmission } from "./types.js";

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "username",
    "highestStrength",
    "highestWins",
    "rebirths",
    "timePlayed"
  ],
  properties: {
    username: { type: "string" },
    highestStrength: { type: "string" },
    highestWins: { type: "string" },
    rebirths: { type: "string" },
    timePlayed: { type: "string" }
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
                "Only use the centered Lifetime Stats menu in the screenshot.",
                "Ignore all other scoreboards, overlays, HUD elements, captions, and background text outside that stats panel.",
                "Inside the Lifetime Stats panel, the top centered line below the header is the username.",
                "Below the username are four labeled rows, and each value is right-aligned on the same horizontal line as its label.",
                "Read the value on the same row as each label and do not read any nearby text from other rows.",
                "Extract the four values shown top to bottom inside the panel as highestStrength, highestWins, rebirths, timePlayed.",
                "The rows are Highest Strength, Highest Wins, Rebirths, and Time Played.",
                "Labels may be in English, German, Italian, or another localized language.",
                "Transcribe each value exactly as shown before any normalization.",
                "Do not simplify, round, infer, or convert values.",
                "If the screenshot shows 1.23K, return 1.23K, not 1230 and not 230.",
                "If the screenshot shows 15m30s, return 15m30s exactly.",
                "If the screenshot shows 0, return 0.",
                "Return each numeric field exactly as it appears, preserving suffixes like K, M, B, T, Qa, and Qt.",
                "The image may be blurry, discolored, skewed, cropped, or photographed from a screen.",
                "Double-check decimal points and suffix letters carefully before responding.",
                "If a character is slightly ambiguous, choose the most likely reading from the Lifetime Stats panel only."
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
                "Extract the username and the stat values from the Lifetime Stats panel only.",
                "For each stat, read the right-aligned value on the same row as the label."
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
      highestStrength: parseCompactNumberToString(payload.highestStrength),
      highestWins: parseCompactNumberToString(payload.highestWins),
      rebirths: parseCompactNumberToString(payload.rebirths),
      timePlayed: parseDurationToSecondsString(payload.timePlayed)
    });

    return { parsed, rawText };
  }
}
