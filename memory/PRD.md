# Foxory Shift Calendar — PRD

## What
Premium mobile shift planner for nurses and caregivers with **Foxory dark-purple / neon-purple branding** applied consistently across the login screen, dashboard header, mobile navigation, exported XLSX, and email preview.

## Brand elements delivered
1. **Logo**: user-provided fox/crescent/calendar mark (`/app/frontend/assets/images/foxory-logo.png`) exposed through a single reusable `FoxoryLogo` component — swap the require path once to replace the mark globally.
2. **App name**: “Foxory Shift Calendar” on login, dashboard header, settings, and XLSX title row.
3. **Subtitle**: “Smart shift planning for nurses and caregivers.” on login screen (and shortened “Smart shift planning” on the sticky dashboard header).
4. **Account badge** (top-right of dashboard header): renders **PLUS $2.99/MONTH** for Plus accounts or **FOXORY FREE** for free accounts. Private organization eligibility is never named in general UI.
5. **Creator signature** “Created by Foxory.net” — subtle, non-ad, link-styled — appears on:
   - Login footer
   - Settings footer (plus disclaimer “A creator signature — not an advertisement.”)
   - XLSX Plan Summary sheet (bottom row)
   - Email export body (final line)
   `Foxory.net` opens `https://foxory.net` via `Linking.openURL` on tap.

## Screens
- `(auth)/login.tsx` — logo with neon halo, sign-in / register tabs, email/password fields, error box, footer signature.
- `(app)/dashboard.tsx` — sticky header + month switcher + stat cards (Draft / Confirmed / Total) + 7-column calendar grid with semantic shift chips + legend.
- `(app)/planner.tsx` — draft reminder banner, `All / Draft / Confirmed` filter chips, `Export XLSX` + `Email draft` actions, per-shift row list, XLSX success card, Email Preview bottom sheet with copy-to-clipboard.
- `(app)/settings.tsx` — profile card, App info, Access tier, Sign out, Creator signature footer.

## Backend (FastAPI + Motor/MongoDB)
- Auth: `POST /api/auth/login|register`, `GET /api/auth/me` — JWT (python-jose) + bcrypt.
- Superuser seeded idempotently on lifespan startup from `SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD` env vars.
- Shifts CRUD: `POST/GET/PATCH/DELETE /api/shifts` and `POST /api/shifts/{id}/confirm`.
- Exports:
  - `POST /api/export/xlsx` → returns `{filename, base64, size_bytes, shift_count, created_by: "Foxory.net"}`; workbook has `Plan Summary` sheet (App Name / Created By / Export Type: Draft Planner Export / Month / User / Plan / Generated At / Total Shifts + Reminder disclaimer + signature row) and `Shift Details` sheet.
  - `POST /api/export/email` → rendered subject + body ending with the Foxory creator line. **MOCKED**: no real email is sent — the frontend displays the rendered preview with copy-to-clipboard (Resend/SendGrid can be plugged in later).

## Credentials (super user)
- Email: **Sultan942002@yahoo.com**
- Password: **S.nsmjalzaabi1**
- Seed is idempotent (env-driven). See `/app/memory/test_credentials.md`.

## Test status
- 11/11 backend pytest cases pass (`/app/backend/tests/backend_test.py`).
- End-to-end mobile flow verified via Playwright screenshots (login → dashboard → shift editor → save → planner → XLSX export → email preview → settings).

## Ziina paywall (real hosted checkout)
- `GET /api/billing/config` — returns provider, price (AED 10.99/month, `1099` fils), test-mode flag, plan feature list.
- `POST /api/billing/checkout` — creates a real Ziina `payment_intent` via `https://api-v2.ziina.com/api/payment_intent`, stores the record in `payments` collection, returns `redirect_url` + `payment_intent_id`.
- `POST /api/billing/verify` — polls Ziina `GET /payment_intent/{id}`; if `status: completed` it flips the user to `plan: "plus"` and sets `plus_expires_at = now + 30d`.
- `POST /api/billing/webhook` — Ziina webhook receiver. Verifies the `X-Hmac-Signature` (HMAC-SHA256, hex-encoded) against `ZIINA_WEBHOOK_SECRET`, then idempotently flips the user to Plus on `payment_intent.status.updated → completed`. Every event is stored in the `webhook_events` collection for auditing. Rejects with **401** on bad signatures. Verified end-to-end: activate on first hit, `activated:false` on replay.
- `POST /api/billing/webhook/register` — superuser-only helper that registers the current backend's public webhook URL with Ziina using `ZIINA_WEBHOOK_SECRET`.
- Frontend `/(app)/upgrade` opens the redirect via `expo-web-browser.openAuthSessionAsync` and verifies on return.
- **Gated features** (server-enforced 402 with `code: plus_required`):
  - `POST /api/export/xlsx` — Plus only
  - `POST /api/export/email { send: true }` — Plus only
  - `POST /api/shifts` and `PATCH /api/shifts/{id}` for dates outside the current calendar month — Plus only
- **Client soft-gate**: locked "Export XLSX · Plus" and "Send email · Plus" buttons + shift editor errors all deep-link into `/(app)/upgrade` instead of showing raw errors.
- **Env vars** (see `backend/.env.example`): `ZIINA_API_KEY`, `ZIINA_API_BASE`, `ZIINA_TEST_MODE`, `ZIINA_PRICE_FILS`, `ZIINA_CURRENCY`, `ZIINA_WEBHOOK_SECRET`, and the private `INCLUDED_ACCESS_DOMAINS` allowlist.
- Billing mode is controlled only by the Render `ZIINA_TEST_MODE` environment variable; secrets are never committed.

### Registering the webhook with Ziina
Once your backend is publicly reachable, register the webhook so activation still fires when a user closes the app mid-flow:
```bash
curl -X POST "$BACKEND/api/billing/webhook/register" \
  -H "Authorization: Bearer <superuser_token>" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<your-domain>/api/billing/webhook"}'
```
Or register it manually in the Ziina dashboard using the same URL and pasting `ZIINA_WEBHOOK_SECRET` as the secret.

## Email export (native mail composer — no relay)
- **`POST /api/export/email`** is now a **pure render endpoint**. It returns `{to, subject, body, html, shift_count, signature}` and never sends anything. `to` is hard-pinned to the authenticated user's own email address (SEC-004 preserved by contract shape).
- **Frontend** uses `expo-mail-composer` to open the platform's native mail app (iOS Mail / Android Gmail / macOS Mail) pre-filled with subject + HTML body + XLSX attachment (Plus only). Falls back to `mailto:` on web / no-mail-app devices, then to clipboard as a last resort.
- **Benefits vs SendGrid**: zero third-party dependency, no domain verification, no deliverability worries, replies work from the user's real address, works offline (queues in Mail.app draft).
- **SendGrid removed** — no keys in `.env`, no code in `server.py`, no imports anywhere. The `sendgrid` PyPI package remains in `requirements.txt` (harmless, saves a rebuild).

## XLSX real file download
`saveAndShareXlsx(base64, filename)` in `/app/frontend/src/utils/downloadXlsx.ts`:
- **Web**: builds a `Blob` from the base64 and triggers a real browser download.
- **iOS / Android** (dev / production build): writes the base64 payload to `Paths.cache` using the new SDK 54 `File` API and opens the native share sheet via `expo-sharing` so the user can save to Files / send to Numbers / Mail / etc.
- Returns `{ok, method, uri?, error?}` — the Planner tab shows the exact outcome ("Downloaded" / "Ready to share" / "Saved to device") on the success card.
