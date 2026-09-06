import { AsyncLocalStorage } from "node:async_hooks";
import type { DataSource, EntityManager, QueryRunner } from "typeorm";
import { BetterSqlite3QueryRunner } from "typeorm/driver/better-sqlite3/BetterSqlite3QueryRunner.js";
import type { BetterSqlite3Driver } from "typeorm/driver/better-sqlite3/BetterSqlite3Driver.js";

type Ownership = { source: DataSource; runner?: QueryRunner };
const ownership = new AsyncLocalStorage<Ownership>();
const queues = new WeakMap<DataSource, Promise<void>>();
const installed = new WeakSet<DataSource>();

async function acquire(source: DataSource): Promise<() => void> {
    const previous = queues.get(source) ?? Promise.resolve();
    let release!: () => void;
    const occupied = new Promise<void>((resolve) => {
        release = resolve;
    });
    const tail = previous.then(() => occupied);
    queues.set(source, tail);
    await previous;
    return () => {
        release();
        if (queues.get(source) === tail) queues.delete(source);
    };
}

/** One SQLite connection requires ownership for reads as well as transactions.
 * Install once before application use. Each independent runner gets its own state;
 * all queries wait for the connection lease, including direct Repository operations. */
export function coordinateSqliteConnection(source: DataSource): void {
    if (source.options.type !== "better-sqlite3" || installed.has(source)) return;
    installed.add(source);
    const driver = source.driver as BetterSqlite3Driver;
    driver.createQueryRunner = () => {
        const context = ownership.getStore();
        if (context?.source === source && context.runner?.isTransactionActive)
            return context.runner as BetterSqlite3QueryRunner;
        const runner = new BetterSqlite3QueryRunner(driver);
        let release: (() => void) | undefined;
        const query = runner.query.bind(runner);
        runner.query = (...args: Parameters<typeof query>) => {
            if (release) return query(...args);
            return serializeSqliteConnection(source, () => query(...args));
        };
        const start = runner.startTransaction.bind(runner);
        runner.startTransaction = async (...args: Parameters<typeof start>) => {
            const current = ownership.getStore();
            if (!release && current?.source !== source) release = await acquire(source);
            try {
                await start(...args);
                if (current?.source === source) current.runner = runner;
            } catch (error) {
                if (!runner.isTransactionActive) {
                    release?.();
                    release = undefined;
                }
                throw error;
            }
        };
        const finish = (operation: () => Promise<void>) => async () => {
            try {
                await operation();
            } finally {
                if (!runner.isTransactionActive) {
                    release?.();
                    release = undefined;
                    const current = ownership.getStore();
                    if (current && current.runner === runner) current.runner = undefined;
                }
            }
        };
        runner.commitTransaction = finish(runner.commitTransaction.bind(runner));
        runner.rollbackTransaction = finish(runner.rollbackTransaction.bind(runner));
        return runner;
    };
    const transaction = source.manager.transaction.bind(source.manager);
    source.manager.transaction = ((...args: Parameters<typeof transaction>) =>
        serializeSqliteConnection(source, () =>
            transaction(...args),
        )) as typeof source.manager.transaction;
}

export function persistenceTransaction<T>(
    source: DataSource,
    action: (manager: EntityManager) => Promise<T>,
): Promise<T> {
    coordinateSqliteConnection(source);
    if (source.options.type === "better-sqlite3") return source.transaction(action);
    return source.transaction("REPEATABLE READ", action);
}

export async function serializeSqliteConnection<T>(
    source: DataSource,
    action: () => Promise<T>,
): Promise<T> {
    if (source.options.type !== "better-sqlite3") return action();
    coordinateSqliteConnection(source);
    if (ownership.getStore()?.source === source) return action();
    const release = await acquire(source);
    try {
        return await ownership.run({ source }, action);
    } finally {
        release();
    }
}
