"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Scanner from "@/components/Scanner";
import PayButton from "@/components/PayButton";
import { PACK_PRICE_LABEL, PACK_SIZE } from "@/lib/config";

type Gate = "checking" | "needs-login" | "ready" | "error";

export default function ScannerPage() {
  const [gate, setGate] = useState<Gate>("checking");
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [credits, setCredits] = useState(0);

  // Re-reads the balance. A read ERROR is not treated as "zero credits" — that
  // used to send paying users back to the payment screen on a network blip.
  const refreshCredits = useCallback(async (id: string): Promise<number> => {
    const { data, error } = await supabase.from("profiles").select("scan_credits").eq("id", id).maybeSingle();
    if (error) throw error;
    const remaining = data?.scan_credits ?? 0;
    setCredits(remaining);
    return remaining;
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setGate("needs-login");
        return;
      }
      setEmail(session.user.email ?? "");
      setUserId(session.user.id);
      try {
        await refreshCredits(session.user.id);
        setGate("ready");
      } catch {
        setGate("error");
      }
    })();
  }, [refreshCredits]);

  async function spendCredit(): Promise<boolean> {
    const { data: remaining, error } = await supabase.rpc("consume_scan_credit");
    if (error) return false;
    setCredits(remaining);
    return true;
  }

  if (gate === "checking") {
    return <main className="scanner-page"><div className="wrap"><p className="lede">Checking your account…</p></div></main>;
  }

  if (gate === "error") {
    return (
      <main className="scanner-page">
        <div className="wrap gate-card">
          <h1>Couldn&apos;t load your account</h1>
          <p className="lede">Check your connection and try again.</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Retry</button>
        </div>
      </main>
    );
  }

  if (gate === "needs-login") {
    return (
      <main className="scanner-page">
        <div className="wrap gate-card">
          <h1>Sign in to scan your statements</h1>
          <p className="lede">{PACK_PRICE_LABEL} unlocks {PACK_SIZE} scans on your account — sign in or create an account to continue.</p>
          <a className="btn btn-primary" href="/login">Sign in / create account</a>
        </div>
      </main>
    );
  }

  const locked = credits <= 0;

  return (
    <main className="scanner-page">
      <div className="wrap">
        <div className="scanner-top">
          <Link href="/" className="back">← Subscription X-Ray</Link>
          <span className="privacy-pill">
            🔒 {credits} {credits === 1 ? "scan" : "scans"} left{email ? ` · ${email}` : ""}
          </span>
        </div>
        <Scanner
          userId={userId}
          locked={locked}
          spendCredit={spendCredit}
          paywall={
            <>
              <p>
                {PACK_SIZE} scans for {PACK_PRICE_LABEL}, one-time. Nothing repeats automatically.
              </p>
              <PayButton currentCredits={credits} onCreditsChanged={() => refreshCredits(userId)} />
            </>
          }
        />
      </div>
    </main>
  );
}
