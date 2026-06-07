import type { DeliveryPayload, EmailPayload, TemplateContext } from '../types.js';
import { renderOptional } from './render.js';

export const createEmailSmtpPayload = async (
  context: TemplateContext,
): Promise<DeliveryPayload | undefined> => {
  const notification = context.status === 0 ? context.config.success : context.config.error;
  const email = context.config.transports.smtp;
  if (email?.enabled !== true || notification.email === undefined) {
    return undefined;
  }

  const html = await renderOptional(notification.email.html, context);
  const subject = await renderOptional(notification.email.subject, context);
  const text = await renderOptional(notification.email.text, context);
  if (html === undefined || subject === undefined) {
    throw new Error('Email notification requires subject and html templates');
  }

  const payload: EmailPayload = {
    from: email.from,
    to: email.to.map((recipient) => ({ email: recipient })),
    subject: subject.trim(),
    html,
  };
  if (email.cc !== undefined) {
    payload.cc = email.cc.map((recipient) => ({ email: recipient }));
  }
  if (email.bcc !== undefined) {
    payload.bcc = email.bcc.map((recipient) => ({ email: recipient }));
  }
  if (text !== undefined) {
    payload.text = text;
  }
  return { channel: 'emailSmtp', payload };
};
