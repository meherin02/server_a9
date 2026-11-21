import { betterAuth } from 'better-auth';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { jwt } from 'better-auth/plugins';
import { APIError, createAuthMiddleware } from 'better-auth/api';

export function createAuth(database) {
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error('Set BETTER_AUTH_SECRET to a random secret of at least 32 characters.');
  }
  return betterAuth({
    appName: 'GearHarbor',
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:5000',
    secret: process.env.BETTER_AUTH_SECRET,
    database: mongodbAdapter(database),
    trustedOrigins: [process.env.CLIENT_ORIGIN || 'http://localhost:3000'],
    emailAndPassword: { enabled: true, minPasswordLength: 6, requireEmailVerification: false },
    user: { changeEmail: { enabled: true, updateEmailWithoutVerification: true }, additionalFields: {
      role: { type: 'string', defaultValue: 'customer', input: false },
      phone: { type: 'string', required: false },
      address: { type: 'string', required: false },
    } },
    socialProviders: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? {
      google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
    } : {},
    plugins: [jwt()],
    hooks: { before: createAuthMiddleware(async ctx => {
      if (ctx.path === '/sign-up/email') {
        const password = ctx.body?.password;
        if (typeof password !== 'string' || password.length < 6 || !/[A-Z]/.test(password) || !/[a-z]/.test(password)) {
          throw new APIError('BAD_REQUEST', { message: 'Password needs uppercase and lowercase letters and at least 6 characters.' });
        }
        try {
          const photo = new URL(ctx.body?.image);
          if (!['https:', 'http:'].includes(photo.protocol)) throw new Error();
        } catch { throw new APIError('BAD_REQUEST', { message: 'Please provide a valid profile image URL.' }); }
      }
    }) },
  });
}
