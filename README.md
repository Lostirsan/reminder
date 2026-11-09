# Pago a Tempo

> The original single-file Node prototype (`server.js`, `env.txt`) lives on the [`prototype`](../../tree/prototype) branch.

Overdue-invoice reminders for Portuguese SMEs: reads open invoices (Moloni or manual), sends polite
WhatsApp and email reminders on a schedule, and gives each customer a pay link (MB WAY / Multibanco
via Stripe). The invoice closes itself when the payment arrives.

**Stack:** Next.js 16 (App Router, TypeScript) · Supabase (Postgres in Frankfurt, Auth, RLS, pg_cron) ·
Cloudflare Workers via OpenNext · next-intl (pt-PT, en) · Tailwind 4. No payment/messaging SDKs:
plain `fetch` + Web Crypto, so everything runs on Workers.

## How it works

| Piece | Where |
|---|---|
| Schema, tenant isolation (RLS), GDPR delete | `supabase/migrations/*_core.sql` |
| Every 15 min: pg_cron → `POST /api/cron/tick` (secret from Supabase Vault) | `*_cron.sql`, `src/app/api/cron/tick` |
| Tick: sync Moloni, then send due reminders (weekdays 9–19 Lisbon, each step once) | `src/lib/scheduler.ts`, `src/lib/sync.ts` |
| Ladder and texts (pre-due, day 1, day 5, day 11 firm + DL 62/2013 interest), PT/EN | `src/lib/reminders.ts` |
| Sending + logging (Twilio / Meta WhatsApp, Resend email, wa.me link) | `src/lib/send.ts`, `src/lib/providers/*` |
| Public pay link `/pay/<token>`: IBAN + invoice number, MB WAY phone, "Já paguei"; Stripe Checkout if configured | `src/app/pay/[token]` |
| Free payment detection: CSV bank statement upload or Enable Banking (open banking), matched by amount + invoice number | `src/lib/bank.ts`, `src/lib/banksync.ts`, `src/app/app/bank` |
| Webhooks: Stripe (paid), Twilio (delivered/read) — both signature-checked | `src/app/api/webhooks/*` |
| Moloni OAuth connect, tokens AES-GCM encrypted in a table clients can't read | `src/app/api/integrations/moloni`, `src/lib/crypto.ts` |
| UI strings | `src/messages/{pt,en}.json` |

Without provider keys the app runs in **demo mode**: messages are logged as "simulated", and with
`ALLOW_DEMO_PAYMENTS=1` the pay page shows a "simulate payment" button.
`WHATSAPP_TEST_RECIPIENT` / `EMAIL_TEST_RECIPIENT` redirect every message to you while testing.

## Develop

```bash
npm install
npx supabase start          # local Supabase in Docker (applies migrations)
cp .env.example .env.local  # fill in the local URL/keys printed by `supabase start`
npm run dev                 # http://localhost:3000 (sign-in emails: http://127.0.0.1:54324)
```

Checks: `npm run typecheck && npm run lint && npm test && npm run test:db`
(`test:db` needs a local Postgres; `INTEGRATION=1 npm test` also runs the scheduler against `supabase start`).

## Deploy (free tiers)

1. **Supabase**: new project, region *Central EU (Frankfurt)*. Then from this folder:
   `npx supabase login && npx supabase link --project-ref <ref> && npx supabase db push`.
   In *Authentication → URL configuration*: Site URL = your app URL, redirect URL `<APP_URL>/auth/callback`.
   Optional Google sign-in: *Authentication → Providers → Google*.
2. **Cloudflare**: `npx wrangler login`, then `npm run deploy`. Set secrets with
   `npx wrangler secret put <NAME>` for every non-empty variable in `.env.example`
   (`NEXT_PUBLIC_*` must also be present at build time: put them in `.env.production` locally, it's gitignored).
3. **Cron**: in the Supabase SQL editor:
   ```sql
   select vault.create_secret('https://<your-app>/api/cron/tick', 'cron_url');
   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
   ```
4. **Stripe**: Developers → Webhooks → endpoint `<APP_URL>/api/webhooks/stripe`, events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`; copy the signing secret
   into `STRIPE_WEBHOOK_SECRET`. Enable MB WAY and Multibanco under Payment methods.
5. **Bank (free)**: customers pay by transfer to the IBAN set in *Definições → Como os clientes pagam*.
   The owner uploads a CSV statement on */app/bank*, or connects the bank through Enable Banking:
   enablebanking.com → Control Panel → *Applications* → new **production** app (the key is generated
   in the browser and downloaded as `.pem`), redirect URL `<APP_URL>/api/integrations/enablebanking/callback`;
   secrets `ENABLEBANKING_APP_ID` and `ENABLEBANKING_PRIVATE_KEY`. Without a contract the app is in
   free *restricted* mode: each pilot's account must first be linked once in the Control Panel
   (*Link accounts*, the owner confirms in their bank app); then *Ligar banco* in our app works for it.
   Reads every 6 hours (PSD2 limits unattended reads to ~4/day); consents last up to 180 days.
   Exact match (invoice number in the transfer description + same amount) closes the invoice and
   sends the thank-you; amount-only matches and "Já paguei" wait for the owner on the Bank page.
6. **Moloni**: in the developer area set the redirect URL `<APP_URL>/api/integrations/moloni/callback`.

Free-tier limits: Supabase 500 MB / 50k MAU (pauses after 7 idle days, which the cron prevents; no
backups → move to Pro, $25/month, with the first paying customer); Workers 100k requests/day;
Resend 3,000 emails/month.

## Not yet

InvoiceXpress and TOConline sync, team invites, Stripe Connect (payouts straight to each company:
needs a registered business), per-company WhatsApp numbers, CSV import of invoices, Excel (.xlsx)
statements (save as CSV meanwhile), Enable Banking full production (contract + company KYB).
