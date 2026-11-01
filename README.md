# Ali Fruits

Online fruit ordering and delivery for a local business in Kharar, Punjab. One Cloudflare Worker serves the shop, the staff dashboard (`/admin`), the rider app (`/rider`) and the API. Data is in Cloudflare D1, images in R2.

**The business rule everything follows:** nothing is bought in advance. A customer asks, staff check the shop and set the real price, the customer approves, and only then is fruit bought. There is no stock count anywhere in the software.

## What is here

| Part | Where |
|---|---|
| Customer shop | `/` |
| Staff dashboard (orders, prices, buying, riders, money, settings) | `/admin` |
| Rider app | `/rider` |
| Installable phone apps (shop, staff, rider) | Add to Home Screen from Chrome |
| Android app (APK) | `npm run android:apk` |
| Database migrations | `migrations/` |
| Tests | `tests/` (94 tests) |

## Run it on your computer

```bash
npm install
cp .dev.vars.example .dev.vars        # gives you a local setup token
npm run db:reset:local                # creates the local database with sample data
npm run dev                           # opens on the port Vite prints
```

Open `/admin`. On a fresh database it asks for first-time setup: enter the token from `.dev.vars` (`local-development-bootstrap-token`) and choose your own name, email and password.

`seeds/dev.sql` is sample data for local use only: sample prices, sample zones, and sample seller details marked "SAMPLE". Never run it on staging or production.

```bash
npm test            # all tests
npm run typecheck   # type check
npm run build       # production build
```

## Put it online (Cloudflare)

You need a free Cloudflare account and `npx wrangler login`.

1. **Create the database and storage** (repeat with `staging` for a test copy):
   ```bash
   npx wrangler d1 create ali-fruits-production
   npx wrangler r2 bucket create ali-fruits-production
   ```
2. Put the `database_id` that the first command prints into `wrangler.jsonc` under `env.production.d1_databases`, replacing `REPLACE_WITH_PRODUCTION_D1_ID`.
3. **Create the tables:** `npm run db:migrate:production`
4. **Set the one-time setup token** (choose a long random value):
   ```bash
   npx wrangler secret put BOOTSTRAP_TOKEN --env production
   ```
5. **Deploy:** `npm run deploy:production`
6. Open `https://<your-worker>.workers.dev/admin`, enter the token, and create the first administrator. Then delete the token: `npx wrangler secret delete BOOTSTRAP_TOKEN --env production`.
7. **Your own web address:** in the Cloudflare dashboard open the Worker, then Settings, Domains and Routes, Add custom domain. Put the same address in `PUBLIC_SITE_URL` in `wrangler.jsonc` (for example `https://alifruits.in`) and deploy again. It is used for links, the sitemap and search engine tags.

Staging works the same way with `--env staging`. Staging is hidden from search engines. Use separate databases for each environment, and never copy customer data into development.

## Fill in your real business details

Everything below is entered in `/admin`, never in code, and nothing is pre-filled with made-up details.

1. **Business settings:** seller name, address, phone, WhatsApp number, email, hours, FSSAI number, category and validity date, GSTIN if you have one, UPI details. Edit the starter text of each policy page and have it checked before you rely on it.
2. **Delivery zones:** add only places you can really deliver to, with PIN codes, charges and slots.
3. **Products and Daily prices:** add your fruit, your own photographs, and today's prices.
4. **Staff and Riders:** create accounts. Everyone gets a temporary password and must change it on first sign-in.

## Opening for real orders

Until you do this, the site takes **non-binding enquiries only** and no payments. Staging and production start in that state.

You must first check, with the licence holder, that the food licence really covers selling fruit online and that the arrangement between you is in place. The switches below record that you did this. They do not make the business approved.

1. In `wrangler.jsonc`, set `SELLER_DETAILS_VERIFIED`, `FSSAI_COVERAGE_VERIFIED` and `ONLINE_SALES_ENABLED` to `"true"` for the environment and deploy again.
2. As a super admin, open Business settings, Going live, and switch each one on. You must write what you checked. This goes in the audit log.

Both sides must be on. If the licence date passes, live orders turn off by themselves.

## The apps on phones

**Installable apps.** On Android Chrome, open the site, `/admin` or `/rider` and tap Install app (or the browser menu, Add to Home screen). Each one installs separately with the brand name from your settings. This needs the live HTTPS address. On iPhone, use Share, then Add to Home Screen.

**Android app (APK).** This wraps your live site in a native app, so one website deploy updates everyone.

```bash
APP_URL=https://your-live-address npm run android:apk
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. You need Android Studio's SDK and Java 21. If you only have a newer Java, the project already uses a Gradle version that supports it. For the Play Store, run it with `-- release`, sign the bundle with your own key, and pay Google's one-time developer fee. There is no iPhone app. Apple needs a paid developer account and a Mac, so iPhone users use the installable web app.

## Payments, messages and delivery: what is real

- **Payments:** UPI is paid by the customer in their own app, and cash on delivery. Staff confirm each UPI payment against the real bank or UPI record. Screenshots are never trusted. There is no payment gateway.
- **Messages:** nothing is sent automatically. The dashboard prepares each message and opens WhatsApp for a person to send it. There is no WhatsApp Business API and no email service connected. Business settings shows this plainly.
- **Third-party delivery** (Porter, Rapido and others): booked by hand in their own app and recorded in the dashboard. No provider is connected.

## Security notes

Passwords are hashed. Sessions are in HttpOnly, SameSite cookies and can be cancelled. Every admin and rider route checks permissions on the server. Writes from other websites are refused. Logins and public forms are rate limited. Uploads are checked by their real contents. Order links are random and cannot be guessed. Wholesale prices are never sent to customers or riders.

## Costs and limits

This runs on Cloudflare's free tier to start. If you outgrow it, the Workers paid plan is about five US dollars a month and raises the D1, R2 and request limits. When a daily limit is reached, visitors see a "busy, try again" message instead of an error page.

## Not covered

- Real photographs of your fruit (the shop shows fruit names until you add them).
- Real customer reviews (none are shown until you add some).
- Legal review of the policy pages and your food-licence position.
- Management reports are not formal accounting or tax records.
