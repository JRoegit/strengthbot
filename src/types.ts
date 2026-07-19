export type ParsedSubmission = {
  username: string;
  highestStrength: string;
  highestWins: string;
  rebirths: string;
  timePlayed: string;
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
  vip: boolean;
};

export type PenaltyProfile = {
  userId: string;
  highestStrength: string;
  highestWins: string;
  rebirths: string;
  timePlayed: string;
  updatedAt: string;
};

export type BlacklistEntry = {
  userId: string;
  blacklistedAt: string;
};

export type ScheduledMessage = {
  id: string;
  guildId: string;
  channelId: string;
  content: string;
  sendAt: number;
  createdBy: string;
  createdAt: string;
};
