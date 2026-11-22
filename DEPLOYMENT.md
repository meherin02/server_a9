# Deploy the Express API

This repository is the API service. Deploy it as a Node web service, for example on Render. The separate Next.js repository is deployed on Vercel with a same-origin API rewrite. Hosting is not created by these files; select and review the provider plan yourself before deploying.

## Service settings

- Connect the server GitHub repository and the intended branch.
- Runtime: Node.js 24.
- Build: `npm ci`.
- Start: `npm start`.
- Health check: `/api/health`.
- Allow the host to supply `PORT`. The application listens on `0.0.0.0`.
- Configure Atlas network access for the backend host's outbound connections.

## Environment

Set real values in the provider environment settings. Never commit them.

```dotenv
NODE_ENV=production
MONGODB_URI=YOUR_ATLAS_CONNECTION_STRING
MONGODB_DB=gearharbor
BETTER_AUTH_SECRET=YOUR_EXISTING_SECRET
CLIENT_ORIGIN=https://YOUR_CLIENT.vercel.app
BETTER_AUTH_URL=https://YOUR_CLIENT.vercel.app
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET
IMGBB_API_KEY=YOUR_IMGBB_KEY
STRIPE_SECRET_KEY=YOUR_STRIPE_TEST_SECRET
STRIPE_WEBHOOK_SECRET=YOUR_DEPLOYED_WEBHOOK_SIGNING_SECRET
```

`BETTER_AUTH_URL` intentionally points to the public frontend origin, because its `/api/*` rewrite forwards to Express. Auth cookies and OAuth callbacks then use that frontend origin. `CLIENT_ORIGIN` must match it exactly. `MONGODB_DNS_SERVERS` is optional; leave it unset if the host's DNS resolves Atlas normally. Bootstrap account passwords are not needed in the hosted runtime.

Reserve the frontend production domain first. Set `API_PROXY_TARGET` on Vercel to the backend service origin and follow the client deployment guide. Do not leave public frontend variables pointing to localhost or directly to a separate backend domain in this deployment layout.

## Callbacks and webhooks

- Add the production frontend origin to the Google OAuth client.
- Add `https://YOUR_CLIENT.vercel.app/api/auth/callback/google` as an authorized redirect URI.
- Register `https://YOUR_API.onrender.com/api/payments/webhook` in the same Stripe sandbox/test environment that issued the secret key.
- Subscribe to snapshot events `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`.
- Set that endpoint's signing secret on the host. A local CLI listener secret does not replace the deployed endpoint secret.
- If the sandbox is unclaimed, claim/configure it through Stripe before treating it as a lasting deployment dependency.

## Release checks

Run `npm test` locally. Confirm the deployed `/api/health` reports a connected database, and check `/api/equipment?limit=6` through the frontend domain. Repeat registration, Google login, private-route refresh, role access, uploads, checkout, webhook processing and payment idempotency on the deployed system. Verify the Owner and Admin analytics, then add both live URLs to the READMEs. Local passing checks do not establish production readiness.

References: [Render Express deployment](https://render.com/docs/deploy-node-express-app), [Better Auth cookies](https://better-auth.com/docs/concepts/cookies).
