import {
    portableCardPolicyScopeSchema,
    sessionCardPolicySchema,
} from "../../../packages/protocol/cardPolicy";
import { MAX_POLICY_IMPORT_BYTES } from "../../../packages/protocol/limits";
import { messages } from "./i18n";

/** Validate before showing the destructive confirmation or retaining a setup draft. */
export async function readPolicyImport(file: Pick<File, "size" | "text">) {
    if (file.size > MAX_POLICY_IMPORT_BYTES)
        throw new Error(messages.cardManagement.importTooLarge);
    let value: unknown;
    try {
        value = JSON.parse(await file.text());
    } catch {
        throw new Error(messages.cardManagement.invalidImport);
    }
    const parsed = portableCardPolicyScopeSchema.safeParse(value);
    if (!parsed.success) throw new Error(messages.cardManagement.invalidImport);
    return parsed.data;
}

export function validateSessionPolicyDraft(value: unknown) {
    const parsed = sessionCardPolicySchema.safeParse(value);
    if (!parsed.success) throw new Error(messages.cardManagement.invalidSessionPolicy);
    return parsed.data;
}
