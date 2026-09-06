import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { defaultRoomGameSettings } from "../../packages/application/roomGameSettings";
import type { CouchSessionSnapshot } from "../../packages/protocol";
import { MESSAGE_KEYS, translate } from "../../packages/localization/messages";
import { en } from "../../apps/web/src/locales/en";
import { de } from "../../apps/web/src/locales/de";
import { captureVisualAudit } from "./visual-audit-helpers";

const pointerKey = "party-game:couch-session";
const sessionPath = (id: string) => `/api/v1/couch/sessions/${id}`;

async function createGame(page: Page): Promise<CouchSessionSnapshot> {
    const response = await page.request.post("/api/v1/couch/sessions", {
        data: {
            ...defaultRoomGameSettings(),
            mode: "RANDOM_TRUTH_OR_DARE",
            persistence: "DATASPACE",
            players: [{ name: "Alice" }, { name: "Ben" }],
        },
    });
    expect(response.status()).toBe(201);
    return response.json();
}

async function openGame(page: Page, id: string, language = "en"): Promise<void> {
    await page.addInitScript(
        (locale) => localStorage.setItem("party-game.locale", locale),
        language,
    );
    await page.goto("/play/");
    await page.evaluate(({ key, id }) => sessionStorage.setItem(key, id), { key: pointerKey, id });
    await page.goto("/play/couch");
}

async function auditBothWidths(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: width === 320 ? 700 : 900 });
        const panel = page.locator(".couch-recovery, .policy-error");
        await panel.scrollIntoViewIfNeeded();
        expect(
            await panel.evaluate((element) => element.scrollWidth - element.clientWidth),
        ).toBeLessThanOrEqual(1);
        const audit = await captureVisualAudit(page, `phase-5-${name}-${width}`);
        expect(audit.horizontalOverflow).toBe(0);
        expect(audit.outOfBounds).toEqual([]);
        expect(audit.smallTargets).toEqual([]);
        expect(audit.overlaps).toEqual([]);
        await testInfo.attach(`${name}-${width}`, {
            path: audit.screenshotPath,
            contentType: "image/png",
        });
    }
}

for (const [language, copy] of [
    ["en", en],
    ["de", de],
] as const) {
    test(`Couch recovers a lost committed response without duplicate history in ${language}`, async ({
        page,
    }, testInfo) => {
        test.setTimeout(60_000);
        const initial = await createGame(page);
        await openGame(page, initial.id, language);
        await expect(
            page.getByRole("button", { name: copy.common.reveal, exact: true }),
        ).toBeVisible();
        let commands = 0;
        let creations = 0;
        let failReads = true;
        let committed: CouchSessionSnapshot | undefined;
        page.on("request", (request) => {
            if (request.method() === "POST" && request.url().endsWith("/couch/sessions"))
                creations++;
        });
        await page.route(`**${sessionPath(initial.id)}`, async (route) => {
            if (failReads)
                await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } });
            else await route.continue();
        });
        await page.route(`**${sessionPath(initial.id)}/start`, async (route) => {
            commands++;
            const response = await route.fetch();
            expect(response.status()).toBe(200);
            committed = await response.json();
            await route.abort("failed");
        });
        await page.getByRole("button", { name: copy.common.reveal, exact: true }).click();
        const panel = page.locator(".couch-recovery");
        await expect(panel).toContainText(copy.couch.recoveryFailed);
        await expect(panel).toBeFocused();
        expect(await page.evaluate((key) => sessionStorage.getItem(key), pointerKey)).toBe(
            initial.id,
        );
        await expect(page.locator(".game-card, .turn-ready, .player-setup")).toHaveCount(0);
        await auditBothWidths(page, testInfo, `lost-response-${language}`);
        failReads = false;
        await panel.getByRole("button", { name: copy.couch.recoveryRetry, exact: true }).click();
        await expect(page.locator(".game-card")).toBeVisible();
        const restored = await (await page.request.get(sessionPath(initial.id))).json();
        expect(restored).toEqual(committed);
        expect(restored.revision).toBe(initial.revision + 1);
        expect(restored.cardsShown).toBe(1);
        expect(commands).toBe(1);
        expect(creations).toBe(0);
        const database = new Database(".tmp/couch-e2e.sqlite", { readonly: true });
        try {
            expect(
                database
                    .prepare("SELECT card_id FROM couch_card_appearances WHERE session_id = ?")
                    .all(initial.id),
            ).toEqual([{ card_id: restored.currentCard.id }]);
        } finally {
            database.close();
        }
        // A subsequent command must use the recovered revision.
        const next = page.waitForResponse((response) =>
            response.url().endsWith(`${initial.id}/advance`),
        );
        await page
            .locator(".actions")
            .getByRole("button", { name: copy.common.next, exact: true })
            .click();
        expect((await next).status()).toBe(200);
        expect((await (await page.request.get(sessionPath(initial.id))).json()).revision).toBe(
            restored.revision + 1,
        );
    });

    test(`Policy conflicts and removed rules or Groups offer explicit recovery in ${language}`, async ({
        page,
        context,
    }, testInfo) => {
        test.setTimeout(90_000);
        const active = await createGame(page);
        await openGame(page, active.id, language);
        await expect(page.locator(".turn-ready")).toBeVisible();
        const editor = await context.newPage();
        await editor.addInitScript(
            (locale) => localStorage.setItem("party-game.locale", locale),
            language,
        );
        const name = `Recovery ${randomUUID().slice(0, 8)}`;
        const group = await (
            await editor.request.post("/api/v1/groups", { data: { name, members: [] } })
        ).json();
        const query = `?groupId=${group.id}`;
        const root = "/api/v1/card-policy";
        const input = { name: "Original rule", enabled: false, predicate: {}, directives: {} };
        const rule = (
            await (await editor.request.post(`${root}/rules${query}`, { data: input })).json()
        ).rule;
        await editor.goto("/play/cards");
        await editor.getByRole("button", { name: copy.cardManagement.changeScope }).click();
        await editor.getByLabel(copy.cardManagement.searchGroups, { exact: true }).fill(name);
        await editor.locator(".policy-scope-option").filter({ hasText: name }).click();
        await editor.getByRole("tab", { name: copy.cardManagement.rulesTab, exact: true }).click();
        const ruleName = editor.getByLabel(copy.cardManagement.ruleName, { exact: true });
        await expect(ruleName).toHaveValue(input.name);
        await ruleName.fill("Unsaved local edit");
        const newer = (
            await (
                await editor.request.put(`${root}/rules/${rule.id}${query}`, {
                    data: { ...input, name: "Changed elsewhere", expectedRevision: rule.revision },
                })
            ).json()
        ).rule;
        await editor.getByRole("button", { name: copy.common.save, exact: true }).click();
        const error = editor.locator(".policy-error");
        await expect(error).toContainText(
            translate(language, MESSAGE_KEYS.CARD_POLICY_REVISION_CONFLICT),
        );
        await expect(error).toBeFocused();
        await expect(ruleName).toHaveValue("Unsaved local edit");
        await auditBothWidths(editor, testInfo, `policy-conflict-${language}`);
        await error.getByRole("button", { name: copy.cardManagement.reloadPolicy }).click();
        await expect(ruleName).toHaveValue("Changed elsewhere");
        await expect(editor.locator("#policy-scope-heading")).toBeFocused();
        await editor.request.delete(
            `${root}/rules/${rule.id}${query}&expectedRevision=${newer.revision}`,
        );
        await ruleName.fill("Edit removed rule");
        await editor.getByRole("button", { name: copy.common.save, exact: true }).click();
        await expect(error).toContainText(
            translate(language, MESSAGE_KEYS.CARD_POLICY_RULE_NOT_FOUND),
        );
        await auditBothWidths(editor, testInfo, `removed-rule-${language}`);
        await error.getByRole("button", { name: copy.cardManagement.reloadPolicy }).click();
        await expect(ruleName).toHaveCount(0);
        await editor.request.delete(`/api/v1/groups/${group.id}`);
        await editor
            .getByRole("button", { name: copy.cardManagement.addRule, exact: true })
            .click();
        await expect(error).toContainText(translate(language, MESSAGE_KEYS.GROUP_NOT_FOUND));
        await expect(error).toBeFocused();
        await expect(
            error.getByRole("link", { name: copy.menu.account, exact: true }),
        ).toHaveAttribute("target", "_blank");
        await auditBothWidths(editor, testInfo, `removed-group-${language}`);
        await error.getByRole("button", { name: copy.cardManagement.chooseScope }).click();
        await expect(
            editor.getByRole("button", { name: copy.cardManagement.changeScope }),
        ).toHaveAttribute("aria-expanded", "true");
        await expect(editor.locator(".policy-scope-option").filter({ hasText: name })).toHaveCount(
            0,
        );
        expect(await (await page.request.get(sessionPath(active.id))).json()).toEqual(active);
        expect(await page.evaluate((key) => sessionStorage.getItem(key), pointerKey)).toBe(
            active.id,
        );
        await expect(page.locator(".turn-ready")).toBeVisible();
        await editor.close();
    });
}

test("Couch automatically resumes after a transient reload and resynchronizes a stale command", async ({
    page,
}) => {
    const initial = await createGame(page);
    await openGame(page, initial.id);
    await expect(page.locator(".turn-ready")).toBeVisible();
    let reads = 0;
    await page.route(`**${sessionPath(initial.id)}`, async (route) => {
        reads++;
        if (reads === 1) await route.abort("failed");
        else await route.continue();
    });
    // A failed auxiliary setup request must not prevent recovery either.
    await page.route("**/api/v1/game-profiles", (route) => route.abort("failed"));
    await page.reload();
    await expect(page.locator(".couch-recovery")).toContainText(en.couch.recoveryFailed);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), pointerKey)).toBe(initial.id);
    await expect(page.locator(".turn-ready")).toBeVisible();
    expect(reads).toBe(2);
    const ended = await page.request.post(`${sessionPath(initial.id)}/end`, {
        data: { revision: initial.revision },
    });
    expect(ended.status()).toBe(200);
    await page.getByRole("button", { name: en.common.reveal, exact: true }).click();
    await expect(page.getByRole("heading", { name: en.end.title })).toBeVisible();
    expect(await (await page.request.get(sessionPath(initial.id))).json()).toEqual(
        await ended.json(),
    );
});

test("Couch keeps uncertain and forbidden recovery references until a definitive Session-not-found", async ({
    page,
}, testInfo) => {
    test.setTimeout(60_000);
    const initial = await createGame(page);
    let status = 403;
    let body: unknown = { error: { code: "NOT_AUTHORIZED" } };
    await page.route(`**${sessionPath(initial.id)}`, (route) =>
        route.fulfill({ status, json: body }),
    );
    await openGame(page, initial.id);
    const panel = page.locator(".couch-recovery");
    await expect(panel).toContainText(en.couch.recoveryAccount);
    await expect(panel.getByRole("link", { name: en.menu.account, exact: true })).toHaveAttribute(
        "target",
        "_blank",
    );
    await auditBothWidths(page, testInfo, "account-recovery");
    for (const failure of [
        {
            status: 429,
            body: {
                error: {
                    code: "RATE_LIMITED",
                    message: translate("en", MESSAGE_KEYS.REQUEST_RATE_EXCEEDED),
                },
            },
        },
        { status: 404, body: { error: { code: "REQUEST_NOT_FOUND" } } },
        { status: 200, body: { id: initial.id, revision: initial.revision } },
    ]) {
        status = failure.status;
        body = failure.body;
        await page.reload();
        await expect(panel).toContainText(en.couch.recoveryFailed);
        expect(await page.evaluate((key) => sessionStorage.getItem(key), pointerKey)).toBe(
            initial.id,
        );
        if (status === 429) await auditBothWidths(page, testInfo, "phase-6-rate-recovery");
    }
    status = 404;
    body = { error: { code: "SESSION_NOT_FOUND" } };
    await page.reload();
    await expect(page.locator(".player-setup")).toBeVisible();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), pointerKey)).toBeNull();
});

test("Card management can retry an initial outage", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("party-game.locale", "en"));
    let fail = true;
    await page.route("**/api/v1/card-policy/scope", async (route) => {
        if (fail) await route.abort("failed");
        else await route.continue();
    });
    await page.goto("/play/cards");
    const panel = page.locator(".policy-error");
    await expect(panel).toContainText(en.common.connectionFailed);
    await expect(panel).toBeFocused();
    fail = false;
    await panel.getByRole("button", { name: en.cardManagement.retryLoading }).click();
    await expect(page.locator(".policy-scope-card")).toBeVisible();
    await expect(panel).toHaveCount(0);
});
