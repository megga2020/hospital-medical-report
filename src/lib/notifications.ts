import { and, eq, lte, or } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  auditLogs,
  hospitals,
  notificationPreferences,
  notificationSettings,
  notifications,
  patients,
  reportAccessTokens,
} from '../db/schema.ts';
import { generateSecureReportToken } from './security.ts';

export function buildNotificationMessage(params: {
  patientName: string;
  hospitalName: string;
  secureAccessUrl: string;
  language?: string;
}): string {
  if (params.language === 'ar') {
    return `عزيزي ${params.patientName}،

تقريرك الطبي من ${params.hospitalName} متاح الآن.

يرجى تسجيل الدخول إلى حسابك الآمن في MediReport Connect أو استخدام الرابط الآمن المحدود الصلاحية لعرض التقرير وتنزيله:
${params.secureAccessUrl}

للمساعدة، يرجى التواصل مع مقدم الرعاية الصحية الخاص بك.

شكراً لك.`;
  }

  return `Dear ${params.patientName},

Your medical report from ${params.hospitalName} is now available.

Please log in to your secure MediReport Connect account to view and download your report:
${params.secureAccessUrl}

For assistance, contact your healthcare provider.

Thank you.`;
}

export function getIntegrationCredentialsStatus() {
  const emailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim());
  const whatsappConfigured = Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_ACCESS_TOKEN.trim()
  );
  const smsConfigured = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER &&
      process.env.TWILIO_ACCOUNT_SID.trim()
  );
  const geminiConfigured = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
  );

  return {
    geminiConfigured,
    emailConfigured,
    whatsappConfigured,
    smsConfigured,
  };
}

async function sendViaEmailProvider(to: string, subject: string, body: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return {
      ok: true,
      sandbox: true,
      providerMessageId: `sandbox-email-${Date.now()}`,
      error: '',
    };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'MediReport Connect <reports@medireport.local>',
      to: [to],
      subject,
      text: body,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return {
      ok: false,
      sandbox: false,
      providerMessageId: '',
      error: `Email API ${res.status}: ${errText}`,
    };
  }

  const data = (await res.json()) as { id?: string };
  return {
    ok: true,
    sandbox: false,
    providerMessageId: data.id || `email-${Date.now()}`,
    error: '',
  };
}

async function sendViaWhatsAppProvider(toPhone: string, body: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId || !token.trim()) {
    return {
      ok: true,
      sandbox: true,
      providerMessageId: `sandbox-wa-${Date.now()}`,
      error: '',
    };
  }

  const cleanPhone = toPhone.replace(/[^0-9]/g, '');
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: cleanPhone,
      type: 'text',
      text: { body },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return {
      ok: false,
      sandbox: false,
      providerMessageId: '',
      error: `WhatsApp Cloud API ${res.status}: ${errText}`,
    };
  }

  const data = (await res.json()) as { messages?: Array<{ id?: string }> };
  return {
    ok: true,
    sandbox: false,
    providerMessageId: data.messages?.[0]?.id || `wa-${Date.now()}`,
    error: '',
  };
}

async function sendViaSmsProvider(toPhone: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !authToken || !from || !sid.trim()) {
    return {
      ok: true,
      sandbox: true,
      providerMessageId: `sandbox-sms-${Date.now()}`,
      error: '',
    };
  }

  const form = new URLSearchParams({ To: toPhone, From: from, Body: body });
  const basicAuth = Buffer.from(`${sid}:${authToken}`).toString('base64');

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    return {
      ok: false,
      sandbox: false,
      providerMessageId: '',
      error: `Twilio SMS ${res.status}: ${errText}`,
    };
  }

  const data = (await res.json()) as { sid?: string };
  return {
    ok: true,
    sandbox: false,
    providerMessageId: data.sid || `sms-${Date.now()}`,
    error: '',
  };
}

export async function dispatchChannelDelivery(params: {
  channel: string;
  recipient: string;
  messageBody: string;
  hospitalName: string;
  simulateFailure?: boolean;
}) {
  if (params.simulateFailure) {
    return {
      ok: false,
      sandbox: true,
      providerMessageId: '',
      error: 'Simulated gateway timeout (504) for delivery retry verification.',
    };
  }

  if (params.channel === 'email') {
    return sendViaEmailProvider(
      params.recipient,
      `Medical Report Available — ${params.hospitalName}`,
      params.messageBody
    );
  }
  if (params.channel === 'whatsapp') {
    return sendViaWhatsAppProvider(params.recipient, params.messageBody);
  }
  return sendViaSmsProvider(params.recipient, params.messageBody);
}

export async function triggerApprovedReportDelivery(params: {
  reportId: number;
  patientId: number;
  hospitalId: number;
  baseUrl: string;
}) {
  const [patient] = await db.select().from(patients).where(eq(patients.id, params.patientId));
  if (!patient) throw new Error('Patient not found for notification delivery');

  const [hospital] = await db.select().from(hospitals).where(eq(hospitals.id, params.hospitalId));
  if (!hospital) throw new Error('Hospital not found for notification delivery');

  const [prefs] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.patientId, patient.id));

  const [settings] = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.hospitalId, hospital.id));

  const maxRetries = settings?.maxRetries ?? 3;
  const retryDelayMinutes = settings?.retryDelayMinutes ?? 15;

  // Create expiring 72-hour signed access token
  const token = generateSecureReportToken();
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  await db.insert(reportAccessTokens).values({
    reportId: params.reportId,
    patientId: patient.id,
    token,
    expiresAt,
  });

  const secureAccessUrl = `${params.baseUrl}/?access_token=${token}`;
  const language = prefs?.preferredLanguage || 'en';
  const messageBody = buildNotificationMessage({
    patientName: patient.fullName,
    hospitalName: hospital.name,
    secureAccessUrl,
    language,
  });

  const channelsToSend: Array<{ channel: string; recipient: string }> = [];
  if ((prefs?.emailEnabled ?? true) && patient.email) {
    channelsToSend.push({ channel: 'email', recipient: patient.email });
  }
  if ((prefs?.whatsappEnabled ?? true) && patient.mobileNumber) {
    channelsToSend.push({
      channel: 'whatsapp',
      recipient: `${patient.mobileCountryCode}${patient.mobileNumber}`,
    });
  }
  if ((prefs?.smsEnabled ?? false) && patient.mobileNumber) {
    channelsToSend.push({
      channel: 'sms',
      recipient: `${patient.mobileCountryCode}${patient.mobileNumber}`,
    });
  }

  if (channelsToSend.length === 0 && patient.email) {
    channelsToSend.push({ channel: 'email', recipient: patient.email });
  }

  const createdNotifications = [];
  for (const target of channelsToSend) {
    const result = await dispatchChannelDelivery({
      channel: target.channel,
      recipient: target.recipient,
      messageBody,
      hospitalName: hospital.name,
    });

    const now = new Date();
    const [row] = await db
      .insert(notifications)
      .values({
        reportId: params.reportId,
        patientId: patient.id,
        hospitalId: hospital.id,
        channel: target.channel,
        recipient: target.recipient,
        messageBody,
        secureAccessUrl,
        status: result.ok ? 'delivered' : 'failed',
        retryCount: 0,
        maxRetries,
        nextRetryAt: result.ok ? null : new Date(Date.now() + retryDelayMinutes * 60 * 1000),
        providerMessageId: result.providerMessageId,
        errorMessage: result.error,
        sentAt: now,
        deliveredAt: result.ok ? now : null,
      })
      .returning();

    createdNotifications.push(row);
  }

  await db.insert(auditLogs).values({
    hospitalId: hospital.id,
    actorEmail: 'notification-engine',
    actorRole: 'system',
    action: 'REPORT_DELIVERY_DISPATCHED',
    resourceType: 'medical_report',
    resourceId: String(params.reportId),
    details: {
      channels: channelsToSend.map((c) => c.channel),
      tokenExpiresAt: expiresAt.toISOString(),
    },
  });

  return { token, secureAccessUrl, notifications: createdNotifications };
}

export async function retryNotificationById(notificationId: number, forceSuccess = true) {
  const [notif] = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notificationId));

  if (!notif) {
    throw new Error('Notification record not found');
  }

  const [hospital] = await db
    .select()
    .from(hospitals)
    .where(eq(hospitals.id, notif.hospitalId));

  const nextCount = notif.retryCount + 1;
  const result = await dispatchChannelDelivery({
    channel: notif.channel,
    recipient: notif.recipient,
    messageBody: notif.messageBody,
    hospitalName: hospital?.name || 'Hospital',
    simulateFailure: !forceSuccess && nextCount < notif.maxRetries,
  });

  const now = new Date();
  const [updated] = await db
    .update(notifications)
    .set({
      status: result.ok ? 'delivered' : nextCount >= notif.maxRetries ? 'failed' : 'retrying',
      retryCount: nextCount,
      providerMessageId: result.providerMessageId || notif.providerMessageId,
      errorMessage: result.error,
      sentAt: now,
      deliveredAt: result.ok ? now : null,
      nextRetryAt: result.ok ? null : new Date(Date.now() + 15 * 60 * 1000),
    })
    .where(eq(notifications.id, notificationId))
    .returning();

  return updated;
}

export async function processDueNotificationRetries() {
  const now = new Date();
  const dueList = await db
    .select()
    .from(notifications)
    .where(
      and(
        or(eq(notifications.status, 'failed'), eq(notifications.status, 'retrying')),
        lte(notifications.nextRetryAt, now)
      )
    );

  const processed = [];
  for (const item of dueList) {
    if (item.retryCount < item.maxRetries) {
      const updated = await retryNotificationById(item.id, true);
      processed.push(updated);
    }
  }
  return processed;
}
