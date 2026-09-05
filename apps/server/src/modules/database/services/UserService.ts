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

import { createHash } from "node:crypto";
import { EntityManager, MoreThan, Repository } from "typeorm";
import type { OidcClaims } from "../../../types/UserTypes";
import { generateUniqueToken } from "../../lib/util";
import { getAppDataSource } from "../dataSource";
import { DataSpace } from "../../../../../../packages/persistence/entities/user/DataSpace";
import { User } from "../../../../../../packages/persistence/entities/user/User";
import { hashPassword, verifyPasswordHash } from "../../passwordHash";

const missingAccountPasswordHash = hashPassword("constant-time-missing-account-password");

function hashOneTimeToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

function oidcIdentityHash(issuer: string, sub: string): string {
    return createHash("sha256").update(`${issuer}\0${sub}`).digest("hex");
}

function syntheticOidcEmail(issuer: string, sub: string): string {
    return `${oidcIdentityHash(issuer, sub)}@no-email.invalid`;
}

function isUniqueConstraintError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const candidate = error as { code?: unknown; message?: unknown };
    return (
        candidate.code === "ER_DUP_ENTRY" ||
        candidate.code === "23505" ||
        (typeof candidate.message === "string" &&
            candidate.message.toUpperCase().includes("UNIQUE"))
    );
}

export async function registerUser(
    username: string,
    name: string,
    password: string,
    email: string,
) {
    return await getAppDataSource().transaction(async (em: EntityManager) => {
        const repo = em.getRepository(User);
        const hashed = await hashPassword(password);

        const user = repo.create({
            username,
            name,
            password: hashed,
            email,
            isActive: false,
        });
        const result = await repo.save(user);

        const dataSpaceRepo = em.getRepository(DataSpace);
        const dataSpace = dataSpaceRepo.create({ name, defaultForOwner: true, user: result });
        await dataSpaceRepo.save(dataSpace);
        return result.id;
    });
}

export async function getUserByUsername(username: string) {
    const repo = getAppDataSource().getRepository(User);
    return await repo.findOne({
        where: { username },
        select: {
            id: true,
            name: true,
            username: true,
            email: true,
            isActive: true,
        },
        relations: {
            dataSpaces: true,
        },
    });
}

export async function getUserByEmail(email: string) {
    return await getAppDataSource()
        .getRepository(User)
        .findOne({
            where: { email },
            select: {
                id: true,
                name: true,
                username: true,
                email: true,
                isActive: true,
            },
            relations: {
                dataSpaces: true,
            },
        });
}

export async function verifyPassword(userId: number | null, password: string) {
    if (userId === null) {
        await verifyPasswordHash(password, await missingAccountPasswordHash);
        return false;
    }
    const repo = getAppDataSource().getRepository(User);
    const user = await repo.findOne({
        where: { id: userId },
        select: {
            password: true,
        },
    });
    if (!user?.password) return false;
    return verifyPasswordHash(password, user.password);
}

export async function generateActivationToken(userId: number) {
    const repo = getAppDataSource().getRepository(User);
    const token = generateUniqueToken();
    const expiration = new Date(Date.now() + 3_600_000);
    await repo.update(
        { id: userId },
        {
            activationTokenHash: hashOneTimeToken(token),
            activationTokenExpiration: expiration,
        },
    );
    return token;
}

export async function verifyActivationToken(token: string) {
    const repo = getAppDataSource().getRepository(User);
    return await repo.findOne({
        where: {
            activationTokenHash: hashOneTimeToken(token),
            activationTokenExpiration: MoreThan(new Date()),
        },
        select: {
            id: true,
            name: true,
            username: true,
            email: true,
            isActive: true,
        },
    });
}

export async function consumeActivationToken(token: string): Promise<boolean> {
    const result = await getAppDataSource()
        .getRepository(User)
        .createQueryBuilder()
        .update(User)
        .set({
            isActive: true,
            activationTokenHash: null,
            activationTokenExpiration: null,
        })
        .where("activation_token_expiration > :now", { now: new Date() })
        .andWhere("activation_token_hash = :hash", { hash: hashOneTimeToken(token) })
        .execute();
    return result.affected === 1;
}

export async function generatePasswordResetToken(username: string) {
    const repo = getAppDataSource().getRepository(User);
    const token = generateUniqueToken();
    const expiration = new Date(Date.now() + 3_600_000);
    await repo.update(
        { username },
        {
            resetTokenHash: hashOneTimeToken(token),
            resetTokenExpiration: expiration,
        },
    );
    return token;
}

export async function verifyPasswordResetToken(token: string) {
    const repo = getAppDataSource().getRepository(User);
    return await repo.findOne({
        where: {
            resetTokenHash: hashOneTimeToken(token),
            resetTokenExpiration: MoreThan(new Date()),
        },
        select: {
            id: true,
            name: true,
            username: true,
            email: true,
            isActive: true,
        },
    });
}

export async function consumePasswordResetToken(
    token: string,
    newPassword: string,
): Promise<number | null> {
    return getAppDataSource().transaction(async (manager) => {
        const repository = manager.getRepository(User);
        const user = await repository.findOne({
            where: {
                resetTokenHash: hashOneTimeToken(token),
                resetTokenExpiration: MoreThan(new Date()),
            },
            select: { id: true },
        });
        if (!user) return null;
        const result = await repository.update(
            { id: user.id, resetTokenHash: hashOneTimeToken(token) },
            {
                password: await hashPassword(newPassword),
                resetTokenHash: null,
                resetTokenExpiration: null,
            },
        );
        return result.affected === 1 ? user.id : null;
    });
}

/**
 * ---- SSO / OIDC helpers ----
 */

async function usernameExists(username: string): Promise<boolean> {
    const repo = getAppDataSource().getRepository(User);
    const count = await repo.count({ where: { username } });
    return count > 0;
}

async function toUniqueUsername(base: string): Promise<string> {
    const sanitized =
        base
            .toLowerCase()
            .replace(/[^a-z0-9._-]/g, "")
            .slice(0, 50) || "user";
    if (!(await usernameExists(sanitized))) return sanitized;

    for (let i = 1; i < 10_000; i++) {
        const suffix = `-${i}`;
        const candidate = `${sanitized.slice(0, 50 - suffix.length)}${suffix}`;
        if (!(await usernameExists(candidate))) return candidate;
    }
    throw new Error("Could not allocate a unique OIDC username");
}

/**
 * Find a user by OIDC issuer+sub.
 */
export async function getUserByOidc(oidcIssuer: string, oidcSub: string) {
    const repo = getAppDataSource().getRepository(User);
    return await repo.findOne({
        where: { oidcIssuer, oidcSub },
        select: {
            id: true,
            name: true,
            username: true,
            email: true,
            isActive: true,
        },
        relations: {
            dataSpaces: true,
        },
    });
}

/**
 * Find or create a user from OIDC claims.
 * - Primary key: (issuer, sub)
 * - Optional fallback: email match (link existing local account)
 * - JIT-provisions a new user when needed.
 */
export async function findOrCreateUserFromOidc(
    oidcIssuer: string,
    claims: OidcClaims,
    { linkByEmail = true } = {},
) {
    const repo = getAppDataSource().getRepository(User);
    const { sub, email, email_verified, preferred_username, name } = claims;

    // 1) Try exact OIDC match first
    let user = await repo.findOne({
        where: { oidcIssuer, oidcSub: sub },
        relations: { dataSpaces: true },
    });

    // 2) If not found: try link-by-email (optional)
    if (!user && linkByEmail && email && email_verified === true) {
        user = await repo.findOne({ where: { email }, relations: { dataSpaces: true } });
        if (user) {
            user.oidcIssuer = oidcIssuer;
            user.oidcSub = sub;
            user.isActive = true;
            await repo.save(user);
        }
    }

    // 3) If still not found: create a new local user (JIT provisioning)
    if (!user) {
        const { uniqueUsername, baseUsername, emailToUse } = await resolveNewOidcIdentity(
            preferred_username,
            email,
            sub,
            oidcIssuer,
            email_verified,
            repo,
            linkByEmail,
        );

        try {
            return await getAppDataSource().transaction(async (em) => {
                const users = em.getRepository(User);
                const newUser = users.create({
                    username: uniqueUsername,
                    name: name || baseUsername.slice(0, 50),
                    email: emailToUse,
                    password: null,
                    isActive: true,
                    oidcIssuer,
                    oidcSub: sub,
                });
                user = await saveOidcUser(newUser, oidcIssuer, sub, users);
                const savedDataSpace = await em.getRepository(DataSpace).save(
                    em.getRepository(DataSpace).create({
                        name: user.name,
                        defaultForOwner: true,
                        user,
                    }),
                );
                user.dataSpaces = [savedDataSpace];
                return user;
            });
        } catch (error) {
            if (isUniqueConstraintError(error)) {
                const concurrentUser = await getUserByOidc(oidcIssuer, sub);
                if (concurrentUser) return concurrentUser;
            }
            throw error;
        }
    }

    return user;
}

async function resolveNewOidcIdentity(
    preferred_username: string | undefined,
    email: string | undefined,
    sub: string,
    oidcIssuer: string,
    email_verified: boolean | undefined,
    repo: Repository<User>,
    linkByEmail: boolean,
) {
    const rawBaseUsername =
        preferred_username || (email ? email.split("@")[0] : `oidc_${sub.slice(0, 8)}`);
    const identityHash = oidcIdentityHash(oidcIssuer, sub);
    const baseUsername =
        rawBaseUsername
            .toLowerCase()
            .replace(/[^a-z0-9._-]/g, "")
            .slice(0, 40) || "user";
    const uniqueUsername = await toUniqueUsername(`${baseUsername}-${identityHash.slice(0, 8)}`);

    // Ensure we don't violate unique(email)
    let emailToUse = email_verified === true && email ? email : syntheticOidcEmail(oidcIssuer, sub);

    // If linkByEmail is disabled OR the email is already taken, use a synthetic email
    if (email_verified === true && email) {
        const emailTaken = await repo.exists({ where: { email } });
        if (!linkByEmail || emailTaken) {
            emailToUse = syntheticOidcEmail(oidcIssuer, sub);
        }
    }
    return { uniqueUsername, baseUsername, emailToUse };
}

async function saveOidcUser(
    user: User,
    issuer: string,
    sub: string,
    repository: Repository<User>,
): Promise<User> {
    try {
        return await repository.save(user);
    } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        user.email = syntheticOidcEmail(issuer, sub);
        return repository.save(user);
    }
}

export async function getUserById(id: number): Promise<User | null> {
    return await getAppDataSource()
        .getRepository(User)
        .findOne({
            where: { id },
            relations: { dataSpaces: true },
        });
}

export type StoredLanguagePreferences = {
    useSystemLanguage: boolean;
    interfaceLocale: string | null;
    cardLocale: string | null;
    fallbackLocales: string[];
};

export function languagePreferencesForUser(user: User): StoredLanguagePreferences | null {
    const manuallyConfigured =
        user.useSystemLanguage !== null && user.useSystemLanguage !== undefined;
    if (
        !manuallyConfigured &&
        !user.interfaceLocale &&
        !user.cardLocale &&
        !user.languageFallbacksJson
    )
        return null;
    let fallbackLocales: string[] = [];
    if (user.languageFallbacksJson) {
        const parsed: unknown = JSON.parse(user.languageFallbacksJson);
        if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
            throw new Error("Stored account language preferences are invalid");
        }
        fallbackLocales = parsed;
    }
    return {
        useSystemLanguage: user.useSystemLanguage ?? true,
        interfaceLocale: user.interfaceLocale ?? null,
        cardLocale: user.cardLocale ?? null,
        fallbackLocales,
    };
}

export async function updateLanguagePreferences(
    userId: number,
    patch: Partial<StoredLanguagePreferences>,
): Promise<void> {
    const repository = getAppDataSource().getRepository(User);
    const user = await repository.findOneByOrFail({ id: userId });
    const current = languagePreferencesForUser(user) ?? {
        useSystemLanguage: true,
        interfaceLocale: null,
        cardLocale: null,
        fallbackLocales: [],
    };
    const next = { ...current, ...patch };
    await repository.update(
        { id: userId },
        {
            useSystemLanguage: next.useSystemLanguage,
            interfaceLocale: next.interfaceLocale,
            cardLocale: next.cardLocale,
            languageFallbacksJson: JSON.stringify(next.fallbackLocales),
        },
    );
}

export async function getDataSpaceById(id: string) {
    return await getAppDataSource().getRepository(DataSpace).findOneBy({ id });
}

export async function deleteUser(userId: number) {
    return getAppDataSource().transaction(async (manager) => {
        const users = manager.getRepository(User);
        const deleted = await users.findOneBy({ id: userId });
        if (!deleted) return null;
        await manager.getRepository(DataSpace).delete({ user: { id: userId } });
        await users.delete({ id: userId });
        return deleted;
    });
}

export async function getDataSpacesForUser(userId: number) {
    const repo = getAppDataSource().getRepository(DataSpace);
    return await repo.findBy({ user: { id: userId } });
}

/**
 * Return an owned DataSpace, creating the account's initial one when old or
 * externally linked account data predates that invariant.
 *
 * Locking the owner row on server databases serializes concurrent repair
 * requests. better-sqlite3 serializes writes itself and does not support
 * pessimistic locks.
 */
export async function ensureDataSpaceForUser(userId: number): Promise<DataSpace | null> {
    return getAppDataSource().transaction(async (manager) => {
        const userQuery = manager
            .getRepository(User)
            .createQueryBuilder("user")
            .where("user.id = :userId", { userId });
        if (getAppDataSource().options.type !== "better-sqlite3") {
            userQuery.setLock("pessimistic_write");
        }
        const user = await userQuery.getOne();
        if (!user) return null;

        const repository = manager.getRepository(DataSpace);
        const existing = await repository.findBy({ user: { id: userId } });
        if (existing.length > 0) {
            return existing.find(({ defaultForOwner }) => defaultForOwner) ?? existing[0];
        }

        return repository.save(
            repository.create({
                name: user.name,
                defaultForOwner: true,
                user,
            }),
        );
    });
}

export async function updateDataSpaceName(dataSpaceId: string, name: string) {
    const repo = getAppDataSource().getRepository(DataSpace);
    await repo.update({ id: dataSpaceId }, { name: name });
}

export async function updateDataSpaceDefault(dataSpaceId: string, isDefault: boolean) {
    await getAppDataSource().transaction(async (em) => {
        const repo = em.getRepository(DataSpace);
        if (isDefault) {
            // Remove all other defaults for the owner of this dataSpace if a new one is set
            const dataSpace = await repo.findOneByOrFail({ id: dataSpaceId });
            if (dataSpace.userId) {
                await repo.update({ user: { id: dataSpace.userId } }, { defaultForOwner: false });
            }
        }
        await repo.update({ id: dataSpaceId }, { defaultForOwner: isDefault });
    });
}

export async function createDataSpace(userId: number, name: string) {
    const repo = getAppDataSource().getRepository(DataSpace);
    const dataSpace = repo.create({ user: { id: userId }, name: name });
    return await repo.save(dataSpace);
}

export type DeleteDataSpaceResult =
    | { status: "not-found" }
    | { status: "last-data-space" }
    | { status: "deleted"; selectedDataSpaceId: string };

/** Delete only an owned DataSpace and preserve a valid account selection. */
export async function deleteDataSpace(
    userId: number,
    dataSpaceId: string,
): Promise<DeleteDataSpaceResult> {
    return getAppDataSource().transaction(async (manager) => {
        const userQuery = manager
            .getRepository(User)
            .createQueryBuilder("user")
            .where("user.id = :userId", { userId });
        if (getAppDataSource().options.type !== "better-sqlite3") {
            userQuery.setLock("pessimistic_write");
        }
        if (!(await userQuery.getOne())) return { status: "not-found" };

        const repository = manager.getRepository(DataSpace);
        const owned = await repository.findBy({ user: { id: userId } });
        const target = owned.find(({ id }) => id === dataSpaceId);
        if (!target) return { status: "not-found" };
        if (owned.length === 1) return { status: "last-data-space" };

        const remaining = owned.filter(({ id }) => id !== dataSpaceId);
        let selected = remaining.find(({ defaultForOwner }) => defaultForOwner) ?? remaining[0];
        if (target.defaultForOwner && !selected.defaultForOwner) {
            selected.defaultForOwner = true;
            selected = await repository.save(selected);
        }
        await repository.delete({ id: target.id, user: { id: userId } });
        return { status: "deleted", selectedDataSpaceId: selected.id };
    });
}
