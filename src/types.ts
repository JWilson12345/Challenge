import type { Timestamp } from "firebase/firestore";

export type ChallengeStatus = "draft" | "upcoming" | "active" | "completed";
export type AggregationType = "sum" | "replace";
export type ScoreDirection = "higher" | "lower";
export type VoteTargetType = "post" | "comment";

export type AppTimestamp = Timestamp | Date | string | number | null | undefined;

export interface Player {
  id: string;
  displayName: string;
  email?: string | null;
  photoURL?: string | null;
  bio?: string;
  admin?: boolean;
  disabled?: boolean;
  createdAt?: AppTimestamp;
  updatedAt?: AppTimestamp;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  startAt: AppTimestamp;
  endAt: AppTimestamp;
  status: ChallengeStatus;
  scoringLabel: string;
  aggregationType: AggregationType;
  scoreDirection: ScoreDirection;
  placementPoints: Record<string, number>;
  imageUrl?: string;
  timezone: string;
  createdAt?: AppTimestamp;
  updatedAt?: AppTimestamp;
  completedAt?: AppTimestamp;
  finalisedAt?: AppTimestamp;
  deletedAt?: AppTimestamp;
}

export interface Submission {
  id: string;
  challengeId: string;
  userId: string;
  title: string;
  description: string;
  score: number;
  scoreOverride?: number | null;
  imageUrls: string[];
  createdAt?: AppTimestamp;
  updatedAt?: AppTimestamp;
  deletedAt?: AppTimestamp;
}

export interface CommentItem {
  id: string;
  postId: string;
  userId: string;
  text: string;
  parentCommentId?: string | null;
  createdAt?: AppTimestamp;
  updatedAt?: AppTimestamp;
  deletedAt?: AppTimestamp;
}

export interface Vote {
  id: string;
  targetType: VoteTargetType;
  targetId: string;
  userId: string;
  value: 1 | -1;
  createdAt?: AppTimestamp;
  updatedAt?: AppTimestamp;
}

export interface ChallengeResult {
  id: string;
  challengeId: string;
  userId: string;
  year: number;
  finalScore: number;
  finalRank: number;
  overallPointsAwarded: number;
  createdAt?: AppTimestamp;
  updatedAt?: AppTimestamp;
}

export interface RankedPlayer {
  userId: string;
  player: Player;
  score: number;
  rank: number;
  submissions: Submission[];
  overallPoints?: number;
  wins?: number;
  podiums?: number;
}

export interface ToastMessage {
  id: string;
  tone: "success" | "error" | "info";
  text: string;
}
