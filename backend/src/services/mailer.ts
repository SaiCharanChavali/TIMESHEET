import { env, isProduction } from '../lib/env.js';

// No email provider is configured yet, so reset links are only printed to the server log during development.
export async function sendPasswordResetEmail(email: string, token: string) {
  const link = `${env.CLIENT_URL}/reset-password?token=${token}`;
  if (isProduction) {
    console.error('Password reset requested but no email provider is configured.');
    return;
  }
  if (env.NODE_ENV === 'development') console.log(`[dev email] Password reset for ${email}: ${link}`);
}
