export type ParsedSubmission = {
  username: string;
  packsOpened: string;
  battlesWon: string;
  incomePerSecond: string;
  bestCard: string;
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
