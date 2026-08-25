import type {
    PlayableCard,
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
    locale: string;
    missingTranslation: "EXCLUDE" | "FALLBACK";
    fallbackLocales?: readonly string[];
};
export const DEFAULT_CARD_TRANSLATION_POLICY: Pick<
    CardLocalizationPolicy,
    "missingTranslation" | "fallbackLocales"
> = Object.freeze({ missingTranslation: "EXCLUDE" });
export interface CardRepository {
    getById(id: CardId, localization: CardLocalizationPolicy): Promise<PlayableCard | null>;
    listActive(localization: CardLocalizationPolicy): Promise<readonly PlayableCard[]>;
    isLocaleActive(locale: string): Promise<boolean>;
    defaultLocale(): Promise<string>;
    findEligibleCandidates(
        request: CardCandidateRequest,
        localization: CardLocalizationPolicy,
    ): Promise<readonly PlayableCard[]>;
}
export interface SessionRepository {
    get(id: GameSessionId): Promise<GameSessionSnapshot | null>;
    save(snapshot: GameSessionSnapshot): Promise<void>;
}
export interface CouchSessionRepository {
    load(id: string): Promise<GameSessionRuntimeState | null>;
    ownerDataSpaceId(id: string): Promise<DataSpaceId | null>;
    groupHistory(dataSpaceId: DataSpaceId, groupId: string): Promise<ReadonlySet<CardId>>;
    save(
        snapshot: GameSessionRuntimeState,
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
    get(id: DataSpaceId): Promise<unknown | null>;
}
export interface AccountRepository {
    getById(id: number): Promise<unknown | null>;
}
