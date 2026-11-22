# GearHarbor API

Equipment rental marketplace API built with Express, MongoDB, Better Auth, JWT verification, and Stripe dependencies.

## Setup

For the complete service configuration and testing sequence, follow [SETUP.md](SETUP.md). Start with `npm run setup`, then fill the ignored local environment files and run `npm run check:env`. `npm run check:services` explicitly checks MongoDB and Stripe connectivity. `npm run bootstrap` provisions configured Admin and Owner accounts; `npm run seed:equipment` uploads six illustrative equipment images and adds demo listings. These commands preserve existing configuration and do not print credentials.

Run `npm install`, copy `.env.example` to `.env`, and supply your MongoDB connection string and a random Better Auth secret of at least 32 characters. Set the frontend origin and auth base URL to match your environment. Start with `npm run dev`.

For Google sign-in, configure a Google OAuth web client with `http://localhost:5000/api/auth/callback/google` as a development redirect URI. Supply its client ID and secret in the server environment. Configure the corresponding HTTPS callback before deployment.

New accounts receive the customer role. The role cannot be set during registration. Protected endpoints verify JWTs against Better Auth's JWKS and load the current database role. Customer, owner, and admin middleware are implemented. No admin account is seeded yet.

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

Authentication, equipment moderation, favorites, booking checkout, payment webhooks, profiles, user management, rental management and owner/admin analytics code are implemented. Production deployment and full acceptance testing remain unfinished. External service flows still require end-to-end verification with configured credentials. Live URL: not deployed.

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

Follow [DEPLOYMENT.md](DEPLOYMENT.md) before publishing the Express service.

Server repository: https://github.com/meherin02/server_a9

Client repository: https://github.com/meherin02/client_a9
