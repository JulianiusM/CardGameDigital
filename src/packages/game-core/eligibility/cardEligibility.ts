import type { Card, CardType, DareTypeId, OperationalFlag, QuestionCategoryId } from "../index";
import { globalCardIntensityScore, maximumGlobalIntensityScore } from "../cards/intensity";
import type { CardAppearance } from "../history/history";
import { isAllowedByHistory } from "../history/history";
import type { GameProfile, PlayerBoundaries } from "../profiles/gameProfile";
import { compareSocialSensitivity } from "../cards/socialSensitivity";

export type EligibilityRequest = {
    cardType: CardType;
    requireYesNoAnswer?: boolean;
    profile: GameProfile;
    boundaries: readonly PlayerBoundaries[];
    maximumIntensityScore: number;
    sessionHistory: readonly CardAppearance[];
    groupHistoryCardIds: ReadonlySet<Card["id"]>;
    playerCount?: number;
};

export type EligibilityReason =
    | "CARD_TYPE"
    | "YES_NO_REQUIRED"
    | "QUESTION_CATEGORY"
    | "DARE_TYPE"
    | "QUESTION_BOUNDARY"
    | "DARE_BOUNDARY"
    | "OPERATIONAL_FLAG"
    | "SOCIAL_SENSITIVITY"
    | "INTENSITY"
    | "POLICY_AVAILABILITY"
    | "PLAYER_COUNT"
    | "INACTIVE"
    | "HISTORY";

function anyBoundaryHas<T>(
    boundaries: readonly PlayerBoundaries[],
    select: (boundary: PlayerBoundaries) => ReadonlySet<T>,
    value: T,
): boolean {
    return boundaries.some((boundary) => select(boundary).has(value));
}

export function eligibilityReasons(
    card: Card,
    request: EligibilityRequest,
): readonly EligibilityReason[] {
    const reasons: EligibilityReason[] = [];
    if (card.cardType !== request.cardType) reasons.push("CARD_TYPE");
    if (request.requireYesNoAnswer && !card.yesNoAnswerPossible) reasons.push("YES_NO_REQUIRED");
    if (
        card.questionCategoryId &&
        !request.profile.enabledQuestionCategoryIds.has(card.questionCategoryId)
    )
        reasons.push("QUESTION_CATEGORY");
    if (card.dareTypeId && !request.profile.enabledDareTypeIds.has(card.dareTypeId))
        reasons.push("DARE_TYPE");
    if (
        card.questionCategoryId &&
        anyBoundaryHas(
            request.boundaries,
            (boundary) => boundary.disabledQuestionCategoryIds,
            card.questionCategoryId as QuestionCategoryId,
        )
    )
        reasons.push("QUESTION_BOUNDARY");
    if (
        card.dareTypeId &&
        anyBoundaryHas(
            request.boundaries,
            (boundary) => boundary.disabledDareTypeIds,
            card.dareTypeId as DareTypeId,
        )
    )
        reasons.push("DARE_BOUNDARY");
    const blockedFlags = new Set<OperationalFlag>(request.profile.blockedOperationalFlags);
    for (const boundary of request.boundaries)
        for (const flag of boundary.blockedOperationalFlags) blockedFlags.add(flag);
    if (card.operationalFlags.some((flag) => blockedFlags.has(flag)))
        reasons.push("OPERATIONAL_FLAG");
    if (
        compareSocialSensitivity(card.socialSensitivity, request.profile.maximumSocialSensitivity) >
        0
    )
        reasons.push("SOCIAL_SENSITIVITY");
    if (
        globalCardIntensityScore(card) >
        Math.min(
            request.maximumIntensityScore,
            maximumGlobalIntensityScore(request.profile.maximumIntensity),
        )
    )
        reasons.push("INTENSITY");
    if (card.policyAvailable === false) reasons.push("POLICY_AVAILABILITY");
    if (
        (request.playerCount ?? 2) < card.minimumPlayerCount ||
        (card.maximumPlayerCount !== null && (request.playerCount ?? 2) > card.maximumPlayerCount)
    )
        reasons.push("PLAYER_COUNT");
    if (!card.active) reasons.push("INACTIVE");
    if (!isAllowedByHistory(card, request.sessionHistory, request.groupHistoryCardIds))
        reasons.push("HISTORY");
    return reasons;
}

export function eligibleCards<T extends Card>(
    cards: readonly T[],
    request: EligibilityRequest,
): readonly T[] {
    return cards.filter((card) => eligibilityReasons(card, request).length === 0);
}
