import nodemailer, { type Transporter } from 'nodemailer';
import { env, isProduction } from '../lib/env.js';

export type EmailResult = { status: 'SENT' | 'NOT_CONFIGURED' } | { status: 'FAILED'; error: string };

let transport: Transporter | null = null;
const getTransport = () => {
  if (!env.SMTP_HOST) return null;
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transport;
};

export const emailConfigured = () => !!env.SMTP_HOST;

// Never throws: a failed email is reported back so the caller can record it, and the in-app copy still stands.
export async function sendEmail(to: string, subject: string, text: string): Promise<EmailResult> {
  const smtp = getTransport();
  if (!smtp) {
    if (env.NODE_ENV === 'development') console.log(`[dev email] To ${to}: ${subject}\n${text}`);
    return { status: 'NOT_CONFIGURED' };
  }
  try {
    await smtp.sendMail({ from: env.SMTP_FROM, to, subject, text });
    return { status: 'SENT' };
  } catch (err) {
    return { status: 'FAILED', error: (err as Error).message.slice(0, 500) };
  }
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const link = `${env.CLIENT_URL}/reset-password?token=${token}`;
  if (!emailConfigured()) {
    if (isProduction) console.error('Password reset requested but no email provider is configured.');
    else if (env.NODE_ENV === 'development') console.log(`[dev email] Password reset for ${email}: ${link}`);
    return;
  }
  const result = await sendEmail(email, 'Reset your ShimentoX Timesheet password',
    `Someone asked to reset the password for this account. If it was you, open this link within the next hour:\n\n${link}\n\nIf it wasn't you, you can ignore this email.`);
  if (result.status === 'FAILED') console.error(`Password reset email failed: ${result.error}`);
}
