# Google Play listing — Foxory Shift Planner

Source of truth for the Play Store listing (en-US). Committing here does **not**
change the live listing; paste and upload in Play Console.

| File | Play Console field | Limit |
| --- | --- | --- |
| `en-US/title.txt` | App name | 30 |
| `en-US/short_description.txt` | Short description | 80 |
| `en-US/full_description.txt` | Full description | 4000 |
| `en-US/phone-screenshots/*.png` | Phone screenshots (upload in order 01–06) | 1080x1920, RGB, no alpha |

Every claim in the description was checked against the app: monthly calendar,
day/night/on-call/off shifts with times, location and note, drafts with
confirm, roster import (photo, screenshot, Excel) with review, account sync
across devices, and Foxory Plus (months beyond the current one, XLSX export,
email attachment). Don't add features here before they ship in a release.
The hospital schedule-link sync is not released yet and is intentionally not
mentioned.

## Regenerating screenshots

All data is synthetic (fictional "Alex Morgan", "Ward 4B", invented roster
names). Nothing touches the production database.

```bash
pip install -r backend/requirements.txt mongomock-motor uvicorn playwright pillow
python store/tools/demo_server.py &                  # real backend, in-memory DB, :8001
cd frontend && EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:8001 \
  npx expo export --platform web --output-dir /tmp/foxory-web --clear && cd ..
python store/tools/capture_screenshots.py /tmp/foxory-web
```

The capture script also verifies sync: it adds a shift on one browser session
and fails unless a second, independent session shows it.

## Manual Play Console steps

1. **Main store listing** → paste the three text files.
2. **Phone screenshots** → delete the 4 old screenshots, upload 01–06 in order.
3. **Data safety** → the form currently says data can't be deleted. Change it:
   users can delete their account and data in the app (Settings → Legal →
   Delete my account) and request deletion by email.
4. Save and send the listing for review.

## Follow-ups

- The in-app name change ("Foxory Shift Calendar" → "Foxory Shift Planner")
  ships with the next build (1.0.3).
- Backend strings (public web pages, XLSX title, email text, `PRIVACY_POLICY.md`)
  still say "Foxory Shift Calendar"; align them in a separate change.
