import nodemailer from 'nodemailer';

export interface EmailDispatchResult {
  deliveryStatus: 'SENT_SMTP' | 'PENDING_MANUAL_SHARE';
  deliveryNote: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  html?: string;
}

type TestEmailTransport = (msg: EmailMessage) => Promise<void>;
let testTransport: TestEmailTransport | null = null;

/**
 * Allows automated tests to plug in an in-memory SMTP capture transport
 * without bypassing real OTP / token validation or logging secrets.
 */
export function setTestEmailTransport(fn: TestEmailTransport | null): void {
  testTransport = fn;
}

export interface OptionalSmtpConfig {
  configured: boolean;
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export function getOptionalSmtpConfig(): OptionalSmtpConfig {
  const explicitlyDisabled = process.env.SMTP_ENABLED?.trim().toLowerCase() === 'false';
  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  const rawPort = Number(process.env.SMTP_PORT);
  const port =
    Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 587;
  const from = (process.env.SMTP_FROM || user).trim();

  const configured = !explicitlyDisabled && Boolean(host && user && pass);
  return { configured, host, port, user, pass, from };
}

export function isSmtpConfigured(): boolean {
  if (testTransport) return true;
  return getOptionalSmtpConfig().configured;
}

/**
 * Attempts real SMTP dispatch ONLY when valid SMTP credentials exist.
 * Disables external email delivery whenever SMTP is not configured.
 */
export async function dispatchNotificationEmail(params: EmailMessage): Promise<EmailDispatchResult> {
  if (testTransport) {
    try {
      await testTransport(params);
      return {
        deliveryStatus: 'SENT_SMTP',
        deliveryNote: `Dispatched to ${params.to} via configured SMTP transport.`,
      };
    } catch {
      return {
        deliveryStatus: 'PENDING_MANUAL_SHARE',
        deliveryNote:
          'Email has NOT been sent (SMTP transport failed). Share this link manually using Copy Invitation Link.',
      };
    }
  }

  const smtp = getOptionalSmtpConfig();
  if (!smtp.configured) {
    return {
      deliveryStatus: 'PENDING_MANUAL_SHARE',
      deliveryNote:
        'Email has NOT been sent (SMTP is not configured). Share this link manually using Copy Invitation Link.',
    };
  }

  const { host, port, user, pass, from } = smtp;

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 4000,
      greetingTimeout: 4000,
      socketTimeout: 6000,
    });

    await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      text: params.body,
      ...(params.html ? { html: params.html } : {}),
    });

    return {
      deliveryStatus: 'SENT_SMTP',
      deliveryNote: `Dispatched to ${params.to} via configured SMTP gateway (${host}).`,
    };
  } catch {
    return {
      deliveryStatus: 'PENDING_MANUAL_SHARE',
      deliveryNote: `Email has NOT been sent (SMTP server ${host}:${port} delivery failed). Share this link manually using Copy Invitation Link.`,
    };
  }
}
