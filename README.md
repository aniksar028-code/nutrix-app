# NUTRIX V1 — Personal Nutrition OS

A standalone PWA. It does not connect to or modify NOVA.

## Included
- Nutrition dashboard with calorie, protein, carbohydrate and fat goals
- Meal logging, quick foods and editable food library
- Food alternatives / meal rotation suggestions
- Daily budget with mess allocation counted once
- Weight, water and estimated micronutrient tracking
- Local personal nutrition memories
- AI nutrition chat and meal-plan generation through OpenAI Responses API
- Username/password account, signed 30-day bearer sessions
- Cloudflare Worker + D1 persistence
- Offline PWA shell, local data storage, JSON export/import

## Important setup
1. Upload the contents of `frontend/` to a static host (GitHub Pages, Cloudflare Pages, or your own domain). Keep `index.html`, `app.js`, `sw.js`, and `manifest.webmanifest` together.
2. In Cloudflare, create a D1 database named `nutrix-db`.
3. Run `database/schema.sql` against that database.
4. In `worker/wrangler.toml`, replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with your D1 ID.
5. Deploy the Worker from the `worker/` folder:
   - `npx wrangler deploy`
   - `npx wrangler secret put AUTH_SECRET` (use a long random secret, 32+ chars)
   - `npx wrangler secret put OPENAI_API_KEY` (your OpenAI API key)
6. In NUTRIX > Settings, paste your deployed Worker URL and save.
7. Create an account. The API key remains on the Worker and is never sent to the browser.

## Deploy worker using terminal
From the `worker/` folder:
```bash
npx wrangler d1 create nutrix-db
# copy the database_id into wrangler.toml
npx wrangler d1 execute nutrix-db --remote --file=../database/schema.sql
npx wrangler secret put AUTH_SECRET
npx wrangler secret put OPENAI_API_KEY
npx wrangler deploy
```
If you use the Cloudflare dashboard editor rather than Wrangler, create the Worker from `worker.js`, configure the D1 binding with variable name `DB`, add encrypted secrets `AUTH_SECRET` and `OPENAI_API_KEY`, and deploy. D1 migrations must be run separately.

## Frontend hosting
The `frontend/` folder is static. Deploy it to GitHub Pages or Cloudflare Pages. The AI API is a separate Worker. HTTPS is required for PWA installation and service workers (localhost is also allowed).

## Security and limitations
- Passwords are salted and PBKDF2-hashed; sessions are signed with HMAC and expire after 30 days.
- Use a unique, strong AUTH_SECRET. Never put API keys in frontend files, GitHub, or public variables.
- V1 account recovery/password reset is not included. Keep a private JSON backup.
- Cloud sync currently stores the full app data JSON per account. The browser copy is the working copy; sync is user-triggered.
- CORS is open for ease of static hosting. For production, restrict `Access-Control-Allow-Origin` to your actual frontend domain.
- AI requests use paid API usage and are not unlimited/free. Set spending limits in your API account. Change `OPENAI_MODEL` in wrangler.toml if needed.
- The micronutrient values in the starter food library are rough estimates, not lab-verified values. Custom foods currently default micronutrients to zero unless you extend the form.
- This is not a medical device. Consult a qualified clinician for medical conditions, allergies, eating disorders, pregnancy, or therapeutic diets.

## Suggested V1.1
Food image recognition, barcode lookup, multi-device conflict resolution, email recovery, granular D1 tables and analytics.
