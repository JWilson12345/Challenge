import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseReady = Object.values(firebaseConfig).every(Boolean);

export const app = firebaseReady ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

export function friendlyError(error: unknown) {
  if (error instanceof Error && error.name === "ImageUploadError") return error.message;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code.includes("auth/email-already-in-use")) return "That email already has an account.";
  if (code.includes("auth/invalid-credential")) return "The email or password is not right.";
  if (code.includes("auth/weak-password")) return "Use a stronger password.";
  if (code.includes("permission-denied")) return "You do not have permission to do that.";
  return "Something went wrong. Please try again.";
}
