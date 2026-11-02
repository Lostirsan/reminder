# Pago a Tempo: API prototype

A small Node.js prototype that shows the overdue-invoice reminder flow end to end with **free test environments only**:

1. Reads open invoices from a **Moloni** demo company.
2. Creates a payment link in **Stripe test mode** (Stripe-hosted page in Portuguese with MB WAY and Multibanco), or a Multibanco reference / MB WAY request in the **easypay sandbox**.
3. Sends a Portuguese reminder through the **WhatsApp Cloud API** free test number, with the payment details and, for invoices more than 10 days late, the late-interest amount (DL 62/2013, 10.40% for H2 2026, plus the €40 compensation).
4. Polls the payment provider and marks the invoice paid when the sandbox payment goes through.

Each service runs live when its credentials are in `.env`; otherwise it uses mock data, so the prototype works out of the box.

## Run

Requires Node.js 18+ and no npm packages.

```bash
cp .env.example .env   # fill in what you have; empty blocks use mock data (on Windows the file may be called env.txt)
node scripts/check.js  # tests each configured service
node server.js         # open http://localhost:3000
```

## Getting the free test credentials

No company or NIF is needed for any of these test environments.

### Moloni (free developer account)
1. Register at https://www.moloni.pt (free).
2. Email apoio@moloni.pt and ask for your login to get access to the demo company for API testing ("acesso à empresa de demonstração para testes da API").
3. In Moloni: Configurações → Developers → tick "activate API", set a Developer ID and a Callback URI (any URL, for example `https://localhost/callback`), click Atualizar. Copy the Developer ID and Client Secret.
4. `.env`: `MOLONI_DEVELOPER_ID`, `MOLONI_CLIENT_SECRET`, `MOLONI_USERNAME` (login email), `MOLONI_PASSWORD`.

Docs: https://moloni.pt/dev/criar-uma-conta · sandbox: https://moloni.pt/dev/sandbox

### WhatsApp Cloud API (Meta free test number)
1. Create a Meta developer account at https://developers.facebook.com and a new app with the **WhatsApp** use case (create a business portfolio when asked; no verification needed for the test number).
2. In WhatsApp → API Setup: note the **Phone number ID** of the test number, generate a temporary **access token**, and add your own mobile number to the recipient list (max 5 numbers; confirm with the code Meta sends).
3. Send the `hello_world` test message from that page, then reply "Olá" from your phone. This opens a 24-hour window in which the prototype can send free-text reminders.
4. Optional: create a `utility` template in WhatsApp Manager with body variables {{1}} name, {{2}} invoice, {{3}} amount, {{4}} due date, {{5}} entity, {{6}} reference, and set `WA_TEMPLATE_NAME` so reminders work without the 24-hour window.
5. `.env`: `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`, `WA_TEST_RECIPIENT` (your number, e.g. `3519XXXXXXXX`).

The temporary token expires after about 24 hours; for longer demos create a System User token in Business Settings. Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/

### Stripe test mode (recommended for payments: no company needed)
1. Sign up at https://dashboard.stripe.com/register (email and password, country Portugal). Skip "activate payments": test mode works without business details.
2. In test mode, open Settings → Payment methods and turn on **MB WAY** and **Multibanco**.
3. Developers → API keys (test mode): copy the **Secret key** (`sk_test_...`).
4. `.env`: `STRIPE_SECRET_KEY`.
5. Testing: on the payment page choose MB WAY with any phone number (`+351911111112` succeeds after ~30 s), or Multibanco with the email `succeed_immediately@example.com` (paid within seconds).

Docs: https://docs.stripe.com/payments/mb-way/accept-a-payment?payment-ui=checkout · https://docs.stripe.com/payments/multibanco/accept-a-payment?payment-ui=checkout

### easypay sandbox (optional; signup asks for a company NIF)
1. Create a free sandbox account at https://id.test.easypay.pt/en/signup.
2. In the sandbox backoffice (https://backoffice.test.easypay.pt) open the API keys / Web Services section and create a key. Copy the **Account ID** and **API Key**.
3. `.env`: `EASYPAY_ACCOUNT_ID`, `EASYPAY_API_KEY`.
4. MB WAY sandbox numbers: `911234567` authorises, `917654321` fails. A Multibanco reference can be marked paid from the sandbox backoffice.

Docs: https://docs.easypay.pt/docs/environments

## Limits and notes
- Everything is test data. With the WhatsApp test number, every message goes to `WA_TEST_RECIPIENT`, never to the customer's real number.
- State is kept in memory and resets when the server restarts.
- Moloni field mapping (`net_value`, `reconciled_value`, `expiration_date`) is defensive; if the demo company returns different fields, `node scripts/check.js` shows the error.
- Never commit `.env`.
