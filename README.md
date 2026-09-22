# Challenge

Challenge is a private multiplayer competition web app for a group of friends. Players create accounts, join recurring challenges, submit scores with optional photo evidence, comment and vote on submissions, and earn placement points toward an overall yearly leaderboard.

The app is a responsive static frontend designed for GitHub Pages with Firebase handling authentication, Firestore, Storage, and realtime updates.

For a browser-only setup walkthrough with no local command-line steps, open:

```text
public/setup-guide.html
```

## Technology Stack

- React + TypeScript
- Vite static build
- Firebase Authentication
- Cloud Firestore
- Firebase Storage
- React Router with `HashRouter` for GitHub Pages refresh safety
- lucide-react icons

## Install

```bash
pnpm install
```

## Firebase Setup

1. Create a Firebase project.
2. Enable Authentication, then enable Email/Password sign-in.
3. Create a Cloud Firestore database.
4. Enable Firebase Storage.
5. In Project settings, create a Web app and copy the Firebase config values.
6. Copy `.env.example` to `.env` and fill in the values:

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## Run Locally

```bash
pnpm dev
```

## Build

```bash
pnpm build
```

The production output is written to `dist/`.

## Deploy to GitHub Pages

The repo includes `.github/workflows/deploy-pages.yml`.

1. Push the project to GitHub.
2. In the GitHub repo, add these repository secrets:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
3. Enable GitHub Pages with GitHub Actions as the source.
4. Push to `main` or run the workflow manually.

The app uses hash routes such as `/#/current`, so browser refreshes work on GitHub Pages without a custom server.

## Firestore Structure

Collections used by the app:

- `users`: player profiles, display names, avatars, admin/disabled flags
- `challenges`: challenge title, dates, status, scoring configuration, placement points
- `submissions`: player posts with score, description, image URLs, and soft-delete state
- `comments`: top-level comments and one-level replies
- `votes`: deterministic vote documents using `targetType_targetId_userId`
- `challengeResults`: finalised challenge results and awarded overall points
- `auditLogs`: lightweight admin action history

Scoring is calculated from submissions in `src/lib/scoring.ts`. Completed challenge results are written with stable document IDs, so recalculating a historical challenge replaces the old result instead of duplicating overall points.

## Firebase Rules

Deploy the included rules and indexes with the Firebase CLI:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

This MVP uses the requested Settings -> Admin password flow. Entering password `67` marks the current user as admin in Firestore. That keeps the UI simple for a private friends-only app while isolating the admin concept so it can later be replaced with Firebase custom claims or a server-side role assignment flow.

Do not store service account keys or private credentials in this repo.

## Storage

Profile photos are uploaded under:

```text
profiles/{userId}/avatar.jpg
```

Submission evidence photos are compressed in the browser and uploaded under:

```text
submissions/{userId}/{submissionId}/{imageId}.jpg
```

Photos are optional. Posts without photos are rendered without empty image containers.

## First Setup Flow

1. Configure Firebase and run the app.
2. Create your account.
3. Go to Settings -> Admin.
4. Enter password `67`.
5. Create the first challenge.
6. Set its status to `active`.
7. Players can now submit results, vote, comment, and watch the leaderboard update.

When a challenge ends, submissions are blocked by the UI. An admin can finalise the challenge from Settings, which stores final rankings and awards yearly overall points from the challenge's placement-point configuration.

## Admin Tools

Admin mode includes:

- Create/edit/delete challenges
- Finalise completed challenges
- Recalculate overall points
- User admin/disabled flags
- Post and comment moderation
- Submission score correction through post editing
- Overall points correction

Destructive actions ask for confirmation.

## Notes

- Tie handling is deterministic: equal scores share the same rank, the next rank skips appropriately, and tied rows are ordered by display name.
- Challenge scoring can add submissions together or use the latest submission as the player's score.
- The application timezone is `Europe/London` and is centralised in `src/lib/time.ts`.
- Firebase realtime listeners keep competition data live across devices.
