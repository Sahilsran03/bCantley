import nodemailer from "nodemailer";
import { env } from "../config/env.js";
const createTransport = () => {
  console.log({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    user: env.smtpUser,
    passLength: env.smtpPass?.length,
  });
  if (!env.smtpHost || !env.smtpUser || !env.smtpPass) {
    return null;
  }


  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass
    }
  });
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });

const buildOtpEmail = (name, otp) => {
  const safeName = escapeHtml(name);

  return {
  subject: "Verify your Cantley account",
  text: `Hi ${name}, your Cantley verification code is ${otp}. It expires in 15 minutes.`,
  html: `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#18202f">
      <h2>Verify your Cantley account</h2>
      <p>Hi ${safeName},</p>
      <p>Your verification code is:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px">${otp}</p>
      <p>This code expires in 15 minutes.</p>
    </div>
  `
  };
};

const buildTwoFactorEmail = (name, otp) => {
  const safeName = escapeHtml(name);

  return {
    subject: "Cantley admin login verification",
    text: `Hi ${name}, your Cantley admin login code is ${otp}. It expires in 15 minutes.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#18202f">
        <h2>Cantley admin login verification</h2>
        <p>Hi ${safeName},</p>
        <p>Your admin login code is:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px">${otp}</p>
        <p>This code expires in 15 minutes. If you did not try to login, please secure your account.</p>
      </div>
    `
  };
};

const baseTemplate = ({ title, body, actionUrl = "", actionText = "" }) => ({
  subject: title,
  text: `${title}\n\n${body}${actionUrl ? `\n\n${actionText || "Open"}: ${actionUrl}` : ""}`,
  html: `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#18202f">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(body)}</p>
      ${actionUrl ? `<p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:10px 16px;background:#0f172a;color:#fff;text-decoration:none;border-radius:6px">${escapeHtml(actionText || "Open")}</a></p>` : ""}
    </div>
  `
});

export const emailTemplates = {
  orderConfirmation: ({ orderNumber }) =>
    baseTemplate({
      title: "Your Cantley order is confirmed",
      body: `Order ${orderNumber} has been placed. Our team will contact you for advance confirmation before processing.`
    }),
  shippingUpdate: ({ orderNumber, status }) =>
    baseTemplate({
      title: "Cantley shipping update",
      body: `Order ${orderNumber} shipping status: ${status}.`
    }),
  rewardApproved: ({ amount }) =>
    baseTemplate({
      title: "Cantley reward approved",
      body: `Your reward of Rs. ${amount} has been approved and added to your wallet.`
    }),
  passwordReset: ({ resetLink }) =>
    baseTemplate({
      title: "Reset your Cantley password",
      body: "Use the secure link below to reset your password.",
      actionUrl: resetLink,
      actionText: "Reset password"
    }),
  welcome: ({ name }) =>
    baseTemplate({
      title: "Welcome to Cantley",
      body: `Hi ${name}, your Cantley account is ready.`
    })
};

export const sendTemplateEmail = async ({ to, template }) => {
  const transporter = createTransport();

  if (!transporter) {
    console.warn(`SMTP is not configured. Email skipped for ${to}: ${template.subject}`);
    return;
  }

  await transporter.sendMail({
    from: env.smtpFrom,
    to,
    ...template
  });
};

export const sendOtpEmail = async ({ to, name, otp }) => {
  const email = buildOtpEmail(name, otp);
  const transporter = createTransport();

  if (!transporter) {
    console.warn(`SMTP is not configured. OTP for ${to}: ${otp}`);
    return;
  }

  await transporter.sendMail({
    from: env.smtpFrom,
    to,
    ...email
  });
};

export const sendTwoFactorEmail = async ({ to, name, otp }) => {
  const email = buildTwoFactorEmail(name, otp);
  const transporter = createTransport();

  if (!transporter) {
    console.warn(`SMTP is not configured. Admin 2FA OTP for ${to}: ${otp}`);
    return;
  }

  await transporter.sendMail({
    from: env.smtpFrom,
    to,
    ...email
  });
};
