import nodemailer, { type Transporter } from "nodemailer";
import type { Options, SentMessageInfo } from "nodemailer/lib/smtp-pool";
import { emailMessage, type Locale } from "../packages/localization/messages";
import settings from "./settings";

let transporter: Transporter<SentMessageInfo, Options> | undefined;

function mailTransport(): Transporter<SentMessageInfo, Options> {
    transporter ??= nodemailer.createTransport({
        pool: true,
        host: settings.value.smtpHost,
        port: settings.value.smtpPort,
        secure: settings.value.smtpSecure,
        auth: { user: settings.value.smtpUser, pass: settings.value.smtpPassword },
    });
    return transporter;
}

async function send(to: string, message: { subject: string; text: string }): Promise<void> {
    await mailTransport().sendMail({ from: settings.value.smtpEmail, to, ...message });
}

export default {
    sendActivationEmail: (locale: Locale, email: string, link: string) =>
        send(email, emailMessage(locale, "activation", { link })),
    sendPasswordResetEmail: (locale: Locale, email: string, link: string) =>
        send(email, emailMessage(locale, "passwordReset", { link })),
    sendDeletionEmail: (locale: Locale, email: string, username: string) =>
        send(email, emailMessage(locale, "accountDeleted", { username })),
};
