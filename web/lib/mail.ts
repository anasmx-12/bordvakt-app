import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';

// Skickar e-post. Väljer själv sätt utifrån web/.env.local:
// 1. Gmail (gratis): GMAIL_USER + GMAIL_APP_PASSWORD (ett "applösenord" från Google-kontot)
// 2. Resend (gratis 3 000/mån, kräver egen domän för att mejla kunder): RESEND_API_KEY + MAIL_FROM
// 3. Inget av dem: mejlet skrivs bara ut i serverns logg, så att allt går att testa.

export interface Mail {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  /** Avsändarens namn. Standard: "Bordvakt". */
  fromName?: string;
}

const GMAIL_USER = process.env.GMAIL_USER?.trim();
const GMAIL_PASSWORD = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '');
const RESEND_KEY = process.env.RESEND_API_KEY?.trim();
const FROM_NAME = 'Bordvakt';

let gmail: Transporter | null = null;

export async function sendMail(mail: Mail): Promise<{ sent: boolean; via: 'gmail' | 'resend' | 'log'; error?: string }> {
  try {
    if (GMAIL_USER && GMAIL_PASSWORD) {
      gmail ??= nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
      });
      await gmail.sendMail({ from: `${mail.fromName ?? FROM_NAME} <${GMAIL_USER}>`, to: mail.to, subject: mail.subject, text: mail.text, replyTo: mail.replyTo });
      return { sent: true, via: 'gmail' };
    }
    if (RESEND_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.MAIL_FROM || `${mail.fromName ?? FROM_NAME} <onboarding@resend.dev>`,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          reply_to: mail.replyTo,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Resend svarade ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { sent: true, via: 'resend' };
    }
    console.log(`\n[e-post, skickas inte: lägg in GMAIL_USER och GMAIL_APP_PASSWORD i web/.env.local]\nTill: ${mail.to}\nÄmne: ${mail.subject}\n\n${mail.text}\n`);
    return { sent: false, via: 'log' };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`Kunde inte skicka e-post till ${mail.to}: ${error}`);
    return { sent: false, via: GMAIL_USER ? 'gmail' : RESEND_KEY ? 'resend' : 'log', error };
  }
}

/** Adressen dit nya supportärenden skickas. */
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL?.trim() || GMAIL_USER || '';
