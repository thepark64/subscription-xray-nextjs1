import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { PACK_PRICE_PAISE, PACK_SIZE } from "@/lib/config";

export const runtime = "nodejs";

/**
 * Razorpay webhook.
 *
 * 1. Verifies the signature over the exact raw body (a forged request cannot
 *    grant credits).
 * 2. Works out WHICH user paid: primarily from the user_id we attached to the
 *    order's notes when the order was created (/api/razorpay/order); falls
 *    back to a case-insensitive email match for payments made some other way.
 * 3. Calls process_payment(), which records the payment and grants credits in
 *    one database transaction. A failure rolls everything back and we return
 *    500, so Razorpay's retry can succeed. A duplicate delivery grants nothing.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signatureMatches(rawBody: string, signature: string, secret: string) {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ ok: false, message: "Webhook secret not configured." }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");
  if (!signature) {
    return NextResponse.json({ ok: false, message: "Missing signature." }, { status: 400 });
  }
  if (!signatureMatches(rawBody, signature, webhookSecret)) {
    return NextResponse.json({ ok: false, message: "Invalid signature." }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, message: "Bad JSON." }, { status: 400 });
  }

  if (event.event !== "payment.captured") {
    return NextResponse.json({ ok: true, message: "Ignored (not a captured payment)." });
  }

  const payment = event.payload?.payment?.entity;
  const paymentId: string | undefined = payment?.id;
  const orderId: string | null = payment?.order_id ?? null;
  const amountPaise: number = Number(payment?.amount ?? 0);
  const currency: string | undefined = payment?.currency;

  if (!paymentId) {
    return NextResponse.json({ ok: false, message: "No payment id." }, { status: 400 });
  }

  // Never grant a full pack for a smaller (or foreign-currency) payment.
  if (currency !== "INR" || amountPaise < PACK_PRICE_PAISE) {
    console.warn(`Payment ${paymentId} ignored: ${amountPaise} ${currency} is below the pack price.`);
    return NextResponse.json({ ok: true, message: "Amount does not match a scan pack." });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    // 500 so Razorpay keeps retrying until Supabase is configured.
    return NextResponse.json({ ok: false, message: "Supabase is not configured." }, { status: 500 });
  }

  // Who paid?
  let userId: string | null = null;
  const noteUserId: unknown = payment?.notes?.user_id;
  if (typeof noteUserId === "string" && UUID_RE.test(noteUserId)) {
    const { data } = await admin.from("profiles").select("id").eq("id", noteUserId).maybeSingle();
    userId = data?.id ?? null;
  }
  if (!userId && typeof payment?.email === "string") {
    const { data } = await admin
      .from("profiles")
      .select("id")
      .ilike("email", payment.email.trim())
      .maybeSingle();
    userId = data?.id ?? null;
  }

  if (!userId) {
    // Returning 200 stops retries; the payment must be resolved by hand.
    console.error(`UNMATCHED PAYMENT ${paymentId} (${payment?.email ?? "no email"}) — no account found. Refund or credit manually.`);
    return NextResponse.json({ ok: true, message: "No matching account; flagged for manual handling." });
  }

  const { data: remaining, error } = await admin.rpc("process_payment", {
    p_user: userId,
    p_payment_id: paymentId,
    p_order_id: orderId,
    p_amount: amountPaise / 100,
    p_credits: PACK_SIZE,
  });

  if (error) {
    console.error(`process_payment failed for ${paymentId}:`, error.message);
    return NextResponse.json({ ok: false, message: "Could not record payment; will retry." }, { status: 500 });
  }

  if (remaining === null) {
    return NextResponse.json({ ok: true, message: "Already processed (duplicate webhook)." });
  }

  return NextResponse.json({ ok: true, scanCreditsRemaining: remaining });
}
