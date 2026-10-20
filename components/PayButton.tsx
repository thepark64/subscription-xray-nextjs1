"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { PACK_PRICE_LABEL, PACK_SIZE, SUPPORT_EMAIL } from "@/lib/config";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadCheckoutScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

/**
 * Opens Razorpay Checkout for one scan pack. Credits are only ever granted by
 * the webhook — this component never trusts the browser-side success callback
 * — so after payment it simply waits for the new balance to appear.
 */
export default function PayButton({
  currentCredits,
  onCreditsChanged,
}: {
  currentCredits: number;
  onCreditsChanged: () => Promise<number>; // refetches balance, returns it
}) {
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");

  async function waitForCredits() {
    setWaiting(true);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const latest = await onCreditsChanged();
      if (latest > currentCredits) {
        setWaiting(false);
        setBusy(false);
        return;
      }
    }
    setWaiting(false);
    setBusy(false);
    setError(
      `Your payment went through but credits haven't appeared yet. Refresh in a minute, or email ${SUPPORT_EMAIL} with your payment ID.`
    );
  }

  async function pay() {
    setError("");
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Please sign in first.");

      const ok = await loadCheckoutScript();
      if (!ok || !window.Razorpay) throw new Error("Could not load the payment window. Check your connection.");

      const res = await fetch("/api/razorpay/order", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const order = await res.json();
      if (!res.ok) throw new Error(order.error ?? "Could not start the payment.");

      const checkout = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: "Subscription X-Ray",
        description: `${PACK_SIZE} statement scans`,
        prefill: { email: order.email },
        theme: { color: "#233247" },
        handler: () => {
          void waitForCredits();
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      checkout.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn btn-primary" onClick={pay} disabled={busy || waiting}>
        {waiting ? "Confirming payment…" : busy ? "Opening payment…" : `Pay ${PACK_PRICE_LABEL} for ${PACK_SIZE} scans`}
      </button>
      {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
    </div>
  );
}
