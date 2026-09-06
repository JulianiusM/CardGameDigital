import type {
    PlayableCard,
    CardCandidate,
    CardHistoryContext,
    GroupHistoryWindow,
    CatalogProvenance,
    CardId,
    CardType,
    DareTypeId,
    DataSpaceId,
    GameSessionId,
    GameSessionSnapshot,
    GameSessionRuntimeState,
    QuestionCategoryId,
    RoomId,
} from "../game-core";

export type CardCandidateRequest = {
    cardType: CardType;
    questionCategoryIds?: readonly QuestionCategoryId[];
    dareTypeIds?: readonly DareTypeId[];
    yesNoAnswerPossible?: boolean;
};
export type CardLocalizationPolicy = {
    includeRetired?: boolean;
    locale: string;
    missingTranslation: "EXCLUDE" | "FALLBACK";
    fallbackLocales?: readonly string[];
};
export const DEFAULT_CARD_TRANSLATION_POLICY: Pick<
    CardLocalizationPolicy,
    "missingTranslation" | "fallbackLocales"
> = Object.freeze({ missingTranslation: "EXCLUDE" });
export interface CardRepository {
    catalogProvenance(): Promise<CatalogProvenance>;
    scan(
        localization: CardLocalizationPolicy,
        history?: CardHistoryContext | null,
    ): AsyncIterable<CardCandidate>;
    groupHistoryWindow(
        dataSpaceId: string,
        groupId: string,
        before: number,
    ): Promise<GroupHistoryWindow>;
    getById(id: CardId, localization: CardLocalizationPolicy): Promise<PlayableCard | null>;
    isLocaleActive(locale: string): Promise<boolean>;
    defaultLocale(): Promise<string>;
}
export interface SessionRepository {
    get(id: GameSessionId): Promise<GameSessionSnapshot | null>;
    save(snapshot: GameSessionSnapshot): Promise<void>;
}
export interface CouchSessionRepository {
    /** Small authoritative read; avoid hydrating immutable inputs for an unchanged cache entry. */
    revision(id: string): Promise<number | null>;
    load(id: string): Promise<GameSessionRuntimeState | null>;
    ownerDataSpaceId(id: string): Promise<DataSpaceId | null>;
    save(
        snapshot: GameSessionRuntimeState,
        expectedRevision: number | null,
        ownership?: { dataSpaceId: DataSpaceId; groupId: string | null },
    ): Promise<void>;
}
export interface RoomRepository {
    exists(id: RoomId): Promise<boolean>;
}
export interface GroupRepository {
    listByDataSpace(dataSpaceId: DataSpaceId): Promise<readonly unknown[]>;
}
export interface GameProfileRepository {
    listAvailable(dataSpaceId: DataSpaceId): Promise<readonly unknown[]>;
}
export interface CardHistoryRepository {
    cardIdsForSession(id: GameSessionId): Promise<readonly CardId[]>;
}
export interface DataSpaceRepository {
    get(id: DataSpaceId): Promise<unknown>;
}
export interface AccountRepository {
    getById(id: number): Promise<unknown>;
}
