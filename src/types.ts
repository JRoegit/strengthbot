export type ParsedSubmission = {
  username: string;
  packsOpened: string;
  battlesWon: string;
  incomePerSecond: string;
  bestCard: string;
  totalCardLevel: string;
};

export type StoredSubmission = ParsedSubmission & {
  id: string;
  messageId: string;
  channelId: string;
  guildId: string | null;
  userId: string;
  submittedAt: string;
  imageUrl: string;
  rawModelOutput: string;
};

export type PenaltyProfile = {
  userId: string;
  packsOpened: string;
  battlesWon: string;
  incomePerSecond: string;
  bestCard: string;
  totalCardLevel: string;
  updatedAt: string;
};

export type BlacklistEntry = {
  userId: string;
  blacklistedAt: string;
};
