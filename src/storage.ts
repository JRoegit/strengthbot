import fs from "node:fs";
import path from "node:path";
import type { StoredSubmission } from "./types.js";

type SortableSubmissionField = "packsOpened" | "battlesWon" | "incomePerSecond" | "bestCard";

type DatabaseShape = {
  submissions: StoredSubmission[];
};

function ensureDatabaseFile(filePath: string): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });

  if (!fs.existsSync(filePath)) {
    const initialData: DatabaseShape = { submissions: [] };
    fs.writeFileSync(filePath, JSON.stringify(initialData, null, 2), "utf8");
  }
}

export class SubmissionStore {
  constructor(private readonly filePath: string) {
    ensureDatabaseFile(filePath);
  }

  private read(): DatabaseShape {
    const raw = fs.readFileSync(this.filePath, "utf8");
    return JSON.parse(raw) as DatabaseShape;
  }

  private write(data: DatabaseShape): void {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  hasMessage(messageId: string): boolean {
    const data = this.read();
    return data.submissions.some((submission) => submission.messageId === messageId);
  }

  insert(submission: StoredSubmission): void {
    const data = this.read();
    data.submissions = data.submissions.filter((existingSubmission) => {
      return existingSubmission.userId !== submission.userId;
    });
    data.submissions.push(submission);
    this.write(data);
  }

  list(): StoredSubmission[] {
    return this.read().submissions;
  }

  getLatestByUserId(userId: string): StoredSubmission | null {
    const submissions = this.read().submissions
      .filter((submission) => submission.userId === userId)
      .sort((left, right) => {
        return new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime();
      });

    return submissions[0] ?? null;
  }

  hasSubmissionForUserId(userId: string): boolean {
    return this.read().submissions.some((submission) => submission.userId === userId);
  }

  removeByUserId(userId: string): StoredSubmission | null {
    const data = this.read();
    const submission = data.submissions.find((entry) => entry.userId === userId) ?? null;

    if (!submission) {
      return null;
    }

    data.submissions = data.submissions.filter((entry) => entry.userId !== userId);
    this.write(data);
    return submission;
  }

  getTopByCategory(category: SortableSubmissionField, limit: number): StoredSubmission[] {
    return this.read().submissions
      .slice()
      .sort((left, right) => {
        const leftValue = BigInt(left[category]);
        const rightValue = BigInt(right[category]);

        if (leftValue === rightValue) {
          return new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime();
        }

        return leftValue > rightValue ? -1 : 1;
      })
      .slice(0, limit);
  }

  getRankByUserId(userId: string, category: SortableSubmissionField): number | null {
    const sortedSubmissions = this.read().submissions
      .slice()
      .sort((left, right) => {
        const leftValue = BigInt(left[category]);
        const rightValue = BigInt(right[category]);

        if (leftValue === rightValue) {
          return new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime();
        }

        return leftValue > rightValue ? -1 : 1;
      });

    const index = sortedSubmissions.findIndex((submission) => submission.userId === userId);
    return index === -1 ? null : index + 1;
  }
}
