"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { PACK_PRICE_LABEL, PACK_SIZE } from "@/lib/config";

type Mode = "signin" | "signup" | "forgot";

export default function LoginPage() {
  const router = useRouter();
  const [rawEmail, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<Mode>("signin");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const email = rawEmail.trim().toLowerCase();
    setError("");
    setNotice("");
    setLoading(true);

    try {
      if (mode === "forgot") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (resetError) throw resetError;
        setNotice("If an account exists for that email, a reset link is on its way. Check your inbox (and spam folder).");
        return;
      }

      if (mode === "signup") {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/scanner` },
        });
        if (authError) throw authError;

        if (!data.session) {
          setNotice("Account created — check your email to confirm it before signing in.");
          setMode("signin");
          return;
        }
        router.push("/scanner");
        router.refresh();
        return;
      }

      // mode === "signin"
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      router.push("/scanner");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setError(
        message.toLowerCase().includes("email not confirmed")
          ? "Please confirm your email first — check your inbox for the link."
          : message.toLowerCase().includes("invalid login")
          ? "Wrong email or password."
          : message
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page-v2">
      <div className="auth-shell">
        <div className="auth-brand-panel">
          <Link href="/" className="logo logo-onbrand">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="9" fill="#fff" fillOpacity="0.12" />
              <circle cx="14" cy="14" r="6.5" stroke="#fff" strokeWidth="2.2" />
              <path d="M19 19l5.5 5.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M9 14h10" stroke="#2FD5A6" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="logo-text-onbrand">subscription x-ray</span>
          </Link>
          <div className="auth-brand-copy">
            <h2>Find what you&apos;re quietly paying for.</h2>
            <p>{PACK_SIZE} scans, {PACK_PRICE_LABEL}. Runs entirely in your browser — your statement is never uploaded.</p>
          </div>
        </div>

        <div className="auth-form-panel">
          <div className="auth-form-inner">
            <h1>
              {mode === "signup" && "Create your account"}
              {mode === "signin" && "Welcome back"}
              {mode === "forgot" && "Reset your password"}
            </h1>
            <p className="lede">
              {mode === "signup" && "One payment unlocks {PACK_SIZE} scans on your account."}
              {mode === "signin" && "Sign in to use your scans."}
              {mode === "forgot" && "Enter your email and we'll send a reset link."}
            </p>

            <form onSubmit={handleSubmit} className="auth-form">
              <div className="field">
                <label>Email</label>
                <input type="email" required autoFocus value={rawEmail} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>

              {mode !== "forgot" && (
                <div className="field">
                  <label>Password</label>
                  <div className="password-wrap">
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                    />
                    <button type="button" className="password-toggle" onClick={() => setShowPassword((v) => !v)} tabIndex={-1}>
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
              )}

              {error && <div className="error-box">{error}</div>}
              {notice && <div className="notice-box">{notice}</div>}

              <button className="btn btn-primary full" type="submit" disabled={loading}>
                {loading ? "Please wait…" : mode === "signup" ? "Create account" : mode === "signin" ? "Sign in" : "Send reset link"}
              </button>
            </form>

            <div className="auth-links">
              {mode === "signin" && (
                <>
                  <button className="link-btn" onClick={() => { setMode("forgot"); setError(""); setNotice(""); }}>Forgot password?</button>
                  <span className="auth-switch">New here? <button className="link-btn inline" onClick={() => { setMode("signup"); setError(""); setNotice(""); }}>Create an account</button></span>
                </>
              )}
              {mode === "signup" && (
                <span className="auth-switch">Already have an account? <button className="link-btn inline" onClick={() => { setMode("signin"); setError(""); setNotice(""); }}>Sign in</button></span>
              )}
              {mode === "forgot" && (
                <button className="link-btn" onClick={() => { setMode("signin"); setError(""); setNotice(""); }}>← Back to sign in</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
