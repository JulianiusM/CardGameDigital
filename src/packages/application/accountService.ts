import { MESSAGE_KEYS } from "../localization/keys";
import type { Request } from "express";
import type { Locale } from "../localization/messages";
import type { DataSpace } from "../../modules/database/entities/user/DataSpace";
import { AppDataSource } from "../../modules/database/dataSource";
import { GroupEntity } from "../../modules/database/entities/game/GroupEntity";
import { DataSpaceGameSettingsEntity } from "../../modules/database/entities/game/DataSpaceGameSettingsEntity";
import { CouchGameSessionEntity } from "../../modules/database/entities/game/CouchGameSessionEntity";
import { GameSessionEntity } from "../../modules/database/entities/game/GameSessionEntity";
import { RoomEntity } from "../../modules/database/entities/game/RoomEntity";
import { CouchCardAppearanceEntity } from "../../modules/database/entities/game/CouchCardAppearanceEntity";
import { CardAppearanceEntity } from "../../modules/database/entities/game/CardAppearanceEntity";
import * as users from "../../modules/database/services/UserService";
import * as accountSessions from "../../modules/database/services/AccountSessionService";
import mailer from "../../modules/email";
import { ExpectedError } from "../../modules/lib/errors";
import { destroySession, persistSession, regenerateSession } from "../../modules/lib/session";
import * as oidc from "../../modules/oidc";
import settings from "../../modules/settings";

export type Registration = {
    username: string;
    displayName: string;
    password: string;
    email: string;
};

export async function register(locale: Locale, input: Registration): Promise<void> {
    const username = input.username.trim().toLowerCase();
    const email = input.email.trim().toLowerCase();
    if (await users.getUserByUsername(username)) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_USERNAME_TAKEN, "error", 409);
    }
    if (await users.getUserByEmail(email)) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_EMAIL_TAKEN, "error", 409);
    }
    let userId: number;
    try {
        userId = await users.registerUser(
            username,
            input.displayName.trim() || username,
            input.password,
            email,
        );
    } catch (error) {
        if (await users.getUserByUsername(username)) {
            throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_USERNAME_TAKEN, "error", 409);
        }
        if (await users.getUserByEmail(email)) {
            throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_EMAIL_TAKEN, "error", 409);
        }
        throw error;
    }
    const token = await users.generateActivationToken(userId);
    await mailer.sendActivationEmail(
        locale,
        email,
        `${settings.value.publicUrl}/play/account?activate=${token}`,
    );
}

export async function login(username: string, password: string, request: Request): Promise<void> {
    const user = await users.getUserByUsername(username.trim().toLowerCase());
    if (!(await users.verifyPassword(user?.id ?? null, password)) || !user) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_INVALID_CREDENTIALS, "error", 401);
    }
    if (!user.isActive) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_NOT_ACTIVATED, "error", 403);
    }
    const dataSpace = await users.ensureDataSpaceForUser(user.id);
    if (!dataSpace) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_AUTHENTICATION_REQUIRED, "error", 401);
    }
    const session = await regenerateSession(request);
    session.account = {
        userId: user.id,
        dataSpaceId: dataSpace.id,
    };
    await persistSession(session);
    await accountSessions.bindAccountSession(request.sessionID, user.id);
}

export async function activate(token: string): Promise<void> {
    if (!(await users.consumeActivationToken(token))) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_INVALID_ACTIVATION, "error", 401);
    }
}

export async function requestPasswordReset(locale: Locale, identifier: string): Promise<void> {
    const normalized = identifier.trim().toLowerCase();
    const user =
        (await users.getUserByUsername(normalized)) ?? (await users.getUserByEmail(normalized));
    if (!user) return;
    const token = await users.generatePasswordResetToken(user.username);
    await mailer.sendPasswordResetEmail(
        locale,
        user.email,
        `${settings.value.publicUrl}/play/account?reset=${token}`,
    );
}

export async function requestActivation(locale: Locale, identifier: string): Promise<void> {
    const normalized = identifier.trim().toLowerCase();
    const user =
        (await users.getUserByUsername(normalized)) ?? (await users.getUserByEmail(normalized));
    if (!user || user.isActive) return;
    const token = await users.generateActivationToken(user.id);
    await mailer.sendActivationEmail(
        locale,
        user.email,
        `${settings.value.publicUrl}/play/account?activate=${token}`,
    );
}

export async function resetPassword(token: string, password: string): Promise<number> {
    const userId = await users.consumePasswordResetToken(token, password);
    if (!userId) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_INVALID_RESET, "error", 401);
    }
    await accountSessions.revokeAllAccountSessions(userId);
    return userId;
}

export async function logout(session: Request["session"]): Promise<void> {
    await destroySession(session);
}

export async function deleteAccount(
    locale: Locale,
    username: string,
    session: Request["session"],
): Promise<void> {
    const user = await requireUser(session);
    if (username !== user.username) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_USERNAME_MISMATCH, "error", 400);
    }
    const deleted = await users.deleteUser(user.id);
    if (deleted) await mailer.sendDeletionEmail(locale, deleted.email, deleted.username);
    await logout(session);
}

export async function selectDataSpace(session: Request["session"], id: string): Promise<void> {
    const user = await requireUser(session);
    const dataSpace = await users.getDataSpaceById(id);
    if (!dataSpace || dataSpace.userId !== user.id) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_DATA_SPACE_NOT_FOUND, "error", 404);
    }
    session.account = { userId: user.id, dataSpaceId: dataSpace.id };
    await persistSession(session);
}

export async function createDataSpace(session: Request["session"], name: string) {
    const user = await requireUser(session);
    const created = await users.createDataSpace(user.id, name.trim());
    session.account = { userId: user.id, dataSpaceId: created.id };
    await persistSession(session);
    return created;
}

export async function updateDataSpace(
    session: Request["session"],
    name: string,
    isDefault: boolean,
): Promise<void> {
    const dataSpace = await ensureCurrentDataSpace(session);
    await users.updateDataSpaceName(dataSpace.id, name.trim());
    await users.updateDataSpaceDefault(dataSpace.id, isDefault);
    await persistSession(session);
}

export async function deleteDataSpace(session: Request["session"], id: string) {
    const user = await requireUser(session);
    const result = await users.deleteDataSpace(user.id, id);
    if (result.status === "not-found") {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_DATA_SPACE_NOT_FOUND, "error", 404);
    }
    if (result.status === "last-data-space") {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_LAST_DATA_SPACE, "error", 409);
    }
    if (session.account?.dataSpaceId === id) {
        session.account = { userId: user.id, dataSpaceId: result.selectedDataSpaceId };
        await persistSession(session);
    }
    return accountSnapshot(session);
}

export async function accountSnapshot(session: Request["session"]) {
    const user = await requireUser(session);
    const activeDataSpace = await ensureCurrentDataSpaceForUser(session, user.id);
    const dataSpaces = await users.getDataSpacesForUser(user.id);
    return {
        user: { id: user.id, username: user.username, name: user.name, email: user.email },
        languagePreferences: users.languagePreferencesForUser(user),
        activeDataSpaceId: activeDataSpace.id,
        dataSpaces: dataSpaces.map(({ id, name, defaultForOwner }) => ({
            id,
            name,
            defaultForOwner,
        })),
    };
}

export async function updateLanguagePreferences(
    session: Request["session"],
    patch: Partial<users.StoredLanguagePreferences>,
) {
    const user = await requireUser(session);
    await users.updateLanguagePreferences(user.id, patch);
    return accountSnapshot(session);
}

export function requireAccountIdentity(session: Request["session"]): {
    userId: number;
    dataSpaceId: string | null;
} {
    const identity = session.account;
    if (!identity)
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_AUTHENTICATION_REQUIRED, "error", 401);
    return identity;
}

export async function requireUser(session: Request["session"]) {
    const identity = requireAccountIdentity(session);
    const user = await users.getUserById(identity.userId);
    if (!user) throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_AUTHENTICATION_REQUIRED, "error", 401);
    return user;
}

export function defaultDataSpace(dataSpaces: DataSpace[]): DataSpace | undefined {
    return dataSpaces.find((space) => space.defaultForOwner) ?? dataSpaces[0];
}

async function ensureCurrentDataSpaceForUser(
    session: Request["session"],
    userId: number,
): Promise<DataSpace> {
    const selectedId = session.account?.dataSpaceId;
    if (selectedId) {
        const selected = await users.getDataSpaceById(selectedId);
        if (selected?.userId === userId) return selected;
        if (selected) {
            throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_DATA_SPACE_FORBIDDEN, "error", 403);
        }
    }
    const repaired = await users.ensureDataSpaceForUser(userId);
    if (!repaired) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_AUTHENTICATION_REQUIRED, "error", 401);
    }
    session.account = { userId, dataSpaceId: repaired.id };
    await persistSession(session);
    return repaired;
}

/** Resolve the selected ownership boundary entirely from the server session. */
export async function ensureCurrentDataSpace(session: Request["session"]): Promise<DataSpace> {
    const user = await requireUser(session);
    return ensureCurrentDataSpaceForUser(session, user.id);
}

export async function validateSession(session: Request["session"]): Promise<boolean> {
    if (!session.account) return true;
    const user = await users.getUserById(session.account.userId);
    if (!user) return false;
    if (session.account.dataSpaceId) {
        const dataSpace = await users.getDataSpaceById(session.account.dataSpaceId);
        if (dataSpace) return dataSpace.userId === user.id;
    }
    const repaired = await users.ensureDataSpaceForUser(user.id);
    if (!repaired) return false;
    session.account = { userId: user.id, dataSpaceId: repaired.id };
    await persistSession(session);
    return true;
}

export const oidcLogin = oidc.startLogin;
export const oidcCallback = oidc.callback;

export async function listAccountSessions(session: Request["session"], currentId: string) {
    return accountSessions.listAccountSessions(requireAccountIdentity(session).userId, currentId);
}

export async function revokeAccountSession(session: Request["session"], id: string): Promise<void> {
    if (!(await accountSessions.revokeAccountSession(requireAccountIdentity(session).userId, id))) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_SESSION_NOT_FOUND, "error", 404);
    }
}

export async function exportAccount(session: Request["session"]) {
    const user = await requireUser(session);
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
    const couchSessions = ids.length
        ? await AppDataSource.getRepository(CouchGameSessionEntity)
              .createQueryBuilder("item")
              .where("item.dataSpaceId IN (:...ids)", { ids })
              .getMany()
        : [];
    const rooms = ids.length
        ? await AppDataSource.getRepository(RoomEntity)
              .createQueryBuilder("item")
              .where("item.dataSpaceId IN (:...ids)", { ids })
              .getMany()
        : [];
    const roomIds = rooms.map(({ id }) => id);
    const roomSessions = roomIds.length
        ? await AppDataSource.getRepository(GameSessionEntity)
              .createQueryBuilder("item")
              .where("item.roomId IN (:...roomIds)", { roomIds })
              .getMany()
        : [];
    const couchSessionIds = couchSessions.map(({ id }) => id);
    const roomSessionIds = roomSessions.map(({ id }) => id);
    const couchAppearances = couchSessionIds.length
        ? await AppDataSource.getRepository(CouchCardAppearanceEntity)
              .createQueryBuilder("item")
              .where("item.sessionId IN (:...sessionIds)", { sessionIds: couchSessionIds })
              .orderBy("item.sequence", "ASC")
              .getMany()
        : [];
    const roomAppearances = roomSessionIds.length
        ? await AppDataSource.getRepository(CardAppearanceEntity)
              .createQueryBuilder("item")
              .where("item.sessionId IN (:...sessionIds)", { sessionIds: roomSessionIds })
              .orderBy("item.sequence", "ASC")
              .getMany()
        : [];
    const projectSession = (
        topology: "COUCH" | "ROOM",
        item: CouchGameSessionEntity | GameSessionEntity,
        appearances: readonly (CouchCardAppearanceEntity | CardAppearanceEntity)[],
    ) => ({
        topology,
        id: item.id,
        groupId: item.groupId,
        mode: item.mode,
        revision: item.revision,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        cards: appearances
            .filter(({ sessionId }) => sessionId === item.id)
            .map(({ cardId, shownAt, roundNumber, sequence, skipped, completed, vetoed }) => ({
                cardId,
                shownAt,
                roundNumber,
                sequence,
                skipped,
                completed,
                vetoed,
            })),
    });
    return {
        exportedAt: new Date().toISOString(),
        account: { id: user.id, username: user.username, name: user.name, email: user.email },
        languagePreferences: users.languagePreferencesForUser(user),
        dataSpaces: dataSpaces.map(({ id, name, defaultForOwner }) => ({
            id,
            name,
            defaultForOwner,
        })),
        groups: groups.map(
            ({
                id,
                dataSpaceId,
                name,
                membersJson,
                preferredProfileId,
                customConfigurationJson,
                cardLanguageSettingsJson,
            }) => ({
                id,
                dataSpaceId,
                name,
                members: JSON.parse(membersJson),
                preferredProfileId,
                customConfiguration: customConfigurationJson
                    ? JSON.parse(customConfigurationJson)
                    : null,
                cardLanguageSettings: cardLanguageSettingsJson
                    ? JSON.parse(cardLanguageSettingsJson)
                    : null,
            }),
        ),
        gameSettings,
        gameSessions: [
            ...couchSessions.map((item) => projectSession("COUCH", item, couchAppearances)),
            ...roomSessions.map((item) => projectSession("ROOM", item, roomAppearances)),
        ],
    };
}
