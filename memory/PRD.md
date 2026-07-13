# Foxory Shift Calendar — PRD

## What
Premium mobile shift planner for nurses and caregivers with **Foxory dark-purple / neon-purple branding** applied consistently across the login screen, dashboard header, mobile navigation, exported XLSX, and email preview.

## Brand elements delivered
1. **Logo**: user-provided fox/crescent/calendar mark (`/app/frontend/assets/images/foxory-logo.png`) exposed through a single reusable `FoxoryLogo` component — swap the require path once to replace the mark globally.
2. **App name**: “Foxory Shift Calendar” on login, dashboard header, settings, and XLSX title row.
3. **Subtitle**: “Smart shift planning for nurses and caregivers.” on login screen (and shortened “Smart shift planning” on the sticky dashboard header).
4. **Account badge** (top-right of dashboard header): auto-renders **PLUS $2.99/YEAR** for plus plan or **CCAD FREE ACCESS** for free plan, driven by `user.plan`.
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
