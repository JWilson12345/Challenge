import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  HashRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useParams,
} from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  Heart,
  History,
  Home,
  ImagePlus,
  LogOut,
  MessageCircle,
  Pencil,
  Plus,
  Send,
  Settings,
  Shield,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Trophy,
  User,
  X,
} from "lucide-react";
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updateEmail,
  updatePassword,
  updateProfile,
  type User as FirebaseUser,
} from "firebase/auth";
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { cloudinaryReady, uploadImage } from "./lib/cloudinary";
import { auth, db, firebaseReady, friendlyError } from "./lib/firebase";
import { compressImage } from "./lib/images";
import {
  buildChallengeLeaderboard,
  buildFinalResults,
  buildOverallLeaderboard,
  getPositionCopy,
  normalisePlacementPoints,
} from "./lib/scoring";
import {
  APP_TIMEZONE,
  formatCountdown,
  formatDateRange,
  formatScheduleDate,
  formatTimeAgo,
  getCountdownParts,
  toDate,
  toInputDateTime,
} from "./lib/time";
import type {
  AggregationType,
  Challenge,
  ChallengeResult,
  ChallengeStatus,
  CommentItem,
  Player,
  RankedPlayer,
  ScoreDirection,
  Submission,
  ToastMessage,
  Vote,
  VoteTargetType,
} from "./types";

type CollectionName = "users" | "challenges" | "submissions" | "comments" | "votes" | "challengeResults";

interface ChallengeFormState {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  status: ChallengeStatus;
  scoringLabel: string;
  aggregationType: AggregationType;
  scoreDirection: ScoreDirection;
  placementPoints: string;
  imageUrl: string;
}

const navItems = [
  { to: "/", label: "Home", icon: Home },
  { to: "/current", label: "Current", icon: CalendarClock },
  { to: "/leaderboard", label: "Leaderboard", icon: BarChart3 },
  { to: "/history", label: "History", icon: History },
  { to: "/overall", label: "Overall", icon: Trophy },
  { to: "/profile", label: "Profile", icon: User },
  { to: "/settings", label: "Settings", icon: Settings },
];

const defaultChallengeForm: ChallengeFormState = {
  title: "",
  description: "",
  startAt: "",
  endAt: "",
  status: "draft",
  scoringLabel: "points",
  aggregationType: "sum",
  scoreDirection: "higher",
  placementPoints: "1:10, 2:7, 3:5, 4:3, 5:1",
  imageUrl: "",
};

function parsePlacementPoints(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, number>>((points, part) => {
      const [rank, score] = part.split(":").map((item) => item.trim());
      if (rank && Number.isFinite(Number(score))) points[rank] = Number(score);
      return points;
    }, {});
}

function placementPointsToString(points?: Record<string, number>) {
  return Object.entries(normalisePlacementPoints(points))
    .map(([rank, score]) => `${rank}:${score}`)
    .join(", ");
}

function typedSnapshot<T extends { id: string }>(name: CollectionName, setter: (items: T[]) => void, onError: (message: string) => void) {
  if (!db) return () => undefined;
  return onSnapshot(
    collection(db, name),
    (snapshot) => setter(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as T)),
    () => onError("Live updates paused. Refresh or check your Firebase rules."),
  );
}

function App() {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [players, setPlayers] = useState<Player[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [results, setResults] = useState<ChallengeResult[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [adminUnlocked, setAdminUnlocked] = useState(sessionStorage.getItem("challenge-admin") === "yes");

  const toast = (text: string, tone: ToastMessage["tone"] = "info") => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, text, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  };

  useEffect(() => {
    if (!firebaseReady || !auth) {
      setAuthLoading(false);
      return;
    }
    return onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthLoading(false);
      if (user && db) {
        const userRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userRef);
        if (!userDoc.exists()) {
          await setDoc(userRef, {
            displayName: user.displayName || user.email?.split("@")[0] || "Player",
            email: user.email,
            photoURL: user.photoURL || "",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
    });
  }, []);

  useEffect(() => {
    if (!firebaseUser || !db) return undefined;
    const unsubscribers = [
      typedSnapshot<Player>("users", setPlayers, toast),
      typedSnapshot<Challenge>("challenges", setChallenges, toast),
      typedSnapshot<Submission>("submissions", setSubmissions, toast),
      typedSnapshot<CommentItem>("comments", setComments, toast),
      typedSnapshot<Vote>("votes", setVotes, toast),
      typedSnapshot<ChallengeResult>("challengeResults", setResults, toast),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [firebaseUser]);

  const currentPlayer = players.find((player) => player.id === firebaseUser?.uid);
  const isAdmin = Boolean(adminUnlocked || currentPlayer?.admin);
  const visibleChallenges = useMemo(() => challenges.filter((challenge) => !challenge.deletedAt), [challenges]);
  const activeChallenge = useMemo(() => {
    return visibleChallenges.find((challenge) => challenge.status === "active");
  }, [visibleChallenges]);

  const appData = {
    firebaseUser,
    currentPlayer,
    players,
    challenges: visibleChallenges,
    submissions: submissions.filter((submission) => !submission.deletedAt),
    comments: comments.filter((comment) => !comment.deletedAt),
    votes,
    results,
    activeChallenge,
    isAdmin,
    adminUnlocked,
    setAdminUnlocked,
    toast,
  };

  if (!firebaseReady) return <SetupGuide />;
  if (authLoading) return <ScreenLoader label="Opening Challenge" />;
  if (!firebaseUser) return <AuthPage toast={toast} toasts={toasts} />;

  return (
    <HashRouter>
      <div className="app-shell">
        <DesktopNav player={currentPlayer} />
        <MobileHeader player={currentPlayer} />
        <main className="content" id="main">
          <Routes>
            <Route path="/" element={<HomePage data={appData} />} />
            <Route path="/current" element={<CurrentChallengePage data={appData} />} />
            <Route path="/leaderboard" element={<LeaderboardPage data={appData} />} />
            <Route path="/history" element={<HistoryPage data={appData} />} />
            <Route path="/history/:challengeId" element={<HistoricalChallengePage data={appData} />} />
            <Route path="/overall" element={<OverallPage data={appData} />} />
            <Route path="/profile" element={<ProfilePage data={appData} />} />
            <Route path="/players/:playerId" element={<PlayerProfilePage data={appData} />} />
            <Route path="/settings" element={<SettingsPage data={appData} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <BottomNav />
        <ToastStack toasts={toasts} />
      </div>
    </HashRouter>
  );
}

type AppData = ReturnType<typeof useAppDataShape>;

function useAppDataShape() {
  return {} as {
    firebaseUser: FirebaseUser | null;
    currentPlayer?: Player;
    players: Player[];
    challenges: Challenge[];
    submissions: Submission[];
    comments: CommentItem[];
    votes: Vote[];
    results: ChallengeResult[];
    activeChallenge?: Challenge;
    isAdmin: boolean;
    adminUnlocked: boolean;
    setAdminUnlocked: (value: boolean) => void;
    toast: (text: string, tone?: ToastMessage["tone"]) => void;
  };
}

function SetupGuide() {
  return (
    <main className="setup-screen">
      <section className="setup-panel">
        <p className="eyebrow">Firebase setup required</p>
        <h1>Challenge</h1>
        <p>
          Add your Firebase web configuration before publishing the app. Use the setup guide for browser-only Firebase and GitHub steps.
        </p>
        <a className="primary-action" href="./setup-guide.html">
          Open setup guide
        </a>
        <pre>{`VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_CLOUDINARY_CLOUD_NAME=...
VITE_CLOUDINARY_UPLOAD_PRESET=...`}</pre>
      </section>
    </main>
  );
}

function AuthPage({ toast, toasts }: { toast: AppData["toast"]; toasts: ToastMessage[] }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!auth || !db) return;
    setBusy(true);
    try {
      if (mode === "register") {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        const cleanName = displayName.trim() || email.split("@")[0];
        await updateProfile(credential.user, { displayName: cleanName });
        await setDoc(doc(db, "users", credential.user.uid), {
          displayName: cleanName,
          email,
          photoURL: "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        toast("Account created. Welcome to the competition.", "success");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      toast(friendlyError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-labelledby="auth-title">
        <div>
          <p className="eyebrow">Private competition</p>
          <h1 id="auth-title">Challenge</h1>
          <p className="muted">Recurring challenges, live leaderboards, evidence posts, and one yearly table.</p>
        </div>
        <form className="stack" onSubmit={submit}>
          <div className="segmented" aria-label="Authentication mode">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
              Login
            </button>
            <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
              Create account
            </button>
          </div>
          {mode === "register" && (
            <label>
              Display name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" />
            </label>
          )}
          <label>
            Email
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>
          <button className="primary-action" disabled={busy}>
            {busy ? "Working..." : mode === "login" ? "Login" : "Create account"}
          </button>
        </form>
      </section>
      <ToastStack toasts={toasts} />
    </main>
  );
}

function DesktopNav({ player }: { player?: Player }) {
  return (
    <aside className="desktop-nav" aria-label="Primary">
      <Link className="brand" to="/">
        <span className="brand-mark">C</span>
        <span>Challenge</span>
      </Link>
      <nav>
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/"}>
            <item.icon size={18} />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <Link className="nav-profile" to="/profile">
        <Avatar player={player} />
        <div>
          <strong>{player?.displayName ?? "Player"}</strong>
          <span>Private group</span>
        </div>
      </Link>
    </aside>
  );
}

function MobileHeader({ player }: { player?: Player }) {
  return (
    <header className="mobile-header">
      <Link className="brand" to="/">
        <span className="brand-mark">C</span>
        <span>Challenge</span>
      </Link>
      <div>
        <Link className="icon-action" to="/settings" aria-label="Settings"><Settings size={20} /></Link>
        <Link to="/profile" aria-label="Your profile"><Avatar player={player} /></Link>
      </div>
    </header>
  );
}

function BottomNav() {
  const mobileItems = navItems.filter((item) => ["Home", "Current", "Leaderboard", "Overall", "Profile"].includes(item.label));
  return (
    <nav className="bottom-nav" aria-label="Primary mobile">
      {mobileItems.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.to === "/"}>
          <item.icon size={20} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function HomePage({ data }: { data: AppData }) {
  const leaderboard = useMemo(
    () => buildChallengeLeaderboard(data.activeChallenge, data.submissions, data.players),
    [data.activeChallenge, data.submissions, data.players],
  );
  const recent = data.submissions
    .filter((submission) => submission.challengeId === data.activeChallenge?.id)
    .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0))
    .slice(0, 4);
  const currentRow = leaderboard.find((row) => row.userId === data.firebaseUser?.uid);

  return (
    <Page title="Home" eyebrow="Competition overview">
      {data.activeChallenge ? (
        <section className="hero-panel">
          <div>
            <p className="eyebrow">Current challenge</p>
            <h1>{data.activeChallenge.title}</h1>
            <p>{data.activeChallenge.description}</p>
          </div>
          <Countdown challenge={data.activeChallenge} />
          <Link className="primary-action compact" to="/current">
            <Plus size={18} /> Submit result
          </Link>
        </section>
      ) : (
        <EmptyState title="No active challenge" body="The next challenge will appear here when an administrator starts one." />
      )}

      <div className="two-column">
        <Panel title="Current leaderboard" action={<Link to="/leaderboard">View all</Link>}>
          <Leaderboard rows={leaderboard.slice(0, 6)} currentUserId={data.firebaseUser?.uid} compact />
        </Panel>
        <Panel title="Your position">
          {currentRow ? (
            <div className="position-card">
              <RankBadge rank={currentRow.rank} />
              <strong>#{currentRow.rank}</strong>
              <span>{currentRow.score} {data.activeChallenge?.scoringLabel}</span>
              <p>{getPositionCopy(leaderboard, data.firebaseUser?.uid)}</p>
            </div>
          ) : (
            <EmptyState title="No score yet" body="Submit your first result to join the board." small />
          )}
        </Panel>
      </div>

      <section className="feed-section">
        <header><h2>Recent activity</h2></header>
        {recent.length ? (
          <Feed submissions={recent} data={data} condensed />
        ) : (
          <EmptyState title="No submissions yet" body="Be the first to post your result." small />
        )}
      </section>
    </Page>
  );
}

function CurrentChallengePage({ data }: { data: AppData }) {
  const challenge = data.activeChallenge;
  const leaderboard = useMemo(() => buildChallengeLeaderboard(challenge, data.submissions, data.players), [challenge, data]);
  const [showForm, setShowForm] = useState(false);

  if (!challenge) {
    return (
      <Page title="Current Challenge" eyebrow="Live competition">
        <EmptyState title="No active challenge" body="The next challenge will appear here when the administrator starts one." />
      </Page>
    );
  }

  const expired = getCountdownParts(challenge.endAt).expired || challenge.status === "completed";

  return (
    <Page title={challenge.title} eyebrow="Current challenge">
      <section className="challenge-header">
        <div>
          <p>{challenge.description}</p>
          <dl className="meta-grid">
            <div>
              <dt>Starts</dt>
              <dd>{formatScheduleDate(challenge.startAt)}</dd>
            </div>
            <div>
              <dt>Ends</dt>
              <dd>{formatScheduleDate(challenge.endAt)}</dd>
            </div>
            <div>
              <dt>Scoring</dt>
              <dd>{challenge.aggregationType === "sum" ? "Cumulative" : "Latest replaces previous"}</dd>
            </div>
          </dl>
        </div>
        <Countdown challenge={challenge} />
        {expired ? (
          <div className="complete-banner">
            <Crown size={18} /> Challenge complete
          </div>
        ) : (
          <button className="primary-action compact" onClick={() => setShowForm(true)}>
            <Plus size={18} /> Submit result
          </button>
        )}
      </section>

      {showForm && <SubmissionForm data={data} challenge={challenge} onClose={() => setShowForm(false)} />}

      <div className="two-column wide-left">
        <Panel title="Leaderboard">
          <Leaderboard rows={leaderboard} currentUserId={data.firebaseUser?.uid} />
        </Panel>
        <Panel title="Your score">
          <YourPosition rows={leaderboard} userId={data.firebaseUser?.uid} unit={challenge.scoringLabel} />
        </Panel>
      </div>

      <section className="feed-section">
        <header><h2>Recent submissions</h2></header>
        <Feed submissions={data.submissions.filter((submission) => submission.challengeId === challenge.id)} data={data} />
      </section>
    </Page>
  );
}

function LeaderboardPage({ data }: { data: AppData }) {
  const rows = useMemo(() => buildChallengeLeaderboard(data.activeChallenge, data.submissions, data.players), [data]);
  return (
    <Page title="Leaderboard" eyebrow={data.activeChallenge?.title ?? "Current challenge"}>
      <Panel title="Challenge rankings">
        <Leaderboard rows={rows} currentUserId={data.firebaseUser?.uid} />
      </Panel>
      <Panel title="Your position">
        <YourPosition rows={rows} userId={data.firebaseUser?.uid} unit={data.activeChallenge?.scoringLabel ?? "points"} />
      </Panel>
    </Page>
  );
}

function HistoryPage({ data }: { data: AppData }) {
  const completed = data.challenges
    .filter((challenge) => challenge.status === "completed")
    .sort((a, b) => (toDate(b.endAt)?.getTime() ?? 0) - (toDate(a.endAt)?.getTime() ?? 0));

  return (
    <Page title="Challenge History" eyebrow="Completed challenges">
      {completed.length ? (
        <div className="history-list">
          {completed.map((challenge) => {
            const challengeResults = data.results.filter((result) => result.challengeId === challenge.id);
            const winner = challengeResults.find((result) => result.finalRank === 1);
            const player = data.players.find((item) => item.id === winner?.userId);
            const currentResult = challengeResults.find((result) => result.userId === data.firebaseUser?.uid);
            return (
              <Link className="history-row" key={challenge.id} to={`/history/${challenge.id}`}>
                <div>
                  <strong>{challenge.title}</strong>
                  <span>{formatDateRange(challenge.startAt, challenge.endAt)}</span>
                </div>
                <div>
                  <span>Winner</span>
                  <strong>{player?.displayName ?? "Not finalised"}</strong>
                </div>
                <div>
                  <span>Your result</span>
                  <strong>{currentResult ? `#${currentResult.finalRank} - ${currentResult.finalScore}` : "No result"}</strong>
                </div>
                <ChevronRight size={18} />
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No completed challenges yet" body="Completed challenges will appear here with final leaderboards and posts." />
      )}
    </Page>
  );
}

function HistoricalChallengePage({ data }: { data: AppData }) {
  const { challengeId } = useParams();
  const challenge = data.challenges.find((item) => item.id === challengeId);
  if (!challenge) return <Navigate to="/history" replace />;
  const rows = data.results
    .filter((result) => result.challengeId === challenge.id)
    .map((result) => {
      const player = data.players.find((item) => item.id === result.userId);
      return player
        ? ({
            userId: result.userId,
            player,
            score: result.finalScore,
            rank: result.finalRank,
            submissions: [],
          } satisfies RankedPlayer)
        : null;
    })
    .filter(Boolean) as RankedPlayer[];
  rows.sort((a, b) => a.rank - b.rank || b.score - a.score);

  return (
    <Page title={challenge.title} eyebrow="Historical challenge">
      <Link className="back-link" to="/history">
        <ArrowLeft size={16} /> History
      </Link>
      <section className="challenge-header">
        <div>
          <p>{challenge.description}</p>
          <p className="muted">{formatDateRange(challenge.startAt, challenge.endAt)}</p>
        </div>
        <div className="complete-banner">
          <Crown size={18} /> Challenge complete
        </div>
      </section>
      <Panel title="Final leaderboard">
        <Leaderboard rows={rows} currentUserId={data.firebaseUser?.uid} />
      </Panel>
      <section className="feed-section">
        <header><h2>Historical submissions</h2></header>
        <Feed submissions={data.submissions.filter((submission) => submission.challengeId === challenge.id)} data={data} />
      </section>
    </Page>
  );
}

function OverallPage({ data }: { data: AppData }) {
  const [year] = useState(() => new Date().getFullYear());
  const rows = useMemo(() => buildOverallLeaderboard(data.players, data.results, year), [data.players, data.results, year]);
  return (
    <Page title="Overall" eyebrow={`Yearly leaderboard - ${year}`}>
      <Panel title="Overall leaderboard">
        <Leaderboard rows={rows} currentUserId={data.firebaseUser?.uid} overall />
      </Panel>
      <Panel title="Points breakdown">
        <OverallBreakdown data={data} />
      </Panel>
    </Page>
  );
}

function OverallBreakdown({ data }: { data: AppData }) {
  const ownResults = data.results
    .filter((result) => result.userId === data.firebaseUser?.uid)
    .sort((a, b) => b.year - a.year);
  if (!ownResults.length) return <EmptyState title="No overall points yet" body="Points are awarded when completed challenges are finalised." small />;
  return (
    <div className="breakdown-list">
      {ownResults.map((result) => {
        const challenge = data.challenges.find((item) => item.id === result.challengeId);
        return (
          <div key={result.id} className="breakdown-row">
            <span>{challenge?.title ?? "Deleted challenge"}</span>
            <strong>{result.overallPointsAwarded} pts</strong>
          </div>
        );
      })}
    </div>
  );
}

function ProfilePage({ data }: { data: AppData }) {
  const [displayName, setDisplayName] = useState(data.currentPlayer?.displayName ?? "");
  const [bio, setBio] = useState(data.currentPlayer?.bio ?? "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDisplayName(data.currentPlayer?.displayName ?? "");
    setBio(data.currentPlayer?.bio ?? "");
  }, [data.currentPlayer]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!db || !data.firebaseUser) return;
    setBusy(true);
    try {
      let photoURL = data.currentPlayer?.photoURL ?? "";
      if (avatarFile) {
        const blob = await compressImage(avatarFile, 512, 0.82);
        photoURL = await uploadImage(blob);
      }
      await updateProfile(data.firebaseUser, { displayName, photoURL });
      await updateDoc(doc(db, "users", data.firebaseUser.uid), {
        displayName,
        bio,
        photoURL,
        updatedAt: serverTimestamp(),
      });
      data.toast("Profile updated.", "success");
    } catch (error) {
      data.toast(friendlyError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Profile" eyebrow="Your player identity">
      <Panel title="Player details">
        <form className="stack form-grid" onSubmit={save}>
          <div className="profile-preview">
            <Avatar player={{ ...data.currentPlayer, displayName, photoURL: data.currentPlayer?.photoURL }} large />
            <label className={cloudinaryReady ? "file-button" : "file-button disabled"}>
              <ImagePlus size={18} /> {cloudinaryReady ? "Profile photo" : "Photos need Cloudinary setup"}
              <input disabled={!cloudinaryReady} type="file" accept="image/*" onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)} />
            </label>
            {avatarFile && <span className="upload-summary">Ready: {avatarFile.name}</span>}
          </div>
          <label>
            Display name
            <input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label>
            Bio
            <textarea rows={3} value={bio} onChange={(event) => setBio(event.target.value)} />
          </label>
          <button className="primary-action" disabled={busy}>{busy ? avatarFile ? "Uploading photo..." : "Saving..." : "Save profile"}</button>
        </form>
      </Panel>
    </Page>
  );
}

function PlayerProfilePage({ data }: { data: AppData }) {
  const { playerId } = useParams();
  const player = data.players.find((item) => item.id === playerId);
  if (!player) {
    return (
      <Page title="Player profile" eyebrow="Community">
        <EmptyState title="Player not found" body="This profile is not available." />
      </Page>
    );
  }

  const posts = data.submissions.filter((submission) => submission.userId === player.id);
  const results = data.results.filter((result) => result.userId === player.id);
  const currentRows = buildChallengeLeaderboard(data.activeChallenge, data.submissions, data.players);
  const currentRow = currentRows.find((row) => row.userId === player.id);
  const wins = results.filter((result) => result.finalRank === 1).length;
  const podiums = results.filter((result) => result.finalRank <= 3).length;
  const isOwnProfile = player.id === data.firebaseUser?.uid;

  return (
    <div className="page profile-page">
      <section className="public-profile-header">
        <Avatar player={player} large />
        <div className="public-profile-main">
          <div className="profile-title-row">
            <div>
              <p className="eyebrow">Player profile</p>
              <h1>{player.displayName}</h1>
            </div>
            {isOwnProfile && <Link className="secondary-action compact" to="/profile"><Pencil size={16} /> Edit profile</Link>}
          </div>
          <div className="profile-stats" aria-label="Player statistics">
            <div><strong>{posts.length}</strong><span>posts</span></div>
            <div><strong>{currentRow?.score ?? 0}</strong><span>current points</span></div>
            <div><strong>{wins}</strong><span>wins</span></div>
            <div><strong>{podiums}</strong><span>podiums</span></div>
          </div>
          {player.bio ? <p className="profile-bio">{player.bio}</p> : <p className="profile-bio muted">No bio yet.</p>}
        </div>
      </section>

      <section className="profile-posts">
        <header><h2>Posts</h2></header>
        <ProfileGallery submissions={posts} data={data} />
      </section>
    </div>
  );
}

function ProfileGallery({ submissions, data }: { submissions: Submission[]; data: AppData }) {
  const [viewer, setViewer] = useState<{ urls: string[]; index: number } | null>(null);
  const ordered = [...submissions].sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  if (!ordered.length) return <EmptyState title="No posts yet" body="This player's submissions will appear here." small />;

  return (
    <>
      <div className="profile-grid">
        {ordered.map((submission) => {
          const challenge = data.challenges.find((item) => item.id === submission.challengeId);
          const score = submission.scoreOverride ?? submission.score;
          const imageUrl = submission.imageUrls?.[0];
          return imageUrl ? (
            <button
              className="profile-tile"
              key={submission.id}
              onClick={() => setViewer({ urls: submission.imageUrls, index: 0 })}
              aria-label={`Open ${submission.title}`}
            >
              <img src={imageUrl} alt={submission.title} />
              <span>+{score} {challenge?.scoringLabel ?? "pts"}</span>
            </button>
          ) : (
            <article className="profile-tile text-only" key={submission.id}>
              <strong>{submission.title}</strong>
              <span>+{score} {challenge?.scoringLabel ?? "pts"}</span>
            </article>
          );
        })}
      </div>
      {viewer && <ImageViewer urls={viewer.urls} index={viewer.index} onClose={() => setViewer(null)} />}
    </>
  );
}

function SettingsPage({ data }: { data: AppData }) {
  const [password, setPassword] = useState("");
  const [showError, setShowError] = useState(false);
  const [email, setEmail] = useState(data.firebaseUser?.email ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (password === "67") {
      try {
        if (db && data.firebaseUser) {
          await updateDoc(doc(db, "users", data.firebaseUser.uid), { admin: true, updatedAt: serverTimestamp() });
        }
        sessionStorage.setItem("challenge-admin", "yes");
        data.setAdminUnlocked(true);
        setShowError(false);
        data.toast("Admin mode enabled.", "success");
      } catch (error) {
        data.toast(friendlyError(error), "error");
      }
    } else {
      setShowError(true);
    }
  };

  const updateAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!data.firebaseUser || !currentPassword) return;
    try {
      const credential = EmailAuthProvider.credential(data.firebaseUser.email ?? "", currentPassword);
      await reauthenticateWithCredential(data.firebaseUser, credential);
      if (email && email !== data.firebaseUser.email) await updateEmail(data.firebaseUser, email);
      if (newPassword) await updatePassword(data.firebaseUser, newPassword);
      data.toast("Account settings updated.", "success");
      setCurrentPassword("");
      setNewPassword("");
    } catch (error) {
      data.toast(friendlyError(error), "error");
    }
  };

  return (
    <Page title="Settings" eyebrow="Account and administration">
      <div className="two-column">
        <Panel title="Account">
          <form className="stack" onSubmit={updateAccount}>
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              Current password
              <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
            </label>
            <label>
              New password
              <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            </label>
            <button className="secondary-action">Update account</button>
          </form>
          <button className="quiet-action" onClick={() => auth && signOut(auth)}>
            <LogOut size={17} /> Logout
          </button>
        </Panel>
        <Panel title="Admin">
          {data.isAdmin ? (
            <div className="admin-enabled">
              <Shield size={20} />
              <div>
                <strong>Admin mode enabled</strong>
                <span>Challenge and moderation tools are available below.</span>
              </div>
            </div>
          ) : (
            <form className="stack" onSubmit={unlock}>
              <label>
                Admin password
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              {showError && <p className="form-error">Incorrect password.</p>}
              <button className="secondary-action">Enable admin mode</button>
            </form>
          )}
        </Panel>
      </div>
      <Panel title="Photo uploads">
        <div className={cloudinaryReady ? "integration-status connected" : "integration-status"}>
          <div>
            {cloudinaryReady ? <Check size={20} /> : <ImagePlus size={20} />}
            <div>
              <strong>{cloudinaryReady ? "Cloudinary connected" : "Cloudinary setup required"}</strong>
              <span>{cloudinaryReady ? "Profile and submission photos are ready." : "Connect the free image service to enable photos."}</span>
            </div>
          </div>
          <a className="secondary-action compact" href="./setup-guide.html#cloudinary" target="_blank" rel="noreferrer">
            Open photo setup
          </a>
        </div>
      </Panel>
      {data.isAdmin && <AdminPanel data={data} />}
    </Page>
  );
}

function AdminPanel({ data }: { data: AppData }) {
  const [editingChallenge, setEditingChallenge] = useState<Challenge | null>(null);

  return (
    <div className="admin-grid">
      <Panel title={editingChallenge ? "Edit challenge" : "Create challenge"}>
        <ChallengeForm data={data} challenge={editingChallenge} onDone={() => setEditingChallenge(null)} />
      </Panel>
      <Panel title="Challenge management">
        <div className="admin-list">
          {data.challenges.map((challenge) => (
            <div className="admin-row" key={challenge.id}>
              <div>
                <strong>{challenge.title}</strong>
                <span>{challenge.status} - {formatDateRange(challenge.startAt, challenge.endAt)}</span>
              </div>
              <div className="row-actions">
                <button title="Edit challenge" onClick={() => setEditingChallenge(challenge)}><Pencil size={16} /></button>
                <button title="Finalise challenge" onClick={() => finaliseChallenge(data, challenge)}><Check size={16} /></button>
                <button title="Delete challenge" onClick={() => deleteChallenge(data, challenge)}><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="User management">
        <div className="admin-list">
          {data.players.map((player) => (
            <div className="admin-row" key={player.id}>
              <div className="with-avatar">
                <Avatar player={player} />
                <div>
                  <strong>{player.displayName}</strong>
                  <span>{player.email}</span>
                </div>
              </div>
              <div className="row-actions">
                <button onClick={() => updateUserFlag(data, player, "admin", !player.admin)}>{player.admin ? "Admin" : "Make admin"}</button>
                <button onClick={() => updateUserFlag(data, player, "disabled", !player.disabled)}>{player.disabled ? "Restore" : "Disable"}</button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Overall points">
        <div className="admin-list">
          {data.results.map((result) => {
            const player = data.players.find((item) => item.id === result.userId);
            const challenge = data.challenges.find((item) => item.id === result.challengeId);
            return (
              <div className="admin-row" key={result.id}>
                <div>
                  <strong>{player?.displayName ?? "Unknown player"}</strong>
                  <span>{challenge?.title ?? "Deleted challenge"} - #{result.finalRank}</span>
                </div>
                <input
                  className="mini-input"
                  type="number"
                  defaultValue={result.overallPointsAwarded}
                  onBlur={(event) => updateOverallPoints(data, result, Number(event.target.value))}
                  aria-label="Overall points awarded"
                />
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function ChallengeForm({ data, challenge, onDone }: { data: AppData; challenge: Challenge | null; onDone: () => void }) {
  const [form, setForm] = useState<ChallengeFormState>(defaultChallengeForm);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(
      challenge
        ? {
            title: challenge.title,
            description: challenge.description,
            startAt: toInputDateTime(challenge.startAt),
            endAt: toInputDateTime(challenge.endAt),
            status: challenge.status,
            scoringLabel: challenge.scoringLabel,
            aggregationType: challenge.aggregationType,
            scoreDirection: challenge.scoreDirection,
            placementPoints: placementPointsToString(challenge.placementPoints),
            imageUrl: challenge.imageUrl ?? "",
          }
        : defaultChallengeForm,
    );
  }, [challenge]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!db) return;
    setBusy(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        startAt: Timestamp.fromDate(new Date(form.startAt)),
        endAt: Timestamp.fromDate(new Date(form.endAt)),
        status: form.status,
        scoringLabel: form.scoringLabel.trim() || "points",
        aggregationType: form.aggregationType,
        scoreDirection: form.scoreDirection,
        placementPoints: parsePlacementPoints(form.placementPoints),
        imageUrl: form.imageUrl.trim(),
        timezone: APP_TIMEZONE,
        updatedAt: serverTimestamp(),
      };
      if (challenge) {
        await updateDoc(doc(db, "challenges", challenge.id), payload);
        await addAudit("Challenge edited", data.firebaseUser?.uid, { challengeId: challenge.id });
        data.toast("Challenge updated.", "success");
      } else {
        await addDoc(collection(db, "challenges"), { ...payload, createdAt: serverTimestamp() });
        data.toast("Challenge created.", "success");
      }
      onDone();
    } catch (error) {
      data.toast(friendlyError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <label>
        Challenge name
        <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
      </label>
      <label>
        Description
        <textarea required rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
      </label>
      <div className="form-grid two">
        <label>
          Start
          <input type="datetime-local" required value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} />
        </label>
        <label>
          End
          <input type="datetime-local" required value={form.endAt} onChange={(event) => setForm({ ...form, endAt: event.target.value })} />
        </label>
      </div>
      <div className="form-grid two">
        <label>
          Status
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ChallengeStatus })}>
            <option value="draft">Draft</option>
            <option value="upcoming">Upcoming</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <label>
          Score label
          <input value={form.scoringLabel} onChange={(event) => setForm({ ...form, scoringLabel: event.target.value })} />
        </label>
      </div>
      <div className="form-grid two">
        <label>
          Aggregation
          <select value={form.aggregationType} onChange={(event) => setForm({ ...form, aggregationType: event.target.value as AggregationType })}>
            <option value="sum">Add submissions to total</option>
            <option value="replace">Latest submission replaces score</option>
          </select>
        </label>
        <label>
          Ranking
          <select value={form.scoreDirection} onChange={(event) => setForm({ ...form, scoreDirection: event.target.value as ScoreDirection })}>
            <option value="higher">Highest score wins</option>
            <option value="lower">Lowest score wins</option>
          </select>
        </label>
      </div>
      <label>
        Placement points
        <input value={form.placementPoints} onChange={(event) => setForm({ ...form, placementPoints: event.target.value })} />
      </label>
      <label>
        Optional image URL
        <input value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} />
      </label>
      <button className="primary-action" disabled={busy}>{busy ? "Saving..." : challenge ? "Save challenge" : "Create challenge"}</button>
    </form>
  );
}

function SubmissionForm({
  data,
  challenge,
  submission,
  onClose,
}: {
  data: AppData;
  challenge: Challenge;
  submission?: Submission;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(submission?.title ?? "");
  const [description, setDescription] = useState(submission?.description ?? "");
  const [score, setScore] = useState(String(submission?.score ?? ""));
  const [imageUrls, setImageUrls] = useState<string[]>(submission?.imageUrls ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Saving...");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!db || !data.firebaseUser) return;
    setBusy(true);
    try {
      const submissionRef = submission ? doc(db, "submissions", submission.id) : doc(collection(db, "submissions"));
      const uploadedUrls = [];
      for (const [index, file] of files.entries()) {
        setBusyLabel(`Uploading photo ${index + 1} of ${files.length}...`);
        const blob = await compressImage(file);
        uploadedUrls.push(await uploadImage(blob));
      }
      setBusyLabel("Saving...");
      const payload = {
        challengeId: challenge.id,
        userId: data.firebaseUser.uid,
        title: title.trim(),
        description: description.trim(),
        score: Number(score),
        imageUrls: [...imageUrls, ...uploadedUrls],
      };
      if (submission) {
        await updateDoc(submissionRef, { ...payload, updatedAt: serverTimestamp() });
        data.toast("Submission updated.", "success");
      } else {
        await setDoc(submissionRef, { ...payload, createdAt: serverTimestamp(), updatedAt: null });
        data.toast("Result submitted.", "success");
      }
      onClose();
    } catch (error) {
      data.toast(friendlyError(error), "error");
    } finally {
      setBusy(false);
      setBusyLabel("Saving...");
    }
  };

  return (
    <Modal title={submission ? "Edit submission" : "Submit result"} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label>
          Title
          <input required value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          Description
          <textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label>
          Your score ({challenge.scoringLabel})
          <input required type="number" step="any" value={score} onChange={(event) => setScore(event.target.value)} />
        </label>
        {imageUrls.length > 0 && (
          <div className="thumb-list">
            {imageUrls.map((url) => (
              <button type="button" key={url} onClick={() => setImageUrls((items) => items.filter((item) => item !== url))}>
                <img src={url} alt="Uploaded evidence" />
                <X size={14} />
              </button>
            ))}
          </div>
        )}
        <label className={cloudinaryReady ? "file-button" : "file-button disabled"}>
          <ImagePlus size={18} /> {cloudinaryReady ? "Add photos" : "Photos need Cloudinary setup"}
          <input disabled={!cloudinaryReady} type="file" accept="image/*" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
        </label>
        {files.length > 0 && <p className="upload-summary">{files.length} {files.length === 1 ? "photo" : "photos"} ready to upload</p>}
        <button className="primary-action" disabled={busy}>{busy ? busyLabel : "Save submission"}</button>
      </form>
    </Modal>
  );
}

function Feed({ submissions, data, condensed = false }: { submissions: Submission[]; data: AppData; condensed?: boolean }) {
  const ordered = [...submissions].sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  if (!ordered.length) return <EmptyState title="No submissions yet" body="Be the first to post your result." small />;
  return (
    <div className={condensed ? "feed condensed" : "feed"}>
      {ordered.map((submission) => (
        <SubmissionCard key={submission.id} submission={submission} data={data} condensed={condensed} />
      ))}
    </div>
  );
}

function SubmissionCard({ submission, data, condensed }: { submission: Submission; data: AppData; condensed?: boolean }) {
  const player = data.players.find((item) => item.id === submission.userId);
  const challenge = data.challenges.find((item) => item.id === submission.challengeId);
  const [editing, setEditing] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const postVotes = data.votes.filter((vote) => vote.targetType === "post" && vote.targetId === submission.id && vote.value === 1);
  const hasVoted = postVotes.some((vote) => vote.userId === data.firebaseUser?.uid);
  const canManage = data.isAdmin || submission.userId === data.firebaseUser?.uid;

  return (
    <article className="submission-card">
      <header className="post-header">
        {player ? (
          <Link className="with-avatar player-link" to={`/players/${player.id}`}>
            <Avatar player={player} />
            <div>
              <strong>{player.displayName}</strong>
              <span>{formatTimeAgo(submission.createdAt)}{submission.updatedAt ? " - Edited" : ""}</span>
            </div>
          </Link>
        ) : (
          <div className="with-avatar"><Avatar /><strong>Unknown player</strong></div>
        )}
        <div className="score-pill">+{submission.scoreOverride ?? submission.score} {challenge?.scoringLabel ?? "pts"}</div>
      </header>
      {submission.imageUrls?.length > 0 && <ImageCarousel urls={submission.imageUrls} onOpen={setViewerIndex} />}
      <footer className="post-actions">
        <button className={hasVoted ? "active like-action" : "like-action"} onClick={() => toggleVote(data, "post", submission.id, 1)} aria-label="Like submission">
          <Heart size={19} fill={hasVoted ? "currentColor" : "none"} /> {postVotes.length}
        </button>
        {!condensed && (
          <a href={`#comments-${submission.id}`} aria-label="View comments"><MessageCircle size={19} /> {data.comments.filter((comment) => comment.postId === submission.id).length}</a>
        )}
        {canManage && (
          <span className="post-owner-actions">
            <button onClick={() => setEditing(true)} aria-label="Edit submission" title="Edit"><Pencil size={17} /></button>
            <button onClick={() => deleteSubmission(data, submission)} aria-label="Delete submission" title="Delete"><Trash2 size={17} /></button>
          </span>
        )}
      </footer>
      <div className="post-caption">
        <h3>{submission.title}</h3>
        {submission.description && <p>{submission.description}</p>}
      </div>
      {!condensed && <CommentThread data={data} submission={submission} />}
      {editing && challenge && <SubmissionForm data={data} challenge={challenge} submission={submission} onClose={() => setEditing(false)} />}
      {viewerIndex !== null && <ImageViewer urls={submission.imageUrls} index={viewerIndex} onClose={() => setViewerIndex(null)} />}
    </article>
  );
}

function ImageCarousel({ urls, onOpen }: { urls: string[]; onOpen: (index: number) => void }) {
  const [index, setIndex] = useState(0);
  const move = (delta: number) => setIndex((current) => (current + delta + urls.length) % urls.length);
  return (
    <div className="carousel">
      <button className="image-button" onClick={() => onOpen(index)}>
        <img src={urls[index]} alt="Submission evidence" />
      </button>
      {urls.length > 1 && (
        <>
          <button className="carousel-control left" onClick={() => move(-1)} aria-label="Previous image"><ChevronLeft size={20} /></button>
          <button className="carousel-control right" onClick={() => move(1)} aria-label="Next image"><ChevronRight size={20} /></button>
          <div className="dots">{urls.map((url, itemIndex) => <span key={url} className={itemIndex === index ? "active" : ""} />)}</div>
        </>
      )}
    </div>
  );
}

function ImageViewer({ urls, index, onClose }: { urls: string[]; index: number; onClose: () => void }) {
  const [current, setCurrent] = useState(index);
  const move = (delta: number) => setCurrent((value) => (value + delta + urls.length) % urls.length);
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") setCurrent((value) => (value - 1 + urls.length) % urls.length);
      if (event.key === "ArrowRight") setCurrent((value) => (value + 1 + urls.length) % urls.length);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose, urls.length]);
  return createPortal(
    <div className="viewer-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <button className="viewer-close" onClick={onClose} aria-label="Close image viewer"><X size={22} /></button>
      {urls.length > 1 && <button className="viewer-nav left" onClick={(event) => { event.stopPropagation(); move(-1); }}><ChevronLeft /></button>}
      <img src={urls[current]} alt="Submission evidence enlarged" onClick={(event) => event.stopPropagation()} />
      {urls.length > 1 && <button className="viewer-nav right" onClick={(event) => { event.stopPropagation(); move(1); }}><ChevronRight /></button>}
    </div>,
    document.body,
  );
}

function CommentThread({ data, submission }: { data: AppData; submission: Submission }) {
  const [text, setText] = useState("");
  const topLevel = data.comments.filter((comment) => comment.postId === submission.id && !comment.parentCommentId);
  return (
    <section className="comments" id={`comments-${submission.id}`}>
      <form className="comment-form" onSubmit={(event) => addComment(event, data, submission.id, text, setText)}>
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Add a comment" aria-label="Add a comment" />
        <button disabled={!text.trim()}><Send size={16} /></button>
      </form>
      {topLevel.length ? (
        topLevel.map((comment) => <CommentRow key={comment.id} data={data} comment={comment} />)
      ) : (
        <p className="muted small-text">No comments yet.</p>
      )}
    </section>
  );
}

function CommentRow({ data, comment }: { data: AppData; comment: CommentItem }) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(comment.text);
  const player = data.players.find((item) => item.id === comment.userId);
  const replies = data.comments.filter((item) => item.parentCommentId === comment.id);
  const score = data.votes.filter((vote) => vote.targetType === "comment" && vote.targetId === comment.id).reduce((sum, vote) => sum + vote.value, 0);
  const canManage = data.isAdmin || comment.userId === data.firebaseUser?.uid;

  const saveEdit = async () => {
    if (!db) return;
    await updateDoc(doc(db, "comments", comment.id), { text: editText, updatedAt: serverTimestamp() });
    setEditing(false);
    data.toast("Comment updated.", "success");
  };

  return (
    <div className="comment">
      <div className="with-avatar">
        {player ? <Link to={`/players/${player.id}`} aria-label={`${player.displayName}'s profile`}><Avatar player={player} /></Link> : <Avatar />}
        <div className="comment-body">
          {player ? <Link className="comment-author" to={`/players/${player.id}`}>{player.displayName}</Link> : <strong>Unknown player</strong>}
          {editing ? (
            <div className="inline-edit">
              <input value={editText} onChange={(event) => setEditText(event.target.value)} />
              <button onClick={saveEdit}>Save</button>
            </div>
          ) : (
            <p>{comment.text}</p>
          )}
          <div className="comment-actions">
            <button onClick={() => toggleVote(data, "comment", comment.id, 1)}><ThumbsUp size={14} /></button>
            <span>{score}</span>
            <button onClick={() => toggleVote(data, "comment", comment.id, -1)}><ThumbsDown size={14} /></button>
            {!comment.parentCommentId && <button onClick={() => setReplying(!replying)}>Reply</button>}
            {canManage && <button onClick={() => setEditing(true)}>Edit</button>}
            {canManage && <button onClick={() => deleteComment(data, comment)}>Delete</button>}
          </div>
        </div>
      </div>
      {replying && (
        <form className="comment-form reply" onSubmit={(event) => addComment(event, data, comment.postId, reply, setReply, comment.id)}>
          <input value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply" aria-label="Reply" />
          <button disabled={!reply.trim()}><Send size={16} /></button>
        </form>
      )}
      {replies.length > 0 && <div className="replies">{replies.map((item) => <CommentRow key={item.id} data={data} comment={item} />)}</div>}
    </div>
  );
}

function Leaderboard({ rows, currentUserId, compact = false, overall = false }: { rows: RankedPlayer[]; currentUserId?: string; compact?: boolean; overall?: boolean }) {
  if (!rows.length) return <EmptyState title="No scores yet" body="Scores will appear as players submit results." small />;
  return (
    <div className={compact ? "leaderboard compact" : "leaderboard"}>
      {rows.map((row) => (
        <Link className={`leaderboard-row rank-${Math.min(row.rank, 3)} ${row.userId === currentUserId ? "current" : ""}`} key={row.userId} to={`/players/${row.userId}`}>
          <RankBadge rank={row.rank} />
          <Avatar player={row.player} />
          <div className="leaderboard-name">
            <strong>{row.player.displayName}</strong>
            {overall && <span>{row.wins ?? 0} wins - {row.podiums ?? 0} top threes</span>}
          </div>
          <strong className="leaderboard-score">{row.score}</strong>
        </Link>
      ))}
    </div>
  );
}

function YourPosition({ rows, userId, unit }: { rows: RankedPlayer[]; userId?: string; unit: string }) {
  const row = rows.find((item) => item.userId === userId);
  if (!row) return <EmptyState title="No score yet" body="Submit a result to see your position." small />;
  return (
    <div className="position-card">
      <RankBadge rank={row.rank} />
      <strong>#{row.rank}</strong>
      <span>{row.score} {unit}</span>
      <p>{getPositionCopy(rows, userId)}</p>
    </div>
  );
}

function Countdown({ challenge }: { challenge: Challenge }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="countdown" aria-live="polite">
      <span>{challenge.status === "completed" ? "Completed" : "Ends in"}</span>
      <strong>{formatCountdown(challenge.endAt, now, false)}</strong>
    </div>
  );
}

function Avatar({ player, large = false }: { player?: Partial<Player>; large?: boolean }) {
  const initials =
    player?.displayName
      ?.split(" ")
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  return player?.photoURL ? (
    <img className={large ? "avatar large" : "avatar"} src={player.photoURL} alt={`${player.displayName} profile`} />
  ) : (
    <span className={large ? "avatar large" : "avatar"} aria-label={player?.displayName}>{initials}</span>
  );
}

function RankBadge({ rank }: { rank: number }) {
  return <span className={`rank-badge rank-${Math.min(rank, 3)}`}>#{rank}</span>;
}

function Page({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <div className="page">
      <header className="page-header">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
      </header>
      {children}
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <header>
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function EmptyState({ title, body, small = false }: { title: string; body: string; small?: boolean }) {
  return (
    <div className={small ? "empty-state small" : "empty-state"}>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const listener = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", listener);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", listener);
    };
  }, [onClose]);
  return createPortal(
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2 id="modal-title">{title}</h2>
          <button onClick={onClose} aria-label="Close modal"><X size={20} /></button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}

function ScreenLoader({ label }: { label: string }) {
  return (
    <main className="setup-screen">
      <div className="loader" />
      <p>{label}</p>
    </main>
  );
}

function ToastStack({ toasts }: { toasts: ToastMessage[] }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => <div key={toast.id} className={`toast ${toast.tone}`}>{toast.text}</div>)}
    </div>
  );
}

async function addComment(
  event: FormEvent,
  data: AppData,
  postId: string,
  text: string,
  clear: (value: string) => void,
  parentCommentId: string | null = null,
) {
  event.preventDefault();
  if (!db || !data.firebaseUser || !text.trim()) return;
  try {
    await addDoc(collection(db, "comments"), {
      postId,
      userId: data.firebaseUser.uid,
      text: text.trim(),
      parentCommentId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    clear("");
  } catch (error) {
    data.toast(friendlyError(error), "error");
  }
}

async function toggleVote(data: AppData, targetType: VoteTargetType, targetId: string, value: 1 | -1) {
  if (!db || !data.firebaseUser) return;
  const id = `${targetType}_${targetId}_${data.firebaseUser.uid}`;
  const existing = data.votes.find((vote) => vote.id === id);
  try {
    if (existing?.value === value) {
      await deleteDoc(doc(db, "votes", id));
    } else {
      await setDoc(doc(db, "votes", id), {
        targetType,
        targetId,
        userId: data.firebaseUser.uid,
        value,
        createdAt: existing?.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    data.toast(friendlyError(error), "error");
  }
}

async function deleteSubmission(data: AppData, submission: Submission) {
  if (!db || !window.confirm("Delete this submission? This cannot be undone.")) return;
  try {
    await updateDoc(doc(db, "submissions", submission.id), { deletedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    data.toast("Submission deleted.", "success");
  } catch (error) {
    data.toast(friendlyError(error), "error");
  }
}

async function deleteComment(data: AppData, comment: CommentItem) {
  if (!db || !window.confirm("Delete this comment?")) return;
  try {
    await updateDoc(doc(db, "comments", comment.id), { deletedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    data.toast("Comment deleted.", "success");
  } catch (error) {
    data.toast(friendlyError(error), "error");
  }
}

async function finaliseChallenge(data: AppData, challenge: Challenge) {
  if (!db) return;
  const rows = buildChallengeLeaderboard(challenge, data.submissions, data.players);
  const finalResults = buildFinalResults(challenge, rows);
  const batch = writeBatch(db);
  batch.update(doc(db, "challenges", challenge.id), {
    status: "completed",
    completedAt: serverTimestamp(),
    finalisedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  for (const result of finalResults) {
    batch.set(doc(db, "challengeResults", result.id), {
      ...result,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
  await addAudit("Challenge finalised", data.firebaseUser?.uid, { challengeId: challenge.id });
  data.toast("Challenge finalised and overall points recalculated.", "success");
}

async function deleteChallenge(data: AppData, challenge: Challenge) {
  if (!db || !window.confirm(`Delete "${challenge.title}"? This will remove the challenge and associated competition data.`)) return;
  const database = db;
  const batch = writeBatch(database);
  batch.update(doc(database, "challenges", challenge.id), { deletedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  data.results
    .filter((result) => result.challengeId === challenge.id)
    .forEach((result) => batch.delete(doc(database, "challengeResults", result.id)));
  await batch.commit();
  await addAudit("Challenge deleted", data.firebaseUser?.uid, { challengeId: challenge.id });
  data.toast("Challenge deleted.", "success");
}

async function updateUserFlag(data: AppData, player: Player, flag: "admin" | "disabled", value: boolean) {
  if (!db) return;
  await updateDoc(doc(db, "users", player.id), { [flag]: value, updatedAt: serverTimestamp() });
  await addAudit(`User ${flag} changed`, data.firebaseUser?.uid, { userId: player.id, value });
  data.toast("User updated.", "success");
}

async function updateOverallPoints(data: AppData, result: ChallengeResult, value: number) {
  if (!db || value === result.overallPointsAwarded) return;
  await updateDoc(doc(db, "challengeResults", result.id), { overallPointsAwarded: value, updatedAt: serverTimestamp() });
  await addAudit("Overall points edited", data.firebaseUser?.uid, { resultId: result.id, value });
  data.toast("Overall points updated.", "success");
}

async function addAudit(action: string, userId?: string, details?: Record<string, unknown>) {
  if (!db) return;
  await addDoc(collection(db, "auditLogs"), {
    action,
    userId: userId ?? null,
    details: details ?? {},
    createdAt: serverTimestamp(),
  });
}

export default App;
