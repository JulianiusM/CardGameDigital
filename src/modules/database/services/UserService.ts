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

import bcrypt from 'bcryptjs';
import {EntityManager, MoreThan, Repository} from "typeorm";
import type {OidcClaims, UserInfo} from "../../../types/UserTypes";
import {coerceLimit, generateUniqueToken, maskEmail, SQL_ALLOW_LIST} from '../../lib/util';
import {AppDataSource} from '../dataSource';
import {Guest} from '../entities/user/Guest';
import {Profile} from "../entities/user/Profile";
import {User} from '../entities/user/User';

export async function registerUser(username: string, name: string, password: string, email: string) {
    return await AppDataSource.transaction(async (em: EntityManager) => {
        const repo = em.getRepository(User);
        const hashed = await bcrypt.hash(password, 10);

        const user = repo.create({username, name, password: hashed, email, isActive: false});
        const result = await repo.save(user);

        const profileRepo = em.getRepository(Profile);
        const profile = profileRepo.create({name, defaultForOwner: true, user: result});
        await profileRepo.save(profile);
        return result.id;
    });
}

export async function getUserByUsername(username: string) {
    const repo = AppDataSource.getRepository(User);
    return await repo.findOne({
        where: {username},
        select: {
            id: true,
            name: true,
            username: true,
            email: true,
            isActive: true
        },
        relations: {
            profiles: true,
        }
    });
}

export async function getUserByEmail(email: string) {
    return await AppDataSource.getRepository(User).findOne({
        where: {email},
        select: {
            id: true,
            name: true,
            username: true,
            email: true,
            isActive: true
        },
        relations: {
            profiles: true,
        }
    });
}

export async function verifyPassword(userId: number, password: string) {
    const repo = AppDataSource.getRepository(User);
    const user = await repo.findOne({
        where: {id: userId}, select: {
            password: true
        }
    });
    if (!user?.password) return false;
    return bcrypt.compare(password, user.password);
}

export async function generateActivationToken(userId: number) {
    const repo = AppDataSource.getRepository(User);
    const token = generateUniqueToken();
    const expiration = new Date(Date.now() + 3_600_000);
    await repo.update({id: userId}, {
        activationToken: token,
        activationTokenExpiration: expiration
    });
    return token;
}

export async function verifyActivationToken(token: string) {
    const repo = AppDataSource.getRepository(User);
    return await repo.findOne({
        where: {
            activationToken: token,
            activationTokenExpiration: MoreThan(new Date())
        },
        select: {
            id: true,
            name: true,
            username: true,
            email: true,
            isActive: true
        }
    });
}

export async function activateUser(userId: number) {
    const repo = AppDataSource.getRepository(User);
    await repo.update({id: userId}, {
        isActive: true,
        activationToken: null,
        activationTokenExpiration: null
    });
}

export async function generatePasswordResetToken(username: string) {
    const repo = AppDataSource.getRepository(User);
    const token = generateUniqueToken();
    const expiration = new Date(Date.now() + 3_600_000);
    await repo.update({username}, {
        resetToken: token,
        resetTokenExpiration: expiration
    });
    return token;
}

export async function verifyPasswordResetToken(token: string) {
    const repo = AppDataSource.getRepository(User);
    return await repo.findOne({
        where: {
            resetToken: token,
            resetTokenExpiration: MoreThan(new Date())
        },
        select: {
            id: true,
            name: true,
            username: true,
            email: true,
            isActive: true
        }
    });
}

export async function resetPassword(username: string, newPassword: string) {
    const repo = AppDataSource.getRepository(User);
    const hashed = await bcrypt.hash(newPassword, 10);
    await repo.update({username}, {
        password: hashed,
        resetToken: null,
        resetTokenExpiration: null
    });
}

// Guests

export async function createGuest(username: string, email: string | null = null) {
    return await AppDataSource.transaction(async (em) => {
        const repo = em.getRepository(Guest);
        const token = generateUniqueToken();
        const guest = repo.create({username, email, token});
        const result = await repo.save(guest);

        const profileRepo = em.getRepository(Profile);
        const profile = profileRepo.create({name: username, defaultForOwner: true, guest: guest});
        const profileRes = await profileRepo.save(profile);

        if (!result.profile) {
            result.profile = profileRes;
        }

        return result;
    });
}

export async function getGuestByToken(token: string, guestId: string) {
    const repo = AppDataSource.getRepository(Guest);
    return await repo.findOne({
        where: {id: guestId, token: token},
        select: {
            id: true,
            username: true,
            email: true
        },
        relations: {
            profile: true
        }
    });
}

export async function getGuestInternal(guestId: string) {
    const repo = AppDataSource.getRepository(Guest);
    return await repo.findOne({
        where: {id: guestId},
        select: {
            id: true,
            username: true,
            email: true,
            token: true
        },
        relations: {
            profile: true
        }
    });
}

export async function getGuestLinkToken(guestId: string) {
    const guest = await getGuestInternal(guestId);
    return guest?.token || null;
}

export async function getGuestByEmail(email: string) {
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail) return [];

    return await AppDataSource.getRepository(Guest)
        .createQueryBuilder('gl')
        .where('LOWER(TRIM(gl.email)) = :email', {email: normalizedEmail})
        .orderBy('gl.createdAt', 'DESC')
        .getMany();
}

/**
 * ---- SSO / OIDC helpers ----
 */

async function usernameExists(username: string): Promise<boolean> {
    const repo = AppDataSource.getRepository(User);
    const count = await repo.count({where: {username}});
    return count > 0;
}

async function toUniqueUsername(base: string): Promise<string> {
    const sanitized = base
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '')
        .slice(0, 30) || 'user';
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
        where: {oidcIssuer, oidcSub},
        select: {
            id: true,
            name: true,
            username: true,
            email: true,
            isActive: true
        },
        relations: {
            profiles: true,
        }
    });
}

/**
 * Link an existing local user to an OIDC identity.
 * Useful if you want a one-time “Connect SSO” button.
 */
export async function linkUserToOidc(
    userId: number,
    oidcIssuer: string,
    oidcSub: string
) {
    const repo = AppDataSource.getRepository(User);
    await repo.update({id: userId}, {oidcIssuer, oidcSub});
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
    {linkByEmail = true} = {}
) {
    const repo = AppDataSource.getRepository(User);
    const {sub, email, preferred_username, name} = claims;

    // 1) Try exact OIDC match first
    let user = await repo.findOne({
        where: {oidcIssuer, oidcSub: sub},
        relations: {profiles: true},
    });

    // 2) If not found: try link-by-email (optional)
    if (!user && linkByEmail && email) {
        user = await repo.findOne({where: {email}, relations: {profiles: true}});
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
            preferred_username ||
            (email ? email.split('@')[0] : `oidc_${sub.slice(0, 8)}`);
        const uniqueUsername = await toUniqueUsername(baseUsername);

        // Ensure we don't violate unique(email)
        let emailToUse = email || `${sub}@no-email.local`;

        // If linkByEmail is disabled OR the email is already taken, use a synthetic email
        if (email) {
            const emailTaken = await repo.exists({where: {email}});
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
            const newProfile = em.getRepository(Profile).create({
                name: newUsr.name,
                defaultForOwner: true,
                user: newUsr
            });
            const savedProfile = await em.getRepository(Profile).save(newProfile);
            user = await handleUserSaving(newUsr, sub, em.getRepository(User));
            if (!user.profiles || user.profiles.length === 0) {
                user.profiles = [savedProfile];
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
        const message = String(err?.message || '');
        if (
            err?.code === 'ER_DUP_ENTRY' || // MySQL/MariaDB
            err?.code === '23505' ||        // Postgres
            message.includes('UNIQUE')      // SQLite/others
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
    await repo.update({id: userId}, {oidcIssuer: null, oidcSub: null});
}

/**
 * Resolve by id | email | username.
 * Use only behind a permission check to avoid enumeration leaks.
 */
export async function findUserByNameOrEmail(identifier: string | number): Promise<User | null> {
    const repo = AppDataSource.getRepository(User);
    const raw = String(identifier).trim();

    if (/^\d+$/.test(raw)) {
        return await repo.findOne({where: {id: Number(raw)}});
    }

    if (raw.includes('@')) {
        // case-insensitive email; avoid LOWER() on column to keep indexes usable where possible
        return await repo
            .createQueryBuilder('u')
            .where('u.email = :email', {email: raw})
            .orWhere('u.email LIKE :emailCase', {emailCase: raw}) // fallback for case-insensitive collations
            .orWhere('u.username = :username', {username: raw})
            .getOne();
    }

    // username exact, email fallback
    return await repo
        .createQueryBuilder('u')
        .where('u.username = :username', {username: raw})
        .orWhere('u.email = :email', {email: raw})
        .getOne();
}

/**
 * Prefix search for username/email (index-friendly). Validates the query.
 * Returns { id, username, emailMasked } (no raw email by default).
 */
export async function searchUsersSecure(query: string, limit = 10): Promise<Array<UserInfo>> {
    const repo = AppDataSource.getRepository(Profile);
    const q = (query || '').trim();

    if (!SQL_ALLOW_LIST.test(q)) return [];            // too short / invalid chars -> no results
    const lim = coerceLimit(limit, 10, 25);

    const likePrefix = `${q}%`;

    const rows = await repo
        .createQueryBuilder('p')
        .innerJoinAndSelect('p.user', 'u')
        .where('p.name LIKE :pfx', {pfx: likePrefix})
        .orWhere('u.email LIKE :pfx', {pfx: likePrefix})
        .orWhere('u.username LIKE :pfx', {pfx: likePrefix})
        .orderBy('p.name', 'ASC')
        .limit(lim)
        .getMany();

    function doMailMask(p: Profile) {
        let maskedMail = '-';
        if (p.user?.email) {
            maskedMail = maskEmail(p.user.email);
        } else if (p.guest?.email) {
            maskedMail = maskEmail(p.guest.email);
        }
        return maskedMail;
    }

    return rows.map(p => ({
        id: p.id,
        username: p.user?.username ?? p.guest?.username ?? '-',
        email: doMailMask(p),
        name: p.name
    }));
}

/** Optional helpers you might find useful elsewhere */
export async function getUserById(id: number): Promise<User | null> {
    return await AppDataSource.getRepository(User).findOne({where: {id}, relations: {profiles: true}});
}

export async function getProfileById(id: string) {
    return await AppDataSource.getRepository(Profile).findOneBy({id});
}

export async function generateMigrationToken(profileId: string) {
    const repo = AppDataSource.getRepository(Profile);
    const token = generateUniqueToken();
    const expiration = new Date(Date.now() + (3_600_000 * 24));
    await repo.update({id: profileId}, {
        migrationToken: token,
        migrationTokenExpiration: expiration
    });
    return token;
}

export async function verifyMigrationToken(token: string) {
    const repo = AppDataSource.getRepository(Profile);
    return await repo.findOne({
        where: {
            migrationToken: token,
            migrationTokenExpiration: MoreThan(new Date())
        },
        relations: {
            user: true,
            guest: true,
        }
    });
}

export async function addProfileToUser(profileId: string, userId: number, em?: EntityManager) {
    const repo = em ? em.getRepository(Profile) : AppDataSource.getRepository(Profile);
    await repo.update({id: profileId}, {
        user: {id: userId},
    })
}

export async function removeProfileFromOwner(profileId: string, em?: EntityManager) {
    const repo = em ? em.getRepository(Profile) : AppDataSource.getRepository(Profile);
    const profile = await repo.findOne({where: {id: profileId}, relations: {user: true, guest: true}});
    let owner;
    if (profile?.user) {
        owner = profile.user;
        await repo.update({id: profileId}, {user: null, defaultForOwner: false});
    } else if (profile?.guest) {
        owner = profile.guest;
        await repo.update({id: profileId}, {guest: null, defaultForOwner: false});
    }

    return owner;
}

export async function removeMigrationToken(profileId: string, em?: EntityManager) {
    const repo = em ? em.getRepository(Profile) : AppDataSource.getRepository(Profile);
    await repo.update({id: profileId}, {migrationToken: null, migrationTokenExpiration: null});
}

export async function moveProfileToUserTx(profileId: string, userId: number) {
    return await AppDataSource.transaction(async em => {
        const owner = await removeProfileFromOwner(profileId, em);
        await addProfileToUser(profileId, userId, em);
        await removeMigrationToken(profileId, em);
        return owner;
    })
}

export async function deleteUser(userId: number) {
    const repo = AppDataSource.getRepository(User);
    const deleted = await repo.findOneBy({id: userId});
    await repo.delete({id: userId});
    return deleted;
}

export async function deleteGuest(guestId: string) {
    const repo = AppDataSource.getRepository(Guest);
    const deleted = await repo.findOneBy({id: guestId});
    await repo.delete({id: guestId});
    return deleted;
}

export async function getProfilesForUser(userId: number) {
    const repo = AppDataSource.getRepository(Profile);
    return await repo.findBy({user: {id: userId}});
}

export async function updateProfileName(profileId: string, name: string) {
    const repo = AppDataSource.getRepository(Profile);
    await repo.update({id: profileId}, {name: name});
}

export async function updateProfileDefault(profileId: string, isDefault: boolean) {
    await AppDataSource.transaction(async em => {
        const repo = em.getRepository(Profile);
        if (isDefault) {
            // Remove all other defaults for the owner of this profile if a new one is set
            const profile = await repo.findOneByOrFail({id: profileId});
            if (profile.userId) {
                await repo.update({user: {id: profile.userId}}, {defaultForOwner: false});
            }
            if (profile.guestId) {
                await repo.update({guest: {id: profile.guestId}}, {defaultForOwner: false});
            }
        }
        await repo.update({id: profileId}, {defaultForOwner: isDefault});
    })
}

export async function createProfile(userId: number, name: string) {
    const repo = AppDataSource.getRepository(Profile);
    const profile = repo.create({user: {id: userId}, name: name});
    return await repo.save(profile);
}