# GearHarbor API

Equipment rental marketplace API built with Express, MongoDB, Better Auth, JWT verification, and Stripe dependencies.

## Setup

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

Authentication requires configured MongoDB and OAuth credentials for end-to-end verification. Stripe checkout, rental management, moderation, analytics and production deployment remain to be implemented. Live URL: not deployed.
