# GearHarbor API

Equipment rental marketplace API built with Express, MongoDB, Better Auth, JWT verification, and Stripe dependencies.

## Setup

For the complete service configuration and testing sequence, follow [SETUP.md](SETUP.md). Start with `npm run setup`, then fill the ignored local environment files and run `npm run check:env`. `npm run check:services` explicitly checks MongoDB and Stripe connectivity. `npm run bootstrap` provisions configured Admin and Owner accounts; `npm run seed:equipment` uploads six illustrative equipment images and adds demo listings. These commands preserve existing configuration and do not print credentials.

Run `npm install`, copy `.env.example` to `.env`, and supply your MongoDB connection string and a random Better Auth secret of at least 32 characters. Set the frontend origin and auth base URL to match your environment. Start with `npm run dev`.

For Google sign-in, configure a Google OAuth web client with `http://localhost:5000/api/auth/callback/google` as a development redirect URI. Supply its client ID and secret in the server environment. Configure the corresponding HTTPS callback before deployment.

New accounts receive the customer role. The role cannot be set during registration. Protected endpoints verify JWTs against Better Auth's JWKS and load the current database role. Customers can upgrade their own account through `POST /api/vendor/join`; admin accounts cannot. Admin and Owner accounts have been provisioned; passwords are not stored in the repository.

## Vendor onboarding and payouts

Vendor onboarding reuses the existing `STRIPE_SECRET_KEY` and webhook setup; no second Stripe key is needed. Leave `STRIPE_CONNECT_COUNTRY` blank to use the Stripe platform account country, or set it to a country supported by that platform and destination charges. Set `VENDOR_PLATFORM_FEE_PERCENT` (default 10). In Stripe, enable Connect Express and finish any platform onboarding. `POST /api/vendor/onboard` creates an Express account and returns a short-lived hosted onboarding URL. `GET /api/vendor/status` checks current charge and payout capabilities; `POST /api/vendor/payout-dashboard` opens the vendor's Express dashboard. Never store bank details in GearHarbor.

A claimable sandbox key beginning `rkcs_test_` can read Stripe account details but cannot create connected accounts. Claim that sandbox in Stripe, obtain its full `sk_test_` key, and replace `STRIPE_SECRET_KEY` in the ignored server `.env` and Render's server environment. Keep the same sandbox when replacing the key so the webhook signing secret and existing test data remain aligned. Do not put the secret in the client or Git. `npm run check:env` warns when the restricted key is present.

New self-serve vendors' approved listings can enter Checkout only after their owner has an Express account with both charges and payouts enabled. Existing bootstrapped owners without Connect retain the original platform-only Checkout until they onboard; those historical/platform-only payments do **not** pay the owner automatically. Connected owners' Checkout uses a destination charge with `application_fee_amount` for GearHarbor's fee and `transfer_data.destination` for the vendor. The split is stored in the hold and paid payment record. Owner analytics count the vendor share on new split payments; platform-only payments have no documented vendor share and are excluded from vendor earnings. Stripe processing fees, refunds, disputes and payout timing are managed according to the Stripe account configuration; displayed earnings are the rental split, not a bank payout confirmation. Test account onboarding, a paid booking, webhook delivery, and the connected account's transfer in Stripe test mode before enabling live payments. Regional and currency support must be confirmed in your Stripe account.

## Current endpoints

- `GET /api/health`
- `/api/auth/*` Better Auth email/password, Google, sessions and JWT endpoints
- `GET /api/me` authenticated profile
- `GET /api/customer/access`, `/api/owner/access`, `/api/admin/access` role checks
- `GET /api/equipment` approved equipment search, filters, sorting, pagination
- `GET /api/equipment/:id` private equipment details
- `POST /api/equipment` owner submission, always pending
- `PATCH /api/equipment/:id` owner-scoped or admin update; owner edits return to pending
- `DELETE /api/equipment/:id` owner-scoped or admin archive, preserving historical references
- `GET /api/owner/equipment` owner equipment table
- `GET /api/admin/equipment` admin moderation table
- `PATCH /api/admin/equipment/:id/status` admin approve/reject
- `POST /api/uploads` owner/admin image upload proxy; requires `IMGBB_API_KEY`

Run `node --test src/equipment.test.js` for validation and ownership/mutation tests. These use a test database double; they do not establish MongoDB or imgbb connectivity.

## Implementation status

Authentication, equipment moderation, favorites, booking checkout, payment webhooks, profiles, user management, rental management and owner/admin analytics code are implemented. Live API: https://server-a9.onrender.com/ . Live client: https://gearharbor-client.vercel.app/ . Final production acceptance checks remain required; user-reported webhook success has not been independently inspected.

## Dashboard management

- `PATCH /api/me` updates only name, photo URL, phone and address. Email changes use Better Auth's `change-email` flow. Without email verification, only currently unverified emails can change; verified Google emails remain read-only in the interface.
- `GET /api/owner/rentals` and `GET /api/admin/rentals` return role-scoped booking records.
- `PATCH /api/owner/rentals/:id/status` and the corresponding admin endpoint support starting paid rentals on/after their start date and completing them after their inclusive end date. Payment status is never modified by these actions.
- `GET /api/owner/analytics` and `GET /api/admin/analytics` aggregate equipment, bookings and successful payment data. Admins also receive total user count. Charts cover the last twelve UTC calendar months, filling missing months with zeros. Revenue values are minor currency units.
- `GET /api/admin/users` and `PATCH /api/admin/users/:id` support role changes and suspension/reactivation. Self-modification is blocked. Suspended accounts are denied protected API access even when their JWT remains valid.

Run `node --test src/equipment.test.js src/rentals.test.js src/dashboard.test.js` for the current API tests.

## Rentals and Stripe setup

The payment result endpoint and customer rental history can recover paid reservations when webhook delivery is delayed: the server retrieves the customer's Checkout Session from Stripe and runs the same transactional, idempotent fulfillment. Rental history checks at most five recent pending sessions in parallel with bounded Stripe request timeouts. Webhooks remain required for unattended fulfillment and expiration. Run `node scripts/verify-payments.mjs` for a read-only record-count and revenue consistency check that does not print customer information or credentials.

Use MongoDB Atlas or another replica set: rental holds and payment fulfillment require transactions. Startup creates unique indexes for favorites, booking Checkout Session IDs and payment Checkout Session IDs.

Set `STRIPE_SECRET_KEY` to your Stripe test secret. Forward signed snapshot events to `POST /api/payments/webhook`. For local testing with the Stripe CLI:

```text
stripe listen --events checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed --forward-to localhost:5000/api/payments/webhook
```

Put the listener's signing secret in `STRIPE_WEBHOOK_SECRET` and restart the API. For production, register the HTTPS endpoint and use that endpoint's own signing secret. Payment methods are managed through Stripe dynamic payment methods; delayed success/failure events are handled. Fulfillment verifies the signature, paid status, amount, currency and customer reference before transactionally inserting booking and payment records. Duplicate events do not duplicate records.

Daily rentals count both start and end dates. Weekly periods are 7 days and monthly periods are 30 days, rounded up. Amounts in holds, bookings and payments are stored in minor currency units (BDT poisha). Dates are UTC calendar dates. Rental duration is limited to 366 days.

Concurrent bookings serialize through an equipment-document write inside a transaction, then check peak overlapping reserved quantities. Holds remain until Stripe reports expiration or confirms payment. Cancelling the browser redirect does not release inventory early. If Checkout creation fails ambiguously, the hold is deliberately retained to prevent overselling; operator reconciliation of stuck `creating` holds is still required. Do not delete such holds without checking Stripe for a corresponding payable session.

- `GET /api/customer/favorites`
- `PUT /api/customer/favorites/:equipmentId`
- `DELETE /api/customer/favorites/:equipmentId`
- `POST /api/customer/checkout`
- `GET /api/customer/rentals`
- `GET /api/customer/payments/:sessionId`

Run `node --test src/equipment.test.js src/rentals.test.js`. Database doubles test request rules and webhook idempotency; live MongoDB concurrency and Stripe Checkout remain integration checks to run with credentials. Never use real card details for test-mode payments.


## Deployment

Production API acceptance tools:

- `npm run verify:session-webhook` checks owner sign-in/session continuity through the frontend proxy and verifies that the deployed webhook accepts a correctly signed, unhandled probe event while rejecting a bad signature. It reads local ignored credentials and signs no real Stripe event. Override the deployment origins with `VERIFY_CLIENT_ORIGIN` and `VERIFY_API_ORIGIN` if needed.
- `node scripts/verify-dashboards.mjs --production` checks the configured Owner/Admin login, JWT, analytics totals and cross-role denial through the public frontend proxy.
- `node scripts/verify-equipment-workflow.mjs` creates a temporary zero-stock listing, tests owner updates and admin approval/rejection/public visibility, then archives the listing and signs out its test sessions. It also checks profile saves without changing profile values. Run deliberately against the deployed assignment environment; it writes test data.

These checks passed during acceptance verification: three paid rental records, BDT 6,450 total earnings/revenue, twelve monthly chart points, role isolation, equipment CRUD/moderation and profile saves. These are point-in-time results; browser private-route reloads and Google OAuth should still be checked separately.

Follow [DEPLOYMENT.md](DEPLOYMENT.md) before publishing the Express service.

Server repository: https://github.com/meherin02/server_a9

Client repository: https://github.com/meherin02/client_a9

## npm packages

Express, cors, dotenv, mongodb, better-auth, @better-auth/mongo-adapter, jose, and stripe. See package.json and package-lock.json for installed versions.

