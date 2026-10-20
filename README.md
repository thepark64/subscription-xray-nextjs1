# Subscription X-Ray

Next.js 15 + Supabase + Razorpay. Users sign up, pay once (₹69) for a pack of 12
scans, then upload a bank/card statement CSV. The CSV is parsed **in the browser**;
only the detected merchants and totals are saved to the user's account.

## How it works

- `lib/detection.ts` — CSV parser and recurring-charge detection (DD/MM dates,
  Debit/Credit or signed Amount columns, header row found automatically).
- `lib/services.ts` — known services → manage/cancel page (links shown only on a match).
- `app/api/razorpay/order` — creates a server-priced order tagged with the user's id.
- `app/api/razorpay/webhook` — verifies the signature, then `process_payment()` records
  the payment and grants 12 credits in one database transaction (safe to retry).
- `supabase/schema.sql` — tables, RLS, signup trigger, credit functions.

Credits are only ever granted by the webhook (service role). The browser can spend a
credit (`consume_scan_credit`) but can never add one.

## Setup

See `START-HERE.txt` for the step-by-step.

## Known limitations

- Scan gating is enforced in the browser (the CSV never reaches the server by design),
  so a technical user could bypass the credit check. Accepted trade-off for a ₹69 product.
- Detection is heuristic. Statements shorter than ~45 days can't reveal monthly charges.
- Unmatched payments (no account found) are logged as `UNMATCHED PAYMENT` and need a
  manual refund/credit — see Vercel function logs.
- No rate limiting on `/api/razorpay/order`; add one (e.g. Vercel/Upstash) if abused.
- Do not advertise support for a specific bank until you've tested its export format.
