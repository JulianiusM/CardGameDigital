import {
    cardPolicyScopeFromJson,
    resolveCardPolicy,
    type SessionCardPolicyInput,
} from "./cardPolicy";
import type { Card } from "../cards/card";

export type CatalogProvenance = {
    catalogId: string;
    sequence: number;
    catalogVersion: string;
    contract: string;
    artifactDigest: string;
};

/** Captured sparse directives, independent of catalog size and translations. */
export type SessionPolicySnapshot = {
    dataSpace: SessionCardPolicyInput | null;
    group: SessionCardPolicyInput | null;
};

const emptySnapshot: SessionPolicySnapshot = { dataSpace: null, group: null };
type PolicyResolver = <T extends Card>(card: T) => T;
const prepared = new WeakMap<
    SessionPolicySnapshot,
    WeakMap<SessionCardPolicyInput, PolicyResolver>
>();

export function sessionPolicyResolver(
    snapshot: SessionPolicySnapshot | null,
    session: SessionCardPolicyInput,
) {
    const key = snapshot ?? emptySnapshot;
    const cached = prepared.get(key)?.get(session);
    if (cached) return cached;
    const dataSpace = snapshot?.dataSpace
        ? cardPolicyScopeFromJson({ name: "DataSpace", ...snapshot.dataSpace })
        : undefined;
    const group = snapshot?.group
        ? cardPolicyScopeFromJson({ name: "Group", ...snapshot.group })
        : undefined;
    const sessionScope = cardPolicyScopeFromJson({ name: "Session", ...session });
    const resolve = <T extends Card>(card: T): T => {
        const { provenance: _provenance, ...effective } = resolveCardPolicy({
            card,
            dataSpace,
            group,
            session: sessionScope,
        });
        return effective as T;
    };
    const entries = prepared.get(key) ?? new WeakMap();
    entries.set(session, resolve);
    prepared.set(key, entries);
    return resolve;
}
