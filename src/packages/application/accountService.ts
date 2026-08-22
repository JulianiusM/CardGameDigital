import { MESSAGE_KEYS } from "../localization/keys";
import type { Request } from "express";
import type { Locale } from "../localization/messages";
import type { DataSpace } from "../../modules/database/entities/user/DataSpace";
import { AppDataSource } from "../../modules/database/dataSource";
import { AccountSession } from "../../modules/database/entities/session/AccountSession";
import { GroupEntity } from "../../modules/database/entities/game/GroupEntity";
import { DataSpaceGameSettingsEntity } from "../../modules/database/entities/game/DataSpaceGameSettingsEntity";
import * as users from "../../modules/database/services/UserService";
import mailer from "../../modules/email";
import { ExpectedError } from "../../modules/lib/errors";
import { persistSession } from "../../modules/lib/session";
import * as oidc from "../../modules/oidc";
import settings from "../../modules/settings";

export type Registration = {
    username: string;
    displayName: string;
    password: string;
    email: string;
};

export async function register(locale: Locale, input: Registration): Promise<void> {
    if (await users.getUserByUsername(input.username)) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_USERNAME_TAKEN, "error", 409);
    }
    if (await users.getUserByEmail(input.email)) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_EMAIL_TAKEN, "error", 409);
    }
    const userId = await users.registerUser(
        input.username,
        input.displayName || input.username,
        input.password,
        input.email,
    );
    const token = await users.generateActivationToken(userId);
    await mailer.sendActivationEmail(
        locale,
        input.email,
        `${settings.value.rootUrl}/play/account?activate=${token}`,
    );
}

export async function login(
    username: string,
    password: string,
    session: Request["session"],
): Promise<void> {
    const user = await users.getUserByUsername(username);
    if (!user || !(await users.verifyPassword(user.id, password))) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_INVALID_CREDENTIALS, "error", 401);
    }
    if (!user.isActive) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_NOT_ACTIVATED, "error", 403);
    }
    session.auth = { user };
    session.dataSpace = defaultDataSpace(user.dataSpaces);
    await persistSession(session);
}

export async function activate(token: string): Promise<void> {
    if (!(await users.consumeActivationToken(token))) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_INVALID_ACTIVATION, "error", 401);
    }
}

export async function requestPasswordReset(locale: Locale, identifier: string): Promise<void> {
    const user =
        (await users.getUserByUsername(identifier)) ?? (await users.getUserByEmail(identifier));
    if (!user) return;
    const token = await users.generatePasswordResetToken(user.username);
    await mailer.sendPasswordResetEmail(
        locale,
        user.email,
        `${settings.value.rootUrl}/play/account?reset=${token}`,
    );
}

export async function resetPassword(token: string, password: string): Promise<void> {
    if (!(await users.consumePasswordResetToken(token, password))) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_INVALID_RESET, "error", 401);
    }
}

export async function logout(session: Request["session"]): Promise<void> {
    await oidc.logout(session);
}

export async function deleteAccount(
    locale: Locale,
    username: string,
    session: Request["session"],
): Promise<void> {
    const user = requireUser(session);
    if (username !== user.username) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_USERNAME_MISMATCH, "error", 400);
    }
    const deleted = await users.deleteUser(user.id);
    if (deleted) await mailer.sendDeletionEmail(locale, deleted.email, deleted.username);
    await logout(session);
}

export async function selectDataSpace(session: Request["session"], id: string): Promise<void> {
    const user = requireUser(session);
    const dataSpace = await users.getDataSpaceById(id);
    if (!dataSpace || dataSpace.userId !== user.id) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_DATA_SPACE_NOT_FOUND, "error", 404);
    }
    session.dataSpace = dataSpace;
    await persistSession(session);
}

export async function createDataSpace(
    session: Request["session"],
    name: string,
): Promise<DataSpace> {
    return users.createDataSpace(requireUser(session).id, name.trim());
}

export async function updateDataSpace(
    session: Request["session"],
    name: string,
    isDefault: boolean,
): Promise<void> {
    const user = requireUser(session);
    const id = session.dataSpace?.id;
    if (!id) throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_NO_DATA_SPACE, "error", 400);
    await users.updateDataSpaceName(id, name.trim());
    await users.updateDataSpaceDefault(id, isDefault);
    session.dataSpace = await users.getDataSpaceById(id);
    session.auth = { user: (await users.getUserById(user.id))! };
    await persistSession(session);
}

export async function accountSnapshot(session: Request["session"]) {
    const user = requireUser(session);
    const dataSpaces = await users.getDataSpacesForUser(user.id);
    return {
        user: { id: user.id, username: user.username, name: user.name, email: user.email },
        activeDataSpaceId: session.dataSpace?.id ?? null,
        dataSpaces: dataSpaces.map(({ id, name, defaultForOwner }) => ({
            id,
            name,
            defaultForOwner,
        })),
    };
}

export function requireUser(session: Request["session"]) {
    const user = session.auth?.user;
    if (!user) throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_AUTHENTICATION_REQUIRED, "error", 401);
    return user;
}

export function defaultDataSpace(dataSpaces: DataSpace[]): DataSpace | undefined {
    return dataSpaces.find((space) => space.defaultForOwner) ?? dataSpaces[0];
}

export async function validateSession(session: Request["session"]): Promise<boolean> {
    if (!session.auth?.user) return !session.dataSpace;
    const user = await users.getUserById(session.auth.user.id);
    if (!user) return false;
    if (!session.dataSpace) return true;
    const dataSpace = await users.getDataSpaceById(session.dataSpace.id);
    return dataSpace?.userId === user.id;
}

export const oidcLogin = oidc.startLogin;
export const oidcCallback = oidc.callback;

function accountIdFromSessionJson(json: string): number | null {
    try {
        return (JSON.parse(json) as { auth?: { user?: { id?: number } } }).auth?.user?.id ?? null;
    } catch {
        return null;
    }
}

export async function listAccountSessions(session: Request["session"], currentId: string) {
    const userId = requireUser(session).id;
    const rows = await AppDataSource.getRepository(AccountSession).find();
    return rows
        .filter((row) => accountIdFromSessionJson(row.json) === userId)
        .map((row) => ({
            id: row.id,
            current: row.id === currentId,
            expiresAt: Number(row.expiredAt),
        }));
}

export async function revokeAccountSession(session: Request["session"], id: string): Promise<void> {
    const repository = AppDataSource.getRepository(AccountSession);
    const row = await repository.findOneBy({ id });
    if (!row || accountIdFromSessionJson(row.json) !== requireUser(session).id) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_SESSION_NOT_FOUND, "error", 404);
    }
    await repository.delete({ id });
}

export async function exportAccount(session: Request["session"]) {
    const user = requireUser(session);
    const dataSpaces = await users.getDataSpacesForUser(user.id);
    const ids = dataSpaces.map(({ id }) => id);
    const groups = ids.length
        ? await AppDataSource.getRepository(GroupEntity)
              .createQueryBuilder("item")
              .where("item.dataSpaceId IN (:...ids)", { ids })
              .getMany()
        : [];
    const gameSettings = ids.length
        ? await AppDataSource.getRepository(DataSpaceGameSettingsEntity)
              .createQueryBuilder("item")
              .where("item.dataSpaceId IN (:...ids)", { ids })
              .getMany()
        : [];
    return {
        exportedAt: new Date().toISOString(),
        account: { id: user.id, username: user.username, name: user.name, email: user.email },
        dataSpaces: dataSpaces.map(({ id, name, defaultForOwner }) => ({
            id,
            name,
            defaultForOwner,
        })),
        groups: groups.map(({ id, dataSpaceId, name, membersJson }) => ({
            id,
            dataSpaceId,
            name,
            members: JSON.parse(membersJson),
        })),
        gameSettings,
    };
}
