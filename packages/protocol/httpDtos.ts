import type { SocialSensitivity } from "../game-core";
import type { EffectiveGameSettings, RoomGameSettings } from "./common";
import type { NeverHaveIEverVotingView } from "./snapshots";

/** Browser-safe HTTP DTOs. Keep transport shapes here, not in an individual client. */
export type LanguagePreferences = {
    useSystemLanguage: boolean;
    interfaceLocale: string | null;
    cardLocale: string | null;
    fallbackLocales: string[];
};

export type DataSpaceSummary = { id: string; name: string; defaultForOwner: boolean };

export type AccountSnapshot = {
    user: { id: number; username: string; name: string; email: string };
    activeDataSpaceId: string | null;
    dataSpaces: DataSpaceSummary[];
    languagePreferences: LanguagePreferences | null;
};

export type AccountConfiguration = {
    localLoginEnabled: boolean;
    oidcEnabled: boolean;
    oidcName: string;
    imprintUrl: string;
    privacyPolicyUrl: string;
};

export type AccountStatus = AccountConfiguration & {
    authenticationAvailable: boolean;
    deploymentMode: "local" | "public";
    authenticated: boolean;
    account: AccountSnapshot | null;
};

export type AccountSessionSummary = {
    id: string;
    current: boolean;
    expiresAt: number;
};

export type AccountSessionsResponse = { sessions: AccountSessionSummary[] };
export type AccountBootstrapStatus = Pick<AccountStatus, "authenticated" | "account">;

export type CardLanguageSettings = {
    cardLocale: string;
    cardFallbackEnabled: boolean;
    cardFallbackLocales: string[];
};

export type GameProfileSummary = {
    id: string;
    name: string;
    description: string;
    editorialStatus: "PUBLISHED";
    requiresAdultConfirmation: boolean;
    startingIntensity: number;
    maximumIntensity: number;
    maximumSocialSensitivity: SocialSensitivity;
    intensityProgressionUnit: "ROUNDS" | "CARDS";
    intensityProgressionInterval: number;
    intensityProgressionIncrement: number;
    enabledQuestionCategoryIds: string[];
    enabledDareTypeIds: string[];
    blockedOperationalFlags: string[];
    randomQuestionRatio: number;
    maximumTypeStreak: number;
    letsTalkMetaInterval: number;
    immutable: boolean;
};

export type GroupSummary = {
    id: string;
    name: string;
    members: string[];
    updatedAt: string;
    preferredProfileId: string | null;
    customConfiguration: EffectiveGameSettings | null;
    cardLanguageSettings: CardLanguageSettings | null;
    historyResetAt?: string | null;
};

export type GameSettings = {
    preferredProfileId: string;
    startingIntensity: number;
    maximumIntensity: number;
    maximumSocialSensitivity: SocialSensitivity;
    intensityProgressionUnit: "ROUNDS" | "CARDS";
    intensityProgressionInterval: number;
    intensityProgressionIncrement: number;
    randomQuestionRatio: number;
    letsTalkMetaInterval: number;
    defaultGroupId: string | null;
    customConfiguration: EffectiveGameSettings;
    cardLanguageSettings: CardLanguageSettings | null;
};

export type CardLocaleSummary = { id: string; nativeName: string; coverage: number };
export type CardTaxonomyEntry = { id: string; label: string; description: string | null };
export type CardTaxonomyCatalog = {
    locale: string;
    questionCategories: CardTaxonomyEntry[];
    dareTypes: CardTaxonomyEntry[];
};

export type PublicGameSettings = Pick<
    RoomGameSettings,
    | "mode"
    | "profileId"
    | "cardLocale"
    | "cardFallbackEnabled"
    | "cardFallbackLocales"
    | "neverHaveIEverRevealMode"
    | "cardPolicy"
    | "configuration"
>;

export type CouchSessionSnapshot = {
    id: string;
    startedAt: number;
    mode: string;
    revision: number;
    state: string;
    roundNumber: number;
    activePlayer: { id: string; name: string } | null;
    players: { id: string; name: string }[];
    currentCard: {
        id: string;
        cardText: string;
        cardType: string;
        cardIntensity: number;
        intensity: number;
        questionCategoryId: string | null;
        dareTypeId: string | null;
    } | null;
    cardsShown: number;
    remainingCardCount: number;
    /** Zero totals until reveal; never contains per-player answers. */
    voteResult: { yes: number; no: number; total: number };
    votedPlayerIds: string[];
    neverHaveIEverVoting: NeverHaveIEverVotingView | null;
    persistence: "EPHEMERAL" | "DATASPACE";
    settings: PublicGameSettings;
};
