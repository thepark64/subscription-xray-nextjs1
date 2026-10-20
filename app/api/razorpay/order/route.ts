import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { PACK_PRICE_PAISE, PACK_SIZE } from "@/lib/config";

export const runtime = "nodejs";

/**
 * Creates a Razorpay order for one scan pack, tagged with the signed-in user's
 * id. The webhook reads that tag to know exactly who to credit.
 * The price is fixed here on the server — the browser cannot change it.
 */
export async function POST(req: NextRequest) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const admin = getSupabaseAdmin();
  if (!keyId || !keySecret || !admin) {
    return NextResponse.json({ error: "Payments are not configured yet." }, { status: 500 });
  }

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) {
    return NextResponse.json({ error: "Your session expired. Please sign in again." }, { status: 401 });
  }

  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64"),
    },
    body: JSON.stringify({
      amount: PACK_PRICE_PAISE,
      currency: "INR",
      receipt: `scanpack_${Date.now()}`,
      notes: { user_id: user.id, pack_size: String(PACK_SIZE) },
    }),
  });

  if (!res.ok) {
    console.error("Razorpay order creation failed:", res.status, await res.text());
    return NextResponse.json({ error: "Could not start the payment. Please try again." }, { status: 502 });
  }

  const order = await res.json();
  return NextResponse.json({
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId, // public key id; safe to send to the browser
    email: user.email ?? "",
  });
}
