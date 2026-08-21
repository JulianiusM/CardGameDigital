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

import {Request} from "express";
import {Guest} from "../modules/database/entities/user/Guest";
import {Profile} from "../modules/database/entities/user/Profile";
import {User} from "../modules/database/entities/user/User";
import * as activityService from "../modules/database/services/ActivityService";
import * as driverService from "../modules/database/services/DriverService";
import * as eventService from "../modules/database/services/EventService";
import * as packingService from "../modules/database/services/PackingService";
import * as surveyService from "../modules/database/services/SurveyService";
import * as userService from "../modules/database/services/UserService";
import mailer from "../modules/email";
import {ExpectedError, ValidationError} from "../modules/lib/errors";
import {persistSession} from "../modules/lib/session";
import {buildGuestLink, convertToSingleList, merge} from "../modules/lib/util";
import * as oidc from "../modules/oidc";
import settings from "../modules/settings";
import {DashboardDTO, GuestLinkData} from "../types/UserTypes";

const CREATE_TEMPLATE = 'users/register';
const LOGIN_TEMPLATE = 'users/login';

export async function registerUser(body: any, next?: string) {
    const {username, displayname, password, password_repeat, email} = body;
    const returnInfo = {username, email};

    if (!username || !password || !password_repeat || !email) {
        throw new ValidationError(CREATE_TEMPLATE, 'Not all fields were filled out.', returnInfo);
    }

    if (password !== password_repeat) {
        throw new ValidationError(CREATE_TEMPLATE, 'Passwords do not match.', returnInfo);
    }

    const existingUser = await userService.getUserByUsername(username);
    if (existingUser) {
        throw new ValidationError(CREATE_TEMPLATE, 'This username is already taken.', returnInfo);
    }

    // Benutzer registrieren
    let userId = await userService.registerUser(username, displayname || username, password, email);

    // Generiere den Aktivierungs-Token und sende ihn per E-Mail
    const token = await userService.generateActivationToken(userId);
    const nextLink = next ? `?next=${next}` : "";
    const activationLink = `${settings.value.rootUrl}/users/activate/${token}${nextLink}`;

    await mailer.sendActivationEmail(email, activationLink);
}

export async function loginUser(body: any, session: Request["session"]) {
    const {username, password} = body;
    const returnInfo = {username};

    if (!username || !password) {
        throw new ValidationError(LOGIN_TEMPLATE, 'Invalid username or password', returnInfo);
    }

    const user = await userService.getUserByUsername(username);
    if (!user) {
        throw new ValidationError(LOGIN_TEMPLATE, 'Invalid username or password', returnInfo);
    }

    const isValidPassword = await userService.verifyPassword(user.id, password);
    if (!isValidPassword) {
        throw new ValidationError(LOGIN_TEMPLATE, 'Invalid username or password', returnInfo);
    }

    if (!user.isActive) {
        let errorMsg = "User not activated.";
        if ((user.activationTokenExpiration ?? new Date(0)) < new Date()) {
            // Generiere den Aktivierungs-Token und sende ihn per E-Mail
            const token = await userService.generateActivationToken(user.id);
            const activationLink = `${settings.value.rootUrl}/users/activate/${token}`;

            await mailer.sendActivationEmail(user.email, activationLink);
            errorMsg += " The activation link has expired. A new one has been sent to your email account.";
        }
        throw new ValidationError(LOGIN_TEMPLATE, errorMsg, returnInfo);
    }

    session.auth = {user};
    session.profile = getDefaultProfile(user.profiles);
    await persistSession(session);
}

export async function getDashboardEntities(profile: Profile) {
    const [
        surveys,
        partSurveys,
        ownPacklists,
        adminPacklists,
        partPackLists,
        ownActivityplans,
        adminActivityplans,
        partActivityPlans,
        ownDriverslists,
        adminDriverslists,
        partDriversLists,
        ownEvents,
        adminEvents,
        registeredEvents
    ] = await Promise.all([
        surveyService.getSurveysByProfileId(profile.id),
        surveyService.getSurveysByParticipant(profile.id),
        packingService.getPackingListByProfileId(profile.id),
        packingService.getManagedLists(profile.id),
        packingService.getPackingListByParticipant(profile.id),
        activityService.getActivityPlansByProfileId(profile.id),
        activityService.getManagedPlans(profile.id),
        activityService.getActivityPlansByParticipant(profile.id),
        driverService.getDriversListByProfileId(profile.id),
        driverService.getManagedListsForProfile(profile.id),
        driverService.getDriversListByParticipant(profile.id),
        eventService.getEventsByOwnerId(profile.id),
        eventService.getActiveManagedEvents(profile.id),
        eventService.getRegisteredEventsFor(profile.id),
    ])

    const packlists = merge(ownPacklists, adminPacklists, (a, b) => a.id === b.id);
    const activityplans = merge(ownActivityplans, adminActivityplans, (a, b) => a.id === b.id);
    const driverslists = merge(ownDriverslists, adminDriverslists, (a, b) => a.id === b.id);
    const events = merge(ownEvents, adminEvents, (a, b) => a.id === b.id);

    return {
        owner: {
            surveys: surveys,
            packingLists: packlists,
            activityPlans: activityplans,
            driversLists: driverslists,
            events: events
        },
        participant: {
            surveys: partSurveys,
            packingLists: partPackLists,
            activityPlans: partActivityPlans,
            driversLists: partDriversLists,
            events: registeredEvents
        }
    } as DashboardDTO;
}

export async function getEntityList(profile: Profile) {
    const dto = await getDashboardEntities(profile);
    return {owner: convertToSingleList(dto.owner ?? {}), participant: convertToSingleList(dto.participant ?? {})}
}

export async function sendPasswordForgotMail(username: string) {
    const user = (await userService.getUserByUsername(username)) || (await userService.getUserByEmail(username));
    if (!user) {
        return;
    }

    // Generiere ein Passwort-Zurücksetzungs-Token und speichere es in der Datenbank
    const token = await userService.generatePasswordResetToken(user.username);
    const resetLink = `${settings.value.rootUrl}/users/reset-password/${token}`;

    // Sende eine E-Mail mit dem Zurücksetzungs-Link
    await mailer.sendPasswordResetEmail(user.email, resetLink);
}

export async function checkPasswordForgotToken(token: string) {
    // Überprüfe, ob der Token gültig ist
    const user = await userService.verifyPasswordResetToken(token);
    if (!user) {
        throw new ExpectedError('Invalid or expired token', 'error', 401);
    }
}

export async function resetPassword(token: string, body: any) {
    const {password, confirmPassword} = body;

    if (password !== confirmPassword) {
        throw new ValidationError('users/reset-password', 'Passwords do not match!', {token})
    }

    // Überprüfe den Token und setze das Passwort zurück
    const user = await userService.verifyPasswordResetToken(token);
    if (!user) {
        throw new ExpectedError('Invalid or expired token', 'error', 401);
    }

    // Setze das Passwort zurück
    await userService.resetPassword(user.username, password);
}

export async function activateAccount(token: string) {
    // Überprüfe, ob der Aktivierungs-Token gültig ist
    const user = await userService.verifyActivationToken(token);
    if (!user) {
        throw new ExpectedError('Invalid or expired token', 'error', 401);
    }

    // Aktiviere den Benutzer
    await userService.activateUser(user.id);
}

/**
 * ---- OIDC integration (v6) ----
 * These are thin controller wrappers that delegate to your oidc module.
 * They keep your controller layer consistent with the manual login flow.
 */

// GET /auth/login → redirect to Authentik
export async function loginUserWithOidc(session: Request['session']) {
    // Delegates to startLogin (buildAuthorizationUrl + session PKCE/nonce)
    return oidc.startLogin(session);
}

// GET /auth/callback → handles code exchange, JIT-provision, session setup, redirect
export async function loginUserWithOidcCallback(req: Request) {
    // oidcCallback sets req.session.userId and req.session.user, then redirects
    return oidc.callback(req);
}

// POST /auth/logout → clears local session and (if available) does RP-initiated logout
export async function logoutUserOidc(session: Request['session']) {
    return oidc.logout(session);
}

// Guests
export async function loginGuest(guestId: string, token: string, session: Request["session"]) {
    const guest = await userService.getGuestByToken(token, guestId);
    if (!guest) {
        throw new ExpectedError('Invalid or mismatched token', 'error', 401);
    }
    // switch to guest session
    session.auth = {guest};
    session.profile = guest.profile;
    await persistSession(session);
}

export async function recoverGuestAccount(email: string) {
    const guests = await userService.getGuestByEmail(email);
    const guestLinkData: GuestLinkData[] = [];
    for (let guest of guests) {
        guestLinkData.push({...guest, link: buildGuestLink(guest.id, guest.token)});
    }

    if (guestLinkData.length > 0) {
        await mailer.sendGuestRecoveryEmail(email, guestLinkData);
    }
}

export async function hasGuestAccountForEmail(email: string) {
    const guests = await userService.getGuestByEmail(email);
    return guests.length > 0;
}

export async function getMigrationToken(profileId: string) {
    return await userService.generateMigrationToken(profileId);
}

export async function getProfileToMigrate(token: string) {
    const profile = await userService.verifyMigrationToken(token);
    if (!profile) {
        throw new ExpectedError('Invalid or mismatched token', 'error', 401);
    }
    return profile;
}

export async function migrateProfile(userId: number, token: string) {
    const profile = await getProfileToMigrate(token);
    const previousOwner = await userService.moveProfileToUserTx(profile.id, userId);
    if (previousOwner?.email) {
        await mailer.sendMigrationEmail(previousOwner.email, profile, (await userService.getUserById(userId))!)
    }
    return `Migration successful. ${await handlePreviousProfileOwner(previousOwner)}`;
}

async function handlePreviousProfileOwner(previousOwner?: User | Guest) {
    if (previousOwner instanceof User) {
        const otherProfiles = await userService.getProfilesForUser(previousOwner.id);
        if (otherProfiles.length === 0) {
            await userService.deleteUser(previousOwner.id);
            await mailer.sendDeletionEmail(previousOwner.email, previousOwner);
            return "Previous user account permanently deleted!"
        }
    } else if (previousOwner instanceof Guest) {
        await userService.deleteGuest(previousOwner.id);
        if (previousOwner.email) {
            await mailer.sendDeletionEmail(previousOwner.email, previousOwner);
        }
        return "Previous guest account permanently deleted!"
    }
    return '';
}

export async function deleteAccount(body: any, session: Request['session']) {
    const {username} = body;
    if (!username || (username !== session.auth?.guest?.username && username !== session.auth?.user?.username)) {
        throw new ValidationError("users/delete-account", "Invalid account deletion verification", {username});
    }
    if (session.auth?.guest && session.auth.user) {
        throw new ExpectedError("Ambiguous session. Log out and try again", "error", 500);
    }
    if (session.auth?.user) {
        return deleteUser(session);
    }
    if (session.auth?.guest) {
        return deleteGuest(session);
    }
    throw new ExpectedError("Invalid session. Log out and try again", "error", 500);
}

export async function deleteUser(session: Request['session']) {
    if (!session.auth?.user) {
        throw new ExpectedError("Not logged in as user!", "error", 401);
    }
    const deleted = await userService.deleteUser(session.auth.user.id);
    if (deleted?.email) {
        await mailer.sendDeletionEmail(deleted.email, deleted);
    }
    return await logoutUserOidc(session);
}

export async function deleteGuest(session: Request['session']) {
    if (!session.auth?.guest) {
        throw new ExpectedError("Not logged in as guest!", "error", 401);
    }

    const deleted = await userService.deleteGuest(session.auth.guest.id);
    if (deleted?.email) {
        await mailer.sendDeletionEmail(deleted.email, deleted);
    }
    return await logoutUserOidc(session);
}

export async function deactivateProfile(body: any, session: Request['session']) {
    const {name} = body;
    if (!name || name !== session.profile?.name) {
        throw new ValidationError("users/profile/delete", "Invalid profile deactivation verification", {name});
    }

    if (!session.profile) {
        throw new ExpectedError("No active profile!", "error", 401);
    }

    const previousOwner = await userService.removeProfileFromOwner(session.profile.id);
    const handleAnswer = await handlePreviousProfileOwner(previousOwner);
    return `Profile successfully deactivated. ${handleAnswer}`;
}

export async function changeActiveProfile(session: Request['session'], profileId?: string) {
    if (!session.auth?.user) {
        throw new ExpectedError("Not logged in as user!", "error", 401);
    }

    let profile;
    if (profileId) {
        profile = await userService.getProfileById(profileId);
        if (profile?.userId !== session.auth.user.id) {
            throw new ExpectedError("Invalid profile id", "error", 400);
        }
    } else {
        const profiles = await userService.getProfilesForUser(session.auth.user.id);
        if (profiles.length > 0) {
            profile = getDefaultProfile(profiles);
        } else {
            throw new ExpectedError("Invalid profile id", "error", 400);
        }
    }

    session.profile = profile;
    await persistSession(session);
}

export async function validateSession(session: Request['session']) {
    let ok = true;
    // Check profile validity
    if (ok && session.profile) {
        const profile = await userService.getProfileById(session.profile.id);
        if (!profile || (profile.userId !== session.auth?.user?.id && profile.guestId !== session.auth?.guest?.id)) {
            ok = false;
        }
    }

    // Check user authentication
    if (ok && session.auth?.user) {
        const user = await userService.getUserById(session.auth.user.id);
        if (!user) {
            ok = false;
        }
    }

    // Check guest authentication
    if (ok && session.auth?.guest) {
        const guest = await userService.getGuestInternal(session.auth.guest.id);
        if (!guest) {
            ok = false;
        }
    }

    // Check for dangling profile without auth
    if (ok && session.profile && !session.auth) {
        ok = false;
    }

    return ok;
}

export async function updateProfile(body: any, session: Request['session']) {
    const {name, isDefault} = body;
    const profileId = session.profile!.id;
    if (name?.trim()?.length === 0) {
        throw new ValidationError("users/profile/view", "Invalid profile name");
    }
    if (name) {
        await userService.updateProfileName(profileId, name);
    }
    await userService.updateProfileDefault(profileId, !!isDefault);

    session.profile = await userService.getProfileById(profileId);
    await persistSession(session);
    return "Updated profile";
}

export async function getProfilesForUser(userId: number) {
    return await userService.getProfilesForUser(userId);
}

export async function createProfile(body: any, userId: number) {
    const {name} = body;
    if (name?.trim()?.length === 0) {
        throw new ValidationError("users/profile/create", "Invalid profile name", body);
    }
    return await userService.createProfile(userId, name);
}

export function getDefaultProfile(profiles: Profile[]) {
    const sortedProfiles = profiles.toSorted((a, b) => a.track.createdAt.getTime() - b.track.createdAt.getTime())
    let profile = sortedProfiles.find(p => p.defaultForOwner);
    // No default profile --> use oldest instead.
    profile ??= sortedProfiles[0];

    return profile;
}