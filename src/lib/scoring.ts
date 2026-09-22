import type { Challenge, ChallengeResult, Player, RankedPlayer, Submission } from "../types";
import { toDate, yearFromDate } from "./time";

const DEFAULT_PLACEMENT_POINTS: Record<string, number> = {
  "1": 10,
  "2": 7,
  "3": 5,
  "4": 3,
  "5": 1,
};

export function normalisePlacementPoints(points?: Record<string, number>) {
  return Object.keys(points ?? {}).length ? (points as Record<string, number>) : DEFAULT_PLACEMENT_POINTS;
}

export function scoreForSubmission(submission: Submission) {
  return Number(submission.scoreOverride ?? submission.score ?? 0);
}

function latestSubmission(a: Submission, b: Submission) {
  const aTime = toDate(a.updatedAt ?? a.createdAt)?.getTime() ?? 0;
  const bTime = toDate(b.updatedAt ?? b.createdAt)?.getTime() ?? 0;
  return bTime - aTime;
}

export function buildChallengeLeaderboard(
  challenge: Challenge | null | undefined,
  submissions: Submission[],
  players: Player[],
): RankedPlayer[] {
  if (!challenge) return [];
  const visible = submissions.filter((submission) => !submission.deletedAt && submission.challengeId === challenge.id);
  const playerMap = new Map(players.filter((player) => !player.disabled).map((player) => [player.id, player]));

  const byUser = new Map<string, Submission[]>();
  for (const submission of visible) {
    if (!playerMap.has(submission.userId)) continue;
    byUser.set(submission.userId, [...(byUser.get(submission.userId) ?? []), submission]);
  }

  const rows: RankedPlayer[] = [...byUser.entries()].map(([userId, userSubmissions]) => {
    const ordered = [...userSubmissions].sort(latestSubmission);
    const score =
      challenge.aggregationType === "replace"
        ? scoreForSubmission(ordered[0])
        : ordered.reduce((sum, submission) => sum + scoreForSubmission(submission), 0);

    return {
      userId,
      player: playerMap.get(userId) as Player,
      score,
      rank: 0,
      submissions: ordered,
    };
  });

  const direction = challenge.scoreDirection === "lower" ? 1 : -1;
  rows.sort((a, b) => {
    if (a.score !== b.score) return (a.score - b.score) * direction;
    return a.player.displayName.localeCompare(b.player.displayName);
  });

  let previousScore: number | null = null;
  let previousRank = 0;
  rows.forEach((row, index) => {
    if (previousScore === row.score) {
      row.rank = previousRank;
    } else {
      row.rank = index + 1;
      previousRank = row.rank;
      previousScore = row.score;
    }
  });

  return rows;
}

export function pointsForRank(challenge: Challenge, rank: number) {
  const points = normalisePlacementPoints(challenge.placementPoints);
  return Number(points[String(rank)] ?? points.other ?? 0);
}

export function buildFinalResults(challenge: Challenge, rows: RankedPlayer[]): ChallengeResult[] {
  const year = yearFromDate(challenge.endAt);
  return rows.map((row) => ({
    id: `${challenge.id}_${row.userId}`,
    challengeId: challenge.id,
    userId: row.userId,
    year,
    finalScore: row.score,
    finalRank: row.rank,
    overallPointsAwarded: pointsForRank(challenge, row.rank),
  }));
}

export function buildOverallLeaderboard(players: Player[], results: ChallengeResult[], year = new Date().getFullYear()) {
  const playerMap = new Map(players.filter((player) => !player.disabled).map((player) => [player.id, player]));
  const totals = new Map<string, RankedPlayer>();

  for (const result of results.filter((item) => item.year === year)) {
    const player = playerMap.get(result.userId);
    if (!player) continue;
    const current =
      totals.get(result.userId) ??
      ({
        userId: result.userId,
        player,
        score: 0,
        rank: 0,
        submissions: [],
        overallPoints: 0,
        wins: 0,
        podiums: 0,
      } satisfies RankedPlayer);
    current.score += Number(result.overallPointsAwarded ?? 0);
    current.overallPoints = current.score;
    current.wins = (current.wins ?? 0) + (result.finalRank === 1 ? 1 : 0);
    current.podiums = (current.podiums ?? 0) + (result.finalRank <= 3 ? 1 : 0);
    totals.set(result.userId, current);
  }

  const rows = [...totals.values()].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if ((a.wins ?? 0) !== (b.wins ?? 0)) return (b.wins ?? 0) - (a.wins ?? 0);
    return a.player.displayName.localeCompare(b.player.displayName);
  });

  let previousScore: number | null = null;
  let previousRank = 0;
  rows.forEach((row, index) => {
    if (previousScore === row.score) {
      row.rank = previousRank;
    } else {
      row.rank = index + 1;
      previousRank = row.rank;
      previousScore = row.score;
    }
  });

  return rows;
}

export function getPositionCopy(rows: RankedPlayer[], userId?: string) {
  if (!userId) return "Log in to see your position.";
  const index = rows.findIndex((row) => row.userId === userId);
  if (index === -1) return "Submit a result to join the leaderboard.";
  const current = rows[index];
  const ahead = rows[index - 1];
  const behind = rows[index + 1];
  if (ahead) {
    const diff = Math.abs(ahead.score - current.score);
    return `${diff} ${diff === 1 ? "point" : "points"} behind ${ahead.player.displayName}`;
  }
  if (behind) {
    const diff = Math.abs(current.score - behind.score);
    return `${diff} ${diff === 1 ? "point" : "points"} ahead of ${behind.player.displayName}`;
  }
  return "You are the only player with a score so far.";
}
