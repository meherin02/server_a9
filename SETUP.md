# Configure GearHarbor services

Run all commands below from the server folder. Secrets belong only in the ignored local `.env` file. Do not paste them into Git, screenshots or assignment README files.

## Prepare local files

```powershell
npm run setup
npm run check:env
```

Setup generates a random Better Auth secret and creates `../client/.env.local`. It preserves existing environment files. The environment check intentionally fails until required service settings are supplied; it prints setting names and errors, never values.

## Configure each service

1. MongoDB Atlas: create a database user and configure network access for your development machine and eventual server host. Put the connection URI in `MONGODB_URI`. Set `MONGODB_DB=gearharbor`. Atlas provides the replica set needed by booking transactions.
2. Better Auth: keep the generated secret private. Set `BETTER_AUTH_URL=http://localhost:5000` and `CLIENT_ORIGIN=http://localhost:3000`. These must be origins, without `/api/auth` paths.
3. Google OAuth: configure a web application client, with frontend origin `http://localhost:3000` and redirect URI `http://localhost:5000/api/auth/callback/google`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. If the consent screen is in testing mode, add intended examiner/test accounts as permitted testers. Verify current provider settings before deployment.
4. imgbb: supply `IMGBB_API_KEY` on the server. Uploads are proxied through the server; the key is never sent to the browser.
5. Stripe: use test mode and set `STRIPE_SECRET_KEY` to a test secret. With the Stripe CLI installed and authenticated, run the listener below in another terminal. Copy its signing secret into `STRIPE_WEBHOOK_SECRET` and restart the API.

```powershell
stripe listen --events checkout.session.completed,checkout.session.expired --forward-to localhost:5000/api/payments/webhook
```

For deployment, use the HTTPS production webhook endpoint's signing secret, not the CLI listener's secret. Client and server auth deployment still require a real-browser cookie/session test.

## Check connections explicitly

```powershell
npm run check:env
npm run check:services
```

The second command makes read-only network requests to MongoDB and Stripe. It checks transaction support and Stripe API authentication, but does not establish that Google consent, image uploads or webhook delivery work. No payment is created.

## Create Admin and Owner accounts

Fill `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_OWNER_EMAIL` and `BOOTSTRAP_OWNER_PASSWORD` locally. Use distinct accounts and passwords satisfying the assignment rules. These are explicitly provisioned accounts; ordinary registration still defaults to Customer.

```powershell
npm run bootstrap
```

The command creates accounts through Better Auth and assigns their roles in MongoDB. For an existing account it checks the supplied password before role assignment. It never prints passwords. Remove bootstrap passwords from the environment after provisioning if they are no longer needed. Share examiner Admin credentials only in the assignment submission channel.

## Seed six demonstration listings

```powershell
npm run seed:equipment
```

This uploads six illustrative images to imgbb and adds one approved, clearly labeled demo listing per category under the configured Owner account. It requires the Owner account and imgbb key. It preserves existing seeded records when rerun and never fabricates bookings, successful payments, revenue or customer testimonials. Replace sample listings with authentic information when representing a real rental business.

## Start and verify

```powershell
npm run dev
```

In another terminal, run `npm run dev` from the client folder. Open the client and check the following:

- Register a Customer with a photo URL; verify uppercase/lowercase/minimum-length validation.
- Sign in with Google and confirm the default Customer role.
- Reload a private route and confirm the session remains restored.
- Sign in as Owner, upload equipment, and confirm it starts Pending.
- Sign in as Admin, approve it, then find it in the public catalog.
- Save/remove favorites and verify the Customer table.
- Book dates and quantity; verify the server pricing in Stripe Checkout.
- Complete a Stripe test-card payment; verify exactly one booking and payment record.
- Replay a webhook and confirm there are no duplicate records.
- Try overlapping bookings from two sessions; confirm reserved quantities cannot exceed stock.
- Verify Customer, Owner and Admin see only permitted records and actions.
- Check charts, profile updates, role changes, suspension, mobile navigation and route refreshes.

```powershell
npm test
```

The automated tests use database doubles for request rules; real MongoDB transaction concurrency and browser behavior still require the checks above. Inspect the root `requirements-audit.json` before submission. Deployment, review-video checks, live URLs and required meaningful commit counts remain separate submission gates.
