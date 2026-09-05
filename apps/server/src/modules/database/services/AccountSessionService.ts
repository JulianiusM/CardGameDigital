import { MoreThan } from "typeorm";
import { AppDataSource } from "../dataSource";
import { AccountSession } from "../../../../../../packages/persistence/entities/session/AccountSession";

export async function bindAccountSession(sessionId: string, userId: number): Promise<void> {
    const result = await AppDataSource.getRepository(AccountSession).update(
        { id: sessionId },
        { accountUserId: userId },
    );
    if (result.affected !== 1) throw new Error("Persisted account session was not found");
}

export async function listAccountSessions(userId: number, currentId: string) {
    const rows = await AppDataSource.getRepository(AccountSession).find({
        where: { accountUserId: userId, expiredAt: MoreThan(Date.now()) },
        order: { expiredAt: "DESC" },
    });
    return rows.map((row) => ({
        id: row.id,
        current: row.id === currentId,
        expiresAt: Number(row.expiredAt),
    }));
}

export async function revokeAccountSession(userId: number, sessionId: string): Promise<boolean> {
    const result = await AppDataSource.getRepository(AccountSession).softDelete({
        id: sessionId,
        accountUserId: userId,
    });
    return result.affected === 1;
}

export async function revokeAllAccountSessions(userId: number): Promise<void> {
    await AppDataSource.getRepository(AccountSession).softDelete({ accountUserId: userId });
}
