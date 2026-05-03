import fs from "node:fs";
import path from "node:path";
import type { BlacklistEntry } from "./types.js";

type BlacklistDatabaseShape = {
  blacklist: BlacklistEntry[];
};

function ensureBlacklistFile(filePath: string): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });

  if (!fs.existsSync(filePath)) {
    const initialData: BlacklistDatabaseShape = { blacklist: [] };
    fs.writeFileSync(filePath, JSON.stringify(initialData, null, 2), "utf8");
  }
}

export class BlacklistStore {
  constructor(private readonly filePath: string) {
    ensureBlacklistFile(filePath);
  }

  private read(): BlacklistDatabaseShape {
    const raw = fs.readFileSync(this.filePath, "utf8");
    return JSON.parse(raw) as BlacklistDatabaseShape;
  }

  private write(data: BlacklistDatabaseShape): void {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  hasUserId(userId: string): boolean {
    return this.read().blacklist.some((entry) => entry.userId === userId);
  }

  add(entry: BlacklistEntry): void {
    const data = this.read();
    data.blacklist = data.blacklist.filter((existingEntry) => existingEntry.userId !== entry.userId);
    data.blacklist.push(entry);
    this.write(data);
  }
}
