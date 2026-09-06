import { MESSAGE_KEYS } from "../localization/keys";
import {
    sessionPolicyResolver,
    prepareEligibility,
    eligibilityReasons,
    type CardStream,
    type SessionPolicySnapshot,
    type Card,
} from "../game-core";
import {
    CARD_TYPES,
    GAME_MODES,
    cardPolicyScopeFromJson,
    eligibleCards,
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
import { requiresAdultConfirmation } from "./adultConfirmation";

export class CardPolicyService {
    constructor(private readonly repository: CardPolicyRepository) {}

    load(owner: CardPolicyOwner): Promise<StoredCardPolicyScope> {
        return this.repository.load(owner);
    }

    async hierarchy(dataSpaceId: string, groupId: string | null) {
        const owners: CardPolicyOwner[] = [
            { dataSpaceId, groupId: null, ownerKey: `DATASPACE:${dataSpaceId}`, name: "DataSpace" },
        ];
        if (groupId)
            owners.push({ dataSpaceId, groupId, ownerKey: `GROUP:${groupId}`, name: "Group" });
        const [dataSpace, group = null] = await this.repository.loadScopes(owners);
        return { dataSpace, group };
    }

    async captureSessionPolicy(input: {
        dataSpaceId?: string;
        groupId?: string | null;
    }): Promise<SessionPolicySnapshot> {
        const hierarchy = input.dataSpaceId
            ? await this.hierarchy(input.dataSpaceId, input.groupId ?? null)
            : null;
        const capture = (
            scope: StoredCardPolicyScope | null | undefined,
        ): SessionCardPolicyInput | null => {
            if (!scope) return null;
            return {
                scopeDefault: scope.scopeDefault.directives,
                conditionalRules: scope.rules
                    .filter((rule) => rule.enabled)
                    .map(({ id, name, order, enabled, predicate, directives }) => ({
                        id,
                        name,
                        order,
                        enabled,
                        predicate,
                        directives,
                    })),
                exactCards: scope.exactCards.map(({ cardId, directives }) => ({
                    cardId,
                    directives,
                })),
            };
        };
        return { dataSpace: capture(hierarchy?.dataSpace), group: capture(hierarchy?.group) };
    }

    async eligibilityPreview(input: {
        cards: CardStream;
        dataSpaceId?: string;
        groupId?: string | null;
        profile: GameProfile;
        sessionPolicy: SessionCardPolicyInput;
        mode: GameMode;
        playerCount: number;
        groupHistoryCardIds?: ReadonlySet<Card["id"]>;
    }) {
        const resolve = sessionPolicyResolver(
            await this.captureSessionPolicy(input),
            input.sessionPolicy,
        );
        const byType = { QUESTION: 0, DARE: 0, CONVERSATION_META: 0 };
        const atStartByType = { ...byType };
        const requests = new Map<CardType, ReturnType<typeof prepareEligibility>>();
        for (const type of Object.values(CARD_TYPES))
            requests.set(
                type,
                prepareEligibility({
                    cardType: type,
                    requireYesNoAnswer: input.mode === GAME_MODES.NEVER_HAVE_I_EVER,
                    profile: input.profile,
                    boundaries: [],
                    maximumIntensityScore: maximumGlobalIntensityScore(
                        input.profile.maximumIntensity,
                    ),
                    sessionHistory: [],
                    groupHistoryCardIds: input.groupHistoryCardIds ?? new Set(),
                    playerCount: input.playerCount,
                }),
            );
        let adultConfirmationRequired = false;
        for await (const original of input.cards) {
            const card = resolve(original);
            adultConfirmationRequired ||= requiresAdultConfirmation({
                ...input,
                cards: [original],
                effectiveCards: [card],
            });
            if (
                input.mode === GAME_MODES.NEVER_HAVE_I_EVER &&
                card.cardType !== CARD_TYPES.QUESTION
            )
                continue;
            if (input.mode === GAME_MODES.LETS_TALK && card.cardType === CARD_TYPES.DARE) continue;
            if (
                (input.mode === GAME_MODES.CLASSIC || input.mode === GAME_MODES.RANDOM) &&
                card.cardType === CARD_TYPES.CONVERSATION_META
            )
                continue;
            const request = { ...requests.get(card.cardType)! };
            if (original.seenInGroup !== undefined)
                request.groupHistoryCardIds = original.seenInGroup ? new Set([card.id]) : new Set();
            if (eligibilityReasons(card, request).length === 0) byType[card.cardType]++;
            request.maximumIntensityScore = maximumGlobalIntensityScore(
                input.profile.startingIntensity,
            );
            if (eligibilityReasons(card, request).length === 0) atStartByType[card.cardType]++;
        }
        return {
            total: Object.values(byType).reduce((sum, count) => sum + count, 0),
            availableAtStart: Object.values(atStartByType).reduce((sum, count) => sum + count, 0),
            byType,
            atStartByType,
            playerCount: input.playerCount,
            adultConfirmationRequired,
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
        return {
            ...(await this.previewMatches(predicate, locale)),
            scope: owner.groupId ? "GROUP" : "DATASPACE",
        };
    }

    async previewSession(
        predicate: Parameters<typeof matchesCardPolicyPredicate>[1],
        locale: string,
    ) {
        return { ...(await this.previewMatches(predicate, locale)), scope: "SESSION" as const };
    }

    private async previewMatches(
        predicate: Parameters<typeof matchesCardPolicyPredicate>[1],
        locale: string,
    ) {
        let matchCount = 0;
        const ids: string[] = [];
        for await (const card of this.repository.scanPolicyCards(locale)) {
            if (!matchesCardPolicyPredicate(card, predicate)) continue;
            matchCount++;
            if (ids.length < 20) ids.push(card.id);
        }
        const samples = await this.repository.policyPreviewSamples(ids, locale);
        return {
            matchCount,
            cards: samples.map(({ id, cardText, cardType, taxonomyLabel }) => ({
                id,
                text: cardText,
                cardType,
                taxonomyLabel,
            })),
        };
    }

    async bulkApply(
        owner: CardPolicyOwner,
        search: Omit<ManagedCardSearch, "cursor" | "limit">,
        directives: Parameters<CardPolicyRepository["putExactCards"]>[2],
        confirmedCount: number,
        expectedScopeRevision: number,
    ) {
        const cardIds = await this.repository.listMatchingCardIds(search);
        if (cardIds.length !== confirmedCount) {
            throw Object.assign(new Error(MESSAGE_KEYS.CARD_POLICY_RESULT_SET_CHANGED), {
                code: "POLICY_RESULT_SET_CHANGED",
                status: 409,
            });
        }
        return {
            appliedCount: await this.repository.putExactCards(
                owner,
                cardIds,
                directives,
                expectedScopeRevision,
            ),
        };
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
}
