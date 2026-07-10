import fs from "node:fs";
import path from "node:path";
import type { PenaltyProfile } from "./types.js";

type PenaltyDatabaseShape = {
  penalties: PenaltyProfile[];
};

function ensurePenaltyFile(filePath: string): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });

  if (!fs.existsSync(filePath)) {
    const initialData: PenaltyDatabaseShape = { penalties: [] };
    fs.writeFileSync(filePath, JSON.stringify(initialData, null, 2), "utf8");
  }
}

export class PenaltyStore {
  constructor(private readonly filePath: string) {
    ensurePenaltyFile(filePath);
  }

  private read(): PenaltyDatabaseShape {
    const raw = fs.readFileSync(this.filePath, "utf8");
    const data = JSON.parse(raw) as PenaltyDatabaseShape;
    return {
      penalties: data.penalties.map((penalty) => ({
        ...penalty,
        highestStrength: penalty.highestStrength ?? "0",
        highestWins: penalty.highestWins ?? "0",
        rebirths: penalty.rebirths ?? "0",
        timePlayed: penalty.timePlayed ?? "0"
      }))
    };
  }

  private write(data: PenaltyDatabaseShape): void {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  getByUserId(userId: string): PenaltyProfile | null {
    return this.read().penalties.find((entry) => entry.userId === userId) ?? null;
  }

  upsert(profile: PenaltyProfile): void {
    const data = this.read();
    data.penalties = data.penalties.filter((entry) => entry.userId !== profile.userId);
    data.penalties.push(profile);
    this.write(data);
  }
}
