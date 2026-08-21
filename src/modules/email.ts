/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import nodemailer, {Transporter} from 'nodemailer';
import {MailOptions, Options, SentMessageInfo} from 'nodemailer/lib/smtp-pool';
import type {GuestLinkData} from '../types/UserTypes';
import {Guest} from "./database/entities/user/Guest";
import {Profile} from "./database/entities/user/Profile";
import {User} from "./database/entities/user/User";
import {toLocalISOTime} from "./lib/util";
import settings from './settings';

let transporter: Transporter<SentMessageInfo, Options> | undefined = undefined;

function init() {
    transporter ??= nodemailer.createTransport({
        pool: true,
        host: settings.value.smtpHost,
        port: settings.value.smtpPort,
        secure: settings.value.smtpSecure, // use TLS
        auth: {
            user: settings.value.smtpUser,
            pass: settings.value.smtpPassword,
        },
    });
}

// Funktion zum Senden einer E-Mail
async function sendEmail(to: string, subject: string, text: string) {
    init();

    const mailOptions: MailOptions = {
        from: settings.value.smtpEmail,
        to: to,
        subject: subject,
        text: text,
    };

    try {
        await transporter!.sendMail(mailOptions);
    } catch (error) {
        console.error('Error sending E-Mail:', error);
    }
}

// Funktion zum Senden einer Aktivierungs-E-Mail
async function sendActivationEmail(userEmail: string, activationLink: string) {
    const subject = 'Activate your account';
    const text = `Hi! Welcome to Surveyor!

To activate your account, please follow this link:

${activationLink}

Note: This link will expire in 1 hour.

Your Surveyor Team.`;

    await sendEmail(userEmail, subject, text);
}

// Funktion zum Senden einer E-Mail für das Passwort zurücksetzen
async function sendPasswordResetEmail(userEmail: string, resetLink: string) {
    const subject = 'Reset your password';
    const text = `Hi! Thank you for using Surveyor!

You requested to reset your password.

To set a new one, please follow this link:

${resetLink}

Note: This link will expire in 1 hour.

Your Surveyor Team.`;

    await sendEmail(userEmail, subject, text);
}

async function sendLinkEmail(userEmail: string, surveyLink: string) {
    const subject = 'Your personal editing link';
    const text = `Hi! Thank you for using Surveyor!

This is your personal link to edit your answers:

${surveyLink}

Note: Please do not share this link with anybody.

Your Surveyor Team.`;

    await sendEmail(userEmail, subject, text);
}

async function sendGuestRecoveryEmail(email: string, guestLinkData: GuestLinkData[]) {
    let guestSection = '---------- ';
    for (let guest of guestLinkData) {
        guestSection += guest.username;
        guestSection += ' ----------\n';
        guestSection += `Created: ${toLocalISOTime(guest.track.createdAt)}\n`;
        guestSection += `Link: ${guest.link}\n`
        guestSection += '---------- ';
    }

    const subject = 'Your guest accounts';
    const text = `Hi! Thank you for using Surveyor!

You have requested a recovery of the guest accounts linked to this email. Here are your accounts with the corresponding login link:

${guestSection}

Note: Please do not share this link with anybody.

Your Surveyor Team.`

    await sendEmail(email, subject, text);
}

async function sendMigrationEmail(email: string, profile: Profile, newOwner: User) {
    const subject = `Your profile ${profile.name} was migrated to user ${newOwner.name}`;
    const text = `Hi! Thank you for using Surveyor!

Your profile ${profile.name} was migrated to user ${newOwner.name} (${newOwner.username} | ${newOwner.email}) using your individual token.
If this was your last profile, your account has been closed with this migration.

We hope to see you again someday.
Your Surveyor Team.`;
    await sendEmail(email, subject, text);
}

async function sendDeletionEmail(email: string, account: User | Guest) {
    const subject = `Your account ${account.username} has been closed`;
    const text = `Hi! Thank you for using Surveyor!

We have closed your account ${account.username} by your request.
Your associated profile(s) have been deactivated as well, but your participations stay visible.

We hope to see you again someday.
Your Surveyor Team.`;
    await sendEmail(email, subject, text);
}

export default {
    sendEmail,
    sendActivationEmail,
    sendPasswordResetEmail,
    sendLinkEmail,
    sendGuestRecoveryEmail,
    sendMigrationEmail,
    sendDeletionEmail,
};
