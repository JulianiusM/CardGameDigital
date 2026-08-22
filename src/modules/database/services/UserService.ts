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
import type { OidcClaims, UserInfo } from "../../../types/UserTypes";
import { coerceLimit, generateUniqueToken, maskEmail, SQL_ALLOW_LIST } from "../../lib/util";
import { AppDataSource } from "../dataSource";
import { DataSpace } from "../entities/user/DataSpace";
import { User } from "../entities/user/User";
import { hashPassword, verifyPasswordHash } from "../../passwordHash";

function hashOneTimeToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export async function registerUser(
    username: string,
    name: string,
    password: string,
    email: string,
) {
    return await AppDataSource.transaction(async (em: EntityManager) => {
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
    const repo = AppDataSource.getRepository(User);
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
    return await AppDataSource.getRepository(User).findOne({
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

export async function verifyPassword(userId: number, password: string) {
    const repo = AppDataSource.getRepository(User);
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
    const repo = AppDataSource.getRepository(User);
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
    const repo = AppDataSource.getRepository(User);
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

export async function activateUser(userId: number) {
    const repo = AppDataSource.getRepository(User);
    await repo.update(
        { id: userId },
        {
            isActive: true,
            activationTokenHash: null,
            activationTokenExpiration: null,
        },
    );
}

export async function consumeActivationToken(token: string): Promise<boolean> {
    const result = await AppDataSource.getRepository(User)
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
    const repo = AppDataSource.getRepository(User);
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
    const repo = AppDataSource.getRepository(User);
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

export async function resetPassword(username: string, newPassword: string) {
    const repo = AppDataSource.getRepository(User);
    const hashed = await hashPassword(newPassword);
    await repo.update(
        { username },
        {
            password: hashed,
            resetTokenHash: null,
            resetTokenExpiration: null,
        },
    );
}

export async function consumePasswordResetToken(
    token: string,
    newPassword: string,
): Promise<boolean> {
    const result = await AppDataSource.getRepository(User)
        .createQueryBuilder()
        .update(User)
        .set({
            password: await hashPassword(newPassword),
            resetTokenHash: null,
            resetTokenExpiration: null,
        })
        .where("reset_token_expiration > :now", { now: new Date() })
        .andWhere("reset_token_hash = :hash", { hash: hashOneTimeToken(token) })
        .execute();
    return result.affected === 1;
}

/**
 * ---- SSO / OIDC helpers ----
 */

async function usernameExists(username: string): Promise<boolean> {
    const repo = AppDataSource.getRepository(User);
    const count = await repo.count({ where: { username } });
    return count > 0;
}

async function toUniqueUsername(base: string): Promise<string> {
    const sanitized =
        base
            .toLowerCase()
            .replace(/[^a-z0-9._-]/g, "")
            .slice(0, 30) || "user";
    if (!(await usernameExists(sanitized))) return sanitized;

    // add numeric suffix
    for (let i = 1; i < 10_000; i++) {
        const candidate = `${sanitized}-${i}`;
        if (!(await usernameExists(candidate))) return candidate;
    }
    // fallback (should never happen)
    return `${sanitized}-${Date.now()}`;
}

/**
 * Find a user by OIDC issuer+sub.
 */
export async function getUserByOidc(oidcIssuer: string, oidcSub: string) {
    const repo = AppDataSource.getRepository(User);
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
 * Link an existing local user to an OIDC identity.
 * Useful if you want a one-time “Connect SSO” button.
 */
export async function linkUserToOidc(userId: number, oidcIssuer: string, oidcSub: string) {
    const repo = AppDataSource.getRepository(User);
    await repo.update({ id: userId }, { oidcIssuer, oidcSub });
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
    const repo = AppDataSource.getRepository(User);
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
            if (user.isActive !== true) user.isActive = true;
            await repo.save(user);
        }
    }

    // 3) If still not found: create a new local user (JIT provisioning)
    // inside findOrCreateUserFromOidc, in the "3) If still not found: create a new local user" block
    if (!user) {
        const baseUsername =
            preferred_username || (email ? email.split("@")[0] : `oidc_${sub.slice(0, 8)}`);
        const uniqueUsername = await toUniqueUsername(baseUsername);

        // Ensure we don't violate unique(email)
        let emailToUse = email_verified === true && email ? email : `${sub}@no-email.local`;

        // If linkByEmail is disabled OR the email is already taken, use a synthetic email
        if (email_verified === true && email) {
            const emailTaken = await repo.exists({ where: { email } });
            if (!linkByEmail || emailTaken) {
                emailToUse = `${sub}@no-email.local`;
            }
        }

        return await AppDataSource.transaction(async (em) => {
            const newUsr = em.getRepository(User).create({
                username: uniqueUsername,
                name: name || baseUsername,
                email: emailToUse,
                password: null,
                isActive: true,
                oidcIssuer,
                oidcSub: sub,
            });
            const newDataSpace = em.getRepository(DataSpace).create({
                name: newUsr.name,
                defaultForOwner: true,
                user: newUsr,
            });
            const savedDataSpace = await em.getRepository(DataSpace).save(newDataSpace);
            user = await handleUserSaving(newUsr, sub, em.getRepository(User));
            if (!user.dataSpaces || user.dataSpaces.length === 0) {
                user.dataSpaces = [savedDataSpace];
            }

            return user;
        });
    }

    return user;
}

async function handleUserSaving(user: User, sub: string, repo?: Repository<User>) {
    repo ??= AppDataSource.getRepository(User);
    try {
        user = await repo.save(user);
    } catch (err: any) {
        // Last-chance fallback for race conditions (MySQL/PG/SQLite)
        const message = String(err?.message || "");
        if (
            err?.code === "ER_DUP_ENTRY" || // MySQL/MariaDB
            err?.code === "23505" || // Postgres
            message.includes("UNIQUE") // SQLite/others
        ) {
            user.email = `${sub}@no-email.local`;
            user = await repo.save(user);
        } else {
            throw err;
        }
    }
    return user;
}

/**
 * Optional: remove OIDC link (keeps the local account).
 */
export async function unlinkOidc(userId: number) {
    const repo = AppDataSource.getRepository(User);
    await repo.update({ id: userId }, { oidcIssuer: null, oidcSub: null });
}

/**
 * Resolve by id | email | username.
 * Use only behind a permission check to avoid enumeration leaks.
 */
export async function findUserByNameOrEmail(identifier: string | number): Promise<User | null> {
    const repo = AppDataSource.getRepository(User);
    const raw = String(identifier).trim();

    if (/^\d+$/.test(raw)) {
        return await repo.findOne({ where: { id: Number(raw) } });
    }

    if (raw.includes("@")) {
        // case-insensitive email; avoid LOWER() on column to keep indexes usable where possible
        return await repo
            .createQueryBuilder("u")
            .where("u.email = :email", { email: raw })
            .orWhere("u.email LIKE :emailCase", { emailCase: raw }) // fallback for case-insensitive collations
            .orWhere("u.username = :username", { username: raw })
            .getOne();
    }

    // username exact, email fallback
    return await repo
        .createQueryBuilder("u")
        .where("u.username = :username", { username: raw })
        .orWhere("u.email = :email", { email: raw })
        .getOne();
}

/**
 * Prefix search for username/email (index-friendly). Validates the query.
 * Returns { id, username, emailMasked } (no raw email by default).
 */
export async function searchUsersSecure(query: string, limit = 10): Promise<Array<UserInfo>> {
    const repo = AppDataSource.getRepository(DataSpace);
    const q = (query || "").trim();

    if (!SQL_ALLOW_LIST.test(q)) return []; // too short / invalid chars -> no results
    const lim = coerceLimit(limit, 10, 25);

    const likePrefix = `${q}%`;

    const rows = await repo
        .createQueryBuilder("p")
        .innerJoinAndSelect("p.user", "u")
        .where("p.name LIKE :pfx", { pfx: likePrefix })
        .orWhere("u.email LIKE :pfx", { pfx: likePrefix })
        .orWhere("u.username LIKE :pfx", { pfx: likePrefix })
        .orderBy("p.name", "ASC")
        .limit(lim)
        .getMany();

    return rows.map((p) => ({
        id: p.id,
        username: p.user?.username ?? "-",
        email: maskEmail(p.user?.email),
        name: p.name,
    }));
}

/** Optional helpers you might find useful elsewhere */
export async function getUserById(id: number): Promise<User | null> {
    return await AppDataSource.getRepository(User).findOne({
        where: { id },
        relations: { dataSpaces: true },
    });
}

export async function getDataSpaceById(id: string) {
    return await AppDataSource.getRepository(DataSpace).findOneBy({ id });
}

export async function deleteUser(userId: number) {
    return AppDataSource.transaction(async (manager) => {
        const users = manager.getRepository(User);
        const deleted = await users.findOneBy({ id: userId });
        if (!deleted) return null;
        await manager.getRepository(DataSpace).delete({ user: { id: userId } });
        await users.delete({ id: userId });
        return deleted;
    });
}

export async function getDataSpacesForUser(userId: number) {
    const repo = AppDataSource.getRepository(DataSpace);
    return await repo.findBy({ user: { id: userId } });
}

export async function updateDataSpaceName(dataSpaceId: string, name: string) {
    const repo = AppDataSource.getRepository(DataSpace);
    await repo.update({ id: dataSpaceId }, { name: name });
}

export async function updateDataSpaceDefault(dataSpaceId: string, isDefault: boolean) {
    await AppDataSource.transaction(async (em) => {
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
    const repo = AppDataSource.getRepository(DataSpace);
    const dataSpace = repo.create({ user: { id: userId }, name: name });
    return await repo.save(dataSpace);
}
