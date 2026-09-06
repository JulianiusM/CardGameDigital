import { MESSAGE_KEYS } from "../localization/keys";
import { In, type Repository, type EntityManager } from "typeorm";
import { setImmediate } from "node:timers/promises";
import type {
    CardCandidate,
    CardHistoryContext,
    CardId,
    GroupHistoryWindow,
    PlayableCard,
} from "../game-core";
import type { CardLocalizationPolicy, CardRepository } from "../application/repositories";
import { CardEntity } from "./entities/card/CardEntity";
import { CardCatalogVersionEntity } from "./entities/card/CardCatalogVersionEntity";
import { LocaleEntity } from "./entities/card/LocaleEntity";
import { CardLocalizationEntity } from "./entities/card/CardLocalizationEntity";
import { CardOperationalFlagEntity } from "./entities/card/CardOperationalFlagEntity";
import { GroupEntity } from "./entities/game/GroupEntity";
import { cardEntityToDomain, cardMetadataToDomain } from "./cardMapper";
import { persistenceTransaction } from "./transaction";
import { DEFAULT_PERSISTENCE_WORK_LIMITS, persistenceWorkLimits } from "./persistenceWorkLimits";

export const CARD_SCAN_PAGE_SIZE = 256;
export const MAXIMUM_CONCURRENT_CARD_SCANS = DEFAULT_PERSISTENCE_WORK_LIMITS.cardConcurrentScans;
let activeScans = 0;

export class TypeOrmCardRepository implements CardRepository {
    constructor(private readonly cards: Repository<CardEntity>) {}

    async catalogProvenance() {
        const version = await this.cards.manager.getRepository(CardCatalogVersionEntity).findOne({
            where: {},
            order: { appliedAt: "DESC", sequence: "DESC" },
        });
        if (!version) throw new Error("No Card catalog version is installed");
        const { catalogId, sequence, catalogVersion, contract, artifactDigest } = version;
        return { catalogId, sequence, catalogVersion, contract, artifactDigest };
    }

    async groupHistoryWindow(
        dataSpaceId: string,
        groupId: string,
        before: number,
    ): Promise<GroupHistoryWindow> {
        const group = await this.cards.manager
            .getRepository(GroupEntity)
            .findOneBy({ id: groupId, dataSpaceId });
        if (!group)
            throw Object.assign(new Error("Group is outside the active DataSpace"), {
                code: "NOT_AUTHORIZED",
            });
        return { groupId, after: group.historyResetAt?.getTime() ?? null, before };
    }

    async *scan(
        localization: CardLocalizationPolicy,
        history?: CardHistoryContext | null,
    ): AsyncIterable<CardCandidate> {
        if (activeScans >= persistenceWorkLimits().cardConcurrentScans)
            throw Object.assign(new Error(MESSAGE_KEYS.GAME_SESSION_CAPACITY_EXCEEDED), {
                code: "SESSION_CAPACITY_EXCEEDED",
                status: 429,
            });
        activeScans++;
        try {
            const generation = await this.catalogProvenance();
            const locales = this.locales(localization);
            let after = "";
            while (true) {
                const page = await persistenceTransaction(
                    this.cards.manager.connection,
                    async (manager) => {
                        const query = manager
                            .getRepository(CardEntity)
                            .createQueryBuilder("card")
                            .where("card.id > :after", { after })
                            .andWhere(
                                "EXISTS (SELECT 1 FROM card_localizations rendering WHERE rendering.card_id = card.id AND rendering.locale IN (:...locales) AND rendering.active = :active)",
                                { locales, active: true },
                            )
                            .orderBy("card.id", "ASC")
                            .take(CARD_SCAN_PAGE_SIZE);
                        if (!localization.includeRetired) query.andWhere("card.active = :active");
                        if (history) {
                            const table =
                                history.topology === "ROOM"
                                    ? "card_appearances"
                                    : "couch_card_appearances";
                            query
                                .addSelect(
                                    `(SELECT appearance.sequence FROM ${table} appearance WHERE appearance.session_id = :sessionId AND appearance.card_id = card.id ORDER BY appearance.sequence DESC LIMIT 1)`,
                                    "last_sequence",
                                )
                                .setParameter("sessionId", history.sessionId);
                            if (history.group) {
                                const since =
                                    history.group.after === null
                                        ? ""
                                        : " AND appearance.shown_at > :since";
                                const seen = ["card_appearances", "couch_card_appearances"].map(
                                    (tableName) =>
                                        `EXISTS (SELECT 1 FROM ${tableName} appearance WHERE appearance.group_id = :groupId AND appearance.card_id = card.id AND appearance.session_id <> :sessionId AND appearance.shown_at <= :before${since})`,
                                );
                                query
                                    .addSelect(`(${seen.join(" OR ")})`, "group_seen")
                                    .setParameters({
                                        groupId: history.group.groupId,
                                        before: new Date(history.group.before),
                                        since:
                                            history.group.after === null
                                                ? null
                                                : new Date(history.group.after),
                                    });
                            }
                        }
                        const { entities, raw } = await query.getRawAndEntities();
                        await this.attachFlags(manager, entities);
                        return entities.map((entity, index): CardCandidate => ({
                            ...cardMetadataToDomain(entity),
                            ...(history
                                ? {
                                      lastShownSequence:
                                          raw[index].last_sequence === null
                                              ? null
                                              : Number(raw[index].last_sequence),
                                      seenInGroup: Boolean(Number(raw[index].group_seen ?? 0)),
                                  }
                                : {}),
                        }));
                    },
                );
                for (const card of page) yield card;
                if (page.length < CARD_SCAN_PAGE_SIZE) break;
                after = page.at(-1)!.id;
                await setImmediate();
            }
            if ((await this.catalogProvenance()).artifactDigest !== generation.artifactDigest)
                throw Object.assign(new Error("Catalog changed during selection"), {
                    code: "STALE_SESSION_REVISION",
                });
        } finally {
            activeScans--;
        }
    }

    async getById(id: CardId, localization: CardLocalizationPolicy): Promise<PlayableCard | null> {
        return persistenceTransaction(this.cards.manager.connection, async (manager) => {
            const entity = await manager.getRepository(CardEntity).findOneBy({ id, active: true });
            if (!entity) return null;
            const locales = this.locales(localization);
            const query = manager
                .getRepository(CardLocalizationEntity)
                .createQueryBuilder("rendering")
                .where(
                    "rendering.cardId = :id AND rendering.active = :active AND rendering.locale IN (:...locales)",
                    { id, active: true, locales },
                );
            const priority = locales
                .map((locale, index) => {
                    query.setParameter(`locale${index}`, locale);
                    return `WHEN rendering.locale = :locale${index} THEN ${index}`;
                })
                .join(" ");
            const rendering = await query
                .orderBy(`CASE ${priority} ELSE ${locales.length} END`, "ASC")
                .take(1)
                .getOne();
            if (!rendering) return null;
            await this.attachFlags(manager, [entity]);
            return cardEntityToDomain(entity, rendering);
        });
    }

    private locales(localization: CardLocalizationPolicy): string[] {
        const locales = [localization.locale];
        if (localization.missingTranslation === "FALLBACK")
            locales.push(...(localization.fallbackLocales ?? []));
        return [...new Set(locales)];
    }

    private async attachFlags(manager: EntityManager, cards: CardEntity[]) {
        if (!cards.length) return;
        const byId = new Map(
            cards.map((card) => {
                card.flags = [];
                return [card.id, card];
            }),
        );
        const flags = await manager
            .getRepository(CardOperationalFlagEntity)
            .findBy({ cardId: In(cards.map(({ id }) => id)) });
        for (const flag of flags) byId.get(flag.cardId)!.flags.push(flag);
    }

    isLocaleActive(locale: string): Promise<boolean> {
        return this.cards.manager
            .getRepository(LocaleEntity)
            .existsBy({ id: locale, active: true });
    }

    async defaultLocale(): Promise<string> {
        const locale = await this.cards.manager
            .getRepository(LocaleEntity)
            .findOneBy({ active: true, isDefault: true });
        if (!locale) throw new Error("No active default Card locale is installed");
        return locale.id;
    }
}
