import type { z } from "zod";
import {
    cardPolicyBulkApplyResponseSchema,
    cardPolicyDefaultResponseSchema,
    cardPolicyExactResponseSchema,
    cardPolicyRulePreviewResponseSchema,
    cardPolicyRuleResponseSchema,
    cardPolicyRulesResponseSchema,
    cardPolicyScopedDefaultResponseSchema,
    eligibilityPreviewSchema,
    managedCardSearchResponseSchema,
    type CardPolicyBulkApplyResponse,
    type CardPolicyDefaultResponse,
    type CardPolicyExactResponse,
    type CardPolicyRulePreviewResponse,
    type CardPolicyRuleResponse,
    type CardPolicyRulesResponse,
    type CardPolicyScopedDefaultResponse,
    type EligibilityPreview,
    type ManagedCardSearchResponse,
} from "./cardPolicyHttp";
import {
    roomCreateResponseSchema,
    roomJoinResponseSchema,
    type RoomCreateResponse,
    type RoomJoinResponse,
} from "./rooms";
import { serverInfoSchema, type ServerInfoPayload } from "./serverInfo";
import {
    cardReplacedEnvelopeSchema,
    participantLeftEnvelopeSchema,
    protocolErrorEnvelopeSchema,
    roomPresenceEnvelopeSchema,
    roomRoleChangedEnvelopeSchema,
    roomSnapshotEnvelopeSchema,
    serverHelloEnvelopeSchema,
    serverPongEnvelopeSchema,
    type ServerEnvelope,
} from "./snapshots";

const knownServerEnvelopes = {
    "server.hello": serverHelloEnvelopeSchema,
    "server.pong": serverPongEnvelopeSchema,
    "room.snapshot": roomSnapshotEnvelopeSchema,
    "room.presence": roomPresenceEnvelopeSchema,
    "room.roleChanged": roomRoleChangedEnvelopeSchema,
    "room.participantLeft": participantLeftEnvelopeSchema,
    "session.cardReplaced": cardReplacedEnvelopeSchema,
    error: protocolErrorEnvelopeSchema,
} as const;

function onlyAdditiveFields(issues: readonly z.core.$ZodIssue[]): boolean {
    return issues.length > 0 && issues.every(({ code }) => code === "unrecognized_keys");
}

export function decodeForwardCompatible<T extends z.ZodType>(
    schema: T,
    input: unknown,
): z.output<T> {
    const result = schema.safeParse(input);
    if (result.success) return result.data;
    if (onlyAdditiveFields(result.error.issues)) return input as z.output<T>;
    throw result.error;
}

export const decodeRoomCreateResponse = (input: unknown): RoomCreateResponse =>
    decodeForwardCompatible(roomCreateResponseSchema, input);

export const decodeRoomJoinResponse = (input: unknown): RoomJoinResponse =>
    decodeForwardCompatible(roomJoinResponseSchema, input);

export const decodeServerInfo = (input: unknown): ServerInfoPayload =>
    decodeForwardCompatible(serverInfoSchema, input);

export const decodeEligibilityPreview = (input: unknown): EligibilityPreview =>
    decodeForwardCompatible(eligibilityPreviewSchema, input);

export const decodeCardPolicyDefaultResponse = (input: unknown): CardPolicyDefaultResponse =>
    decodeForwardCompatible(cardPolicyDefaultResponseSchema, input);

export const decodeCardPolicyScopedDefaultResponse = (
    input: unknown,
): CardPolicyScopedDefaultResponse =>
    decodeForwardCompatible(cardPolicyScopedDefaultResponseSchema, input);

export const decodeCardPolicyRulesResponse = (input: unknown): CardPolicyRulesResponse =>
    decodeForwardCompatible(cardPolicyRulesResponseSchema, input);

export const decodeCardPolicyRuleResponse = (input: unknown): CardPolicyRuleResponse =>
    decodeForwardCompatible(cardPolicyRuleResponseSchema, input);

export const decodeCardPolicyRulePreviewResponse = (
    input: unknown,
): CardPolicyRulePreviewResponse =>
    decodeForwardCompatible(cardPolicyRulePreviewResponseSchema, input);

export const decodeManagedCardSearchResponse = (input: unknown): ManagedCardSearchResponse =>
    decodeForwardCompatible(managedCardSearchResponseSchema, input);

export const decodeCardPolicyBulkApplyResponse = (input: unknown): CardPolicyBulkApplyResponse =>
    decodeForwardCompatible(cardPolicyBulkApplyResponseSchema, input);

export const decodeCardPolicyExactResponse = (input: unknown): CardPolicyExactResponse =>
    decodeForwardCompatible(cardPolicyExactResponseSchema, input);

/**
 * Validates every known field while retaining the protocol's forward-compatible
 * rule: additive fields and unknown future event types are ignored by clients.
 */
export function decodeServerEnvelope(input: unknown): ServerEnvelope | null {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("Server message must be an object");
    }
    const type = Reflect.get(input, "type");
    if (typeof type !== "string") throw new Error("Server message type is required");
    const schema = knownServerEnvelopes[type as keyof typeof knownServerEnvelopes];
    if (!schema) return null;
    return decodeForwardCompatible(schema, input) as ServerEnvelope;
}
