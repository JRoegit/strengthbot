import fs from "node:fs";
import path from "node:path";
import type { ScheduledMessage } from "./types.js";

type ScheduleDatabaseShape = {
  schedules: ScheduledMessage[];
};

function ensureScheduleFile(filePath: string): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });

  if (!fs.existsSync(filePath)) {
    const initialData: ScheduleDatabaseShape = { schedules: [] };
    fs.writeFileSync(filePath, JSON.stringify(initialData, null, 2), "utf8");
  }
}

export class ScheduleStore {
  constructor(private readonly filePath: string) {
    ensureScheduleFile(filePath);
  }

  private read(): ScheduleDatabaseShape {
    const raw = fs.readFileSync(this.filePath, "utf8");
    return JSON.parse(raw) as ScheduleDatabaseShape;
  }

  private write(data: ScheduleDatabaseShape): void {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  list(): ScheduledMessage[] {
    return this.read().schedules
      .slice()
      .sort((left, right) => left.sendAt - right.sendAt);
  }

  insert(schedule: ScheduledMessage): void {
    const data = this.read();
    data.schedules.push(schedule);
    this.write(data);
  }

  removeById(id: string): ScheduledMessage | null {
    const data = this.read();
    const schedule = data.schedules.find((entry) => entry.id === id) ?? null;

    if (!schedule) {
      return null;
    }

    data.schedules = data.schedules.filter((entry) => entry.id !== id);
    this.write(data);
    return schedule;
  }
}
