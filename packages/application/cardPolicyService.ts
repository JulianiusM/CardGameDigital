import {
    CARD_TYPES,
    GAME_MODES,
    cardPolicyScopeFromJson,
    eligibleCards,
    compactCompiledCardPolicyEntry,
    matchesCardPolicyPredicate,
    maximumGlobalIntensityScore,
    resolveCardPolicy,
    type CardType,
    type GameMode,
    type GameProfile,
    type PlayableCard,
    type SessionCardPolicyInput,
} from "../game-core";
import {
    toDomainPolicyScope,
    type CardPolicyOwner,
    type CardPolicyRepository,
    type ManagedCardSearch,
    type StoredCardPolicyScope,
} from "./cardPolicyRepository";

export class CardPolicyService {
    constructor(private readonly repository: CardPolicyRepository) {}

    load(owner: CardPolicyOwner): Promise<StoredCardPolicyScope> {
        return this.repository.load(owner);
    }

    async hierarchy(dataSpaceId: string, groupId: string | null) {
        const dataSpace = await this.repository.load({
            dataSpaceId,
            groupId: null,
            ownerKey: `DATASPACE:${dataSpaceId}`,
            name: "DataSpace",
        });
        const group = groupId
            ? await this.repository.load({
                  dataSpaceId,
                  groupId,
                  ownerKey: `GROUP:${groupId}`,
                  name: "Group",
              })
            : null;
        return { dataSpace, group };
    }

    async compileSessionCards(input: {
        cards: readonly PlayableCard[];
        dataSpaceId?: string;
        groupId?: string | null;
        profile: GameProfile;
        sessionPolicy: SessionCardPolicyInput;
    }) {
        const hierarchy = input.dataSpaceId
            ? await this.hierarchy(input.dataSpaceId, input.groupId ?? null)
            : null;
        const sessionScope = cardPolicyScopeFromJson({
            name: "Session",
            ...input.sessionPolicy,
        });
        const dataSpace = hierarchy ? toDomainPolicyScope(hierarchy.dataSpace) : undefined;
        const group = hierarchy?.group ? toDomainPolicyScope(hierarchy.group) : undefined;
        const cards = input.cards.map((card) =>
            resolveCardPolicy({ card, dataSpace, group, session: sessionScope }),
        );
        const catalog = await this.repository.catalogProvenance();
        const policyRevisions = {
            dataSpace: hierarchy ? this.maximumRevision(hierarchy.dataSpace) : null,
            group: hierarchy?.group ? this.maximumRevision(hierarchy.group) : null,
        };
        return {
            cards,
            catalog,
            policyRevisions,
            snapshot: {
                catalog,
                policyRevisions,
                cards: cards.map(compactCompiledCardPolicyEntry),
            },
        };
    }

    /**
     * Count the server-authoritative Card pool for a pending game. Private participant
     * boundaries are intentionally unavailable here and can only narrow the pool later.
     */
    async eligibilityPreview(input: {
        cards: readonly PlayableCard[];
        dataSpaceId?: string;
        groupId?: string | null;
        profile: GameProfile;
        sessionPolicy: SessionCardPolicyInput;
        mode: GameMode;
        playerCount: number;
        groupHistoryCardIds: ReadonlySet<PlayableCard["id"]>;
    }) {
        const compiled = await this.compileSessionCards(input);
        const atMaximum = this.countEligibleCards({
            ...input,
            cards: compiled.cards,
            maximumIntensityScore: maximumGlobalIntensityScore(input.profile.maximumIntensity),
        });
        const atStart = this.countEligibleCards({
            ...input,
            cards: compiled.cards,
            maximumIntensityScore: maximumGlobalIntensityScore(input.profile.startingIntensity),
        });
        return {
            total: atMaximum.total,
            availableAtStart: atStart.total,
            byType: atMaximum.byType,
            atStartByType: atStart.byType,
            playerCount: input.playerCount,
        };
    }

    async search(owner: CardPolicyOwner, input: ManagedCardSearch) {
        const [selected, hierarchy, page] = await Promise.all([
            this.repository.load(owner),
            this.hierarchy(owner.dataSpaceId, owner.groupId),
            this.repository.searchCards(input),
        ]);
        const dataSpace = toDomainPolicyScope(hierarchy.dataSpace);
        const group = hierarchy.group ? toDomainPolicyScope(hierarchy.group) : undefined;
        const localExact = new Map(selected.exactCards.map((entry) => [entry.cardId, entry]));
        return {
            ...page,
            cards: page.cards.map((card) => {
                const effective = resolveCardPolicy({ card, dataSpace, group });
                return {
                    id: card.id,
                    text: card.cardText,
                    locale: card.locale,
                    lifecycle: card.lifecycle,
                    cardType: card.cardType,
                    yesNoAnswerPossible: card.yesNoAnswerPossible,
                    questionCategoryId: card.questionCategoryId,
                    dareTypeId: card.dareTypeId,
                    dareAffinityCategoryId: card.dareAffinityCategoryId,
                    taxonomyLabel: card.taxonomyLabel,
                    operationalFlags: card.operationalFlags,
                    producer: this.properties(card, true),
                    effective: this.properties(effective, effective.policyAvailable),
                    provenance: effective.provenance,
                    localDirectives: localExact.get(card.id)?.directives ?? {},
                    localRevision: localExact.get(card.id)?.revision ?? 0,
                };
            }),
        };
    }

    async searchSession(input: {
        owner?: CardPolicyOwner;
        search: ManagedCardSearch;
        sessionPolicy: SessionCardPolicyInput;
    }) {
        const [hierarchy, page] = await Promise.all([
            input.owner
                ? this.hierarchy(input.owner.dataSpaceId, input.owner.groupId)
                : Promise.resolve(null),
            this.repository.searchCards(input.search),
        ]);
        const dataSpace = hierarchy ? toDomainPolicyScope(hierarchy.dataSpace) : undefined;
        const group = hierarchy?.group ? toDomainPolicyScope(hierarchy.group) : undefined;
        const session = cardPolicyScopeFromJson({ name: "Session", ...input.sessionPolicy });
        const localExact = new Map(
            input.sessionPolicy.exactCards.map((entry) => [entry.cardId, entry.directives]),
        );
        return {
            ...page,
            cards: page.cards.map((card) => {
                const effective = resolveCardPolicy({
                    card,
                    dataSpace,
                    group,
                    session,
                });
                return {
                    id: card.id,
                    text: card.cardText,
                    locale: card.locale,
                    lifecycle: card.lifecycle,
                    cardType: card.cardType,
                    yesNoAnswerPossible: card.yesNoAnswerPossible,
                    questionCategoryId: card.questionCategoryId,
                    dareTypeId: card.dareTypeId,
                    dareAffinityCategoryId: card.dareAffinityCategoryId,
                    taxonomyLabel: card.taxonomyLabel,
                    operationalFlags: card.operationalFlags,
                    producer: this.properties(card, true),
                    effective: this.properties(effective, effective.policyAvailable),
                    provenance: effective.provenance,
                    localDirectives: localExact.get(card.id) ?? {},
                    localRevision: localExact.has(card.id) ? 1 : 0,
                };
            }),
        };
    }

    async preview(
        owner: CardPolicyOwner,
        predicate: Parameters<typeof matchesCardPolicyPredicate>[1],
        locale: string,
    ) {
        const cards = (await this.repository.listPolicyCards(locale)).filter((card) =>
            matchesCardPolicyPredicate(card, predicate),
        );
        return {
            matchCount: cards.length,
            cards: cards.slice(0, 20).map(({ id, cardText, cardType, taxonomyLabel }) => ({
                id,
                text: cardText,
                cardType,
                taxonomyLabel,
            })),
            scope: owner.groupId ? "GROUP" : "DATASPACE",
        };
    }

    async previewSession(
        predicate: Parameters<typeof matchesCardPolicyPredicate>[1],
        locale: string,
    ) {
        const cards = (await this.repository.listPolicyCards(locale)).filter((card) =>
            matchesCardPolicyPredicate(card, predicate),
        );
        return {
            matchCount: cards.length,
            cards: cards.slice(0, 20).map(({ id, cardText, cardType, taxonomyLabel }) => ({
                id,
                text: cardText,
                cardType,
                taxonomyLabel,
            })),
            scope: "SESSION" as const,
        };
    }

    async bulkApply(
        owner: CardPolicyOwner,
        search: Omit<ManagedCardSearch, "cursor" | "limit">,
        directives: Parameters<CardPolicyRepository["putExactCards"]>[2],
        confirmedCount: number,
    ) {
        const cardIds = await this.repository.listMatchingCardIds(search);
        if (cardIds.length !== confirmedCount) {
            throw Object.assign(new Error("The matching Card result changed before confirmation"), {
                code: "POLICY_RESULT_SET_CHANGED",
                status: 409,
            });
        }
        return { appliedCount: await this.repository.putExactCards(owner, cardIds, directives) };
    }

    private properties(card: PlayableCard, available: boolean) {
        return {
            availability: available ? "INCLUDE" : "EXCLUDE",
            alwaysEligible: card.alwaysEligible,
            repeatableInSession: card.repeatableInSession,
            repeatCooldown: card.repeatCooldown,
            intensity: card.intensity,
            weight: card.weight,
            socialSensitivity: card.socialSensitivity,
            playerCount: {
                minimum: card.minimumPlayerCount,
                maximum: card.maximumPlayerCount,
            },
        };
    }

    private countEligibleCards(input: {
        cards: readonly PlayableCard[];
        profile: GameProfile;
        mode: GameMode;
        playerCount: number;
        groupHistoryCardIds: ReadonlySet<PlayableCard["id"]>;
        maximumIntensityScore: number;
    }) {
        const byType: Record<CardType, number> = {
            [CARD_TYPES.QUESTION]: 0,
            [CARD_TYPES.DARE]: 0,
            [CARD_TYPES.CONVERSATION_META]: 0,
        };
        for (const request of this.cardTypeRequests(input.mode)) {
            byType[request.cardType] = eligibleCards(input.cards, {
                cardType: request.cardType,
                requireYesNoAnswer: request.requireYesNoAnswer,
                profile: input.profile,
                boundaries: [],
                maximumIntensityScore: input.maximumIntensityScore,
                sessionHistory: [],
                groupHistoryCardIds: input.groupHistoryCardIds,
                playerCount: input.playerCount,
            }).length;
        }
        return {
            total: Object.values(byType).reduce((total, count) => total + count, 0),
            byType,
        };
    }

    private cardTypeRequests(
        mode: GameMode,
    ): readonly { cardType: CardType; requireYesNoAnswer: boolean }[] {
        if (mode === GAME_MODES.NEVER_HAVE_I_EVER) {
            return [{ cardType: CARD_TYPES.QUESTION, requireYesNoAnswer: true }];
        }
        if (mode === GAME_MODES.LETS_TALK) {
            return [
                { cardType: CARD_TYPES.QUESTION, requireYesNoAnswer: false },
                { cardType: CARD_TYPES.CONVERSATION_META, requireYesNoAnswer: false },
            ];
        }
        return [
            { cardType: CARD_TYPES.QUESTION, requireYesNoAnswer: false },
            { cardType: CARD_TYPES.DARE, requireYesNoAnswer: false },
        ];
    }

    private maximumRevision(scope: StoredCardPolicyScope): number {
        return Math.max(
            scope.scopeDefault.revision,
            ...scope.rules.map(({ revision }) => revision),
            ...scope.exactCards.map(({ revision }) => revision),
        );
    }
}
