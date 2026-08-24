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
import { AppDataSource } from "../dataSource";
import { DataSpace } from "../entities/user/DataSpace";
import { User } from "../entities/user/User";
import { hashPassword, verifyPasswordHash } from "../../passwordHash";

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
    const candidate = error as { code?: unknown; message?: unknown };
    return (
        candidate.code === "ER_DUP_ENTRY" ||
        candidate.code === "23505" ||
        String(candidate.message ?? "")
            .toUpperCase()
            .includes("UNIQUE")
    );
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
    if (!user) {
        const rawBaseUsername =
            preferred_username || (email ? email.split("@")[0] : `oidc_${sub.slice(0, 8)}`);
        const identityHash = oidcIdentityHash(oidcIssuer, sub);
        const baseUsername =
            rawBaseUsername
                .toLowerCase()
                .replace(/[^a-z0-9._-]/g, "")
                .slice(0, 40) || "user";
        const uniqueUsername = await toUniqueUsername(
            `${baseUsername}-${identityHash.slice(0, 8)}`,
        );

        // Ensure we don't violate unique(email)
        let emailToUse =
            email_verified === true && email ? email : syntheticOidcEmail(oidcIssuer, sub);

        // If linkByEmail is disabled OR the email is already taken, use a synthetic email
        if (email_verified === true && email) {
            const emailTaken = await repo.exists({ where: { email } });
            if (!linkByEmail || emailTaken) {
                emailToUse = syntheticOidcEmail(oidcIssuer, sub);
            }
        }

        try {
            return await AppDataSource.transaction(async (em) => {
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
