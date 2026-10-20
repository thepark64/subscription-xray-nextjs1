"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type LinkStatus = "checking" | "valid" | "invalid";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [linkStatus, setLinkStatus] = useState<LinkStatus>("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Supabase fires PASSWORD_RECOVERY once it reads the token from the
    // emailed link's URL. If that never fires, the link was invalid,
    // expired, or the redirect URL isn't whitelisted in Supabase's
    // dashboard (Authentication -> URL Configuration -> Redirect URLs) —
    // in every one of those cases, this shows a clear message instead of
    // leaving a form the user can submit into a silent failure.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setLinkStatus("valid");
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setLinkStatus("valid");
    });

    const timeout = setTimeout(() => {
      setLinkStatus((current) => (current === "checking" ? "invalid" : current));
    }, 8000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) { setError(updateError.message); return; }
    setDone(true);
  }

  if (linkStatus === "checking") {
    return (
      <main className="auth-page">
        <div className="wrap auth-wrap">
          <p className="lede">Checking your reset link…</p>
        </div>
      </main>
    );
  }

  if (linkStatus === "invalid") {
    return (
      <main className="auth-page">
        <div className="wrap auth-wrap">
          <h1>This link didn&apos;t work</h1>
          <p className="lede">
            It may have expired (reset links are time-limited) or already been used.
            Request a fresh one from the sign-in page.
          </p>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => router.push("/login")}>
            Back to sign in
          </button>
        </div>
      </main>
    );
  }

  if (done) {
    return (
      <main className="auth-page">
        <div className="wrap auth-wrap">
          <h1>Password updated</h1>
          <p className="lede">You can now sign in with your new password.</p>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => router.push("/login")}>
            Go to sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <div className="wrap auth-wrap">
        <Link href="/" className="back">← Subscription X-Ray</Link>
        <h1>Set a new password</h1>
        <p className="lede">Choose a new password for your account.</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="field">
            <label>New password</label>
            <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <div className="error-box">{error}</div>}
          <button className="btn btn-primary full" type="submit" disabled={loading}>
            {loading ? "Please wait…" : "Update password"}
          </button>
        </form>
      </div>
    </main>
  );
}
