import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { captureVisualAudit } from "./visual-audit-helpers";

const username = process.env.E2E_ADMIN_USERNAME ?? "tester";
const password = process.env.E2E_ADMIN_PASSWORD ?? "passw0rd!";

async function auditAccountSurface(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    await page.waitForTimeout(250);
    const report = await captureVisualAudit(page, name, { fullPage: true });
    await testInfo.attach(`${name}-geometry`, {
        body: Buffer.from(JSON.stringify(report, null, 2)),
        contentType: "application/json",
    });
    expect.soft(report.horizontalOverflow, `${name}: document horizontal overflow`).toBe(0);
    expect.soft(report.outOfBounds, `${name}: visible content outside viewport`).toEqual([]);
    expect.soft(report.overlaps, `${name}: overlapping visible content`).toEqual([]);
    expect.soft(report.truncations, `${name}: clipped or truncated text`).toEqual([]);
    expect
        .soft(report.smallTargets, `${name}: interactive targets below 44 CSS pixels`)
        .toEqual([]);
}

async function expectSelectedResponsiveTabsPainted(page: Page): Promise<void> {
    await expect
        .poll(
            () =>
                page.locator(".responsive-tabs").evaluateAll((viewports) => {
                    const tolerance = 1;
                    const issues: Array<Record<string, unknown>> = [];
                    for (const viewport of viewports) {
                        const selected = viewport.querySelector<HTMLElement>(
                            "[role='tab'][aria-selected='true']",
                        );
                        if (!selected) {
                            issues.push({ issue: "missing selected tab" });
                            continue;
                        }

                        const viewportBounds = viewport.getBoundingClientRect();
                        const selectedBounds = selected.getBoundingClientRect();
                        const paintedRange = document.createRange();
                        paintedRange.selectNodeContents(selected);
                        const paintedRects = [...paintedRange.getClientRects()].map((bounds) => ({
                            left: bounds.left,
                            right: bounds.right,
                            top: bounds.top,
                            bottom: bounds.bottom,
                        }));
                        const visibleLeft = viewportBounds.left + viewport.clientLeft;
                        const visibleTop = viewportBounds.top + viewport.clientTop;
                        const visibleRight = visibleLeft + viewport.clientWidth;
                        const visibleBottom = visibleTop + viewport.clientHeight;
                        const selectedContained =
                            selectedBounds.left >= visibleLeft - tolerance &&
                            selectedBounds.right <= visibleRight + tolerance &&
                            selectedBounds.top >= visibleTop - tolerance &&
                            selectedBounds.bottom <= visibleBottom + tolerance;
                        const paintedContentContained =
                            paintedRects.length > 0 &&
                            paintedRects.every(
                                (bounds) =>
                                    bounds.left >= visibleLeft - tolerance &&
                                    bounds.right <= visibleRight + tolerance &&
                                    bounds.top >= visibleTop - tolerance &&
                                    bounds.bottom <= visibleBottom + tolerance,
                            );
                        if (!selectedContained || !paintedContentContained) {
                            issues.push({
                                issue: "selected tab is clipped by its scroll viewport",
                                label: selected.textContent?.trim() ?? "",
                                viewport: {
                                    left: visibleLeft,
                                    right: visibleRight,
                                    top: visibleTop,
                                    bottom: visibleBottom,
                                },
                                selected: {
                                    left: selectedBounds.left,
                                    right: selectedBounds.right,
                                    top: selectedBounds.top,
                                    bottom: selectedBounds.bottom,
                                },
                                paintedRects,
                            });
                        }
                    }
                    return issues;
                }),
            { message: "selected responsive tabs should be fully painted after viewport changes" },
        )
        .toEqual([]);
}

async function auditDesktopAndPhone(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await expectSelectedResponsiveTabsPainted(page);
    await auditAccountSurface(page, testInfo, `${name}-desktop`);
    await expectActiveDataSpaceReadable(page);
    await page.setViewportSize({ width: 320, height: 568 });
    await expectSelectedResponsiveTabsPainted(page);
    await auditAccountSurface(page, testInfo, `${name}-phone`);
    await expectActiveDataSpaceReadable(page);
}

async function expectActiveDataSpaceReadable(page: Page): Promise<void> {
    const indicator = page.locator(".active-dataspace-indicator");
    if (!(await indicator.count())) return;
    const name = indicator.locator("strong");
    await expect
        .poll(() =>
            name.evaluate((element) => {
                const style = getComputedStyle(element);
                return element.clientHeight <= Number.parseFloat(style.lineHeight) + 1;
            }),
        )
        .toBe(true);
    if (!(await name.evaluate((element) => element.scrollWidth > element.clientWidth + 1))) return;
    await expect(name).toHaveAttribute("data-text-overflow", "");
    await expect(name).not.toHaveAttribute("tabindex", "0");
    await indicator.focus();
    await expect(name).toHaveAttribute("data-text-scroll-paused", "");
    for (const key of ["End", "Home"] as const) {
        await indicator.press(key);
        await expect
            .poll(() =>
                name.evaluate((element, endpoint) => {
                    const text = element.firstChild;
                    if (!text?.textContent) return false;
                    const offset = endpoint === "End" ? text.textContent.length - 1 : 0;
                    const range = document.createRange();
                    range.setStart(text, offset);
                    range.setEnd(text, offset + 1);
                    const ink = range.getBoundingClientRect();
                    const bounds = element.getBoundingClientRect();
                    return ink.left >= bounds.left - 1 && ink.right <= bounds.right + 1;
                }, key),
            )
            .toBe(true);
    }
    await indicator.evaluate((element) => (element as HTMLElement).blur());
}

async function expectInputPlaceholderPainted(search: Locator, expectedText: string): Promise<void> {
    await expect(search).toBeVisible();
    await expect(search).toHaveValue("");
    const measurement = await search.evaluate((element) => {
        const input = element as HTMLInputElement;
        const bounds = input.getBoundingClientRect();
        const style = getComputedStyle(input);
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas text measurement is unavailable");
        context.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const letterSpacing = Number.parseFloat(style.letterSpacing);
        let paintedWidth = context.measureText(input.placeholder).width;
        if (Number.isFinite(letterSpacing) && input.placeholder.length > 1) {
            paintedWidth += letterSpacing * (input.placeholder.length - 1);
        }
        const availableWidth =
            input.clientWidth -
            Number.parseFloat(style.paddingLeft) -
            Number.parseFloat(style.paddingRight);
        return {
            placeholder: input.placeholder,
            paintedWidth,
            availableWidth,
            left: bounds.left,
            right: bounds.right,
            viewportWidth: innerWidth,
        };
    });

    expect(measurement.viewportWidth).toBe(320);
    expect(measurement.placeholder).toBe(expectedText);
    expect(measurement.left).toBeGreaterThanOrEqual(-1);
    expect(measurement.right).toBeLessThanOrEqual(measurement.viewportWidth + 1);
    expect(measurement.paintedWidth).toBeLessThanOrEqual(measurement.availableWidth + 1);
}

async function expectWizardProgressLabelsOnOneLine(page: Page): Promise<void> {
    const lineCounts = await page.locator(".wizard-progress b").evaluateAll((labels) =>
        labels.map((label) => {
            const range = document.createRange();
            range.selectNodeContents(label);
            return range.getClientRects().length;
        }),
    );
    expect(lineCounts.length).toBeGreaterThan(0);
    expect(lineCounts).toEqual(lineCounts.map(() => 1));
}

async function dismissVisibleNotification(page: Page): Promise<void> {
    const close = page.getByRole("button", { name: "Hinweis schließen" });
    if (await close.isVisible()) await close.click();
}

async function expectResponsiveTabsContained(page: Page): Promise<void> {
    const containment = await page.evaluate(() => ({
        rootOverflow: document.documentElement.scrollWidth - innerWidth,
        shells: [...document.querySelectorAll<HTMLElement>(".responsive-tabs-shell")].map(
            (shell) => {
                const bounds = shell.getBoundingClientRect();
                const arrows = [
                    ...shell.querySelectorAll<HTMLElement>(":scope > .tab-scroll-arrow"),
                ]
                    .filter((arrow) => getComputedStyle(arrow).visibility !== "hidden")
                    .map((arrow) => {
                        const arrowBounds = arrow.getBoundingClientRect();
                        return { left: arrowBounds.left, right: arrowBounds.right };
                    });
                return { left: bounds.left, right: bounds.right, arrows };
            },
        ),
    }));

    expect(containment.rootOverflow).toBeLessThanOrEqual(0);
    expect(containment.shells.length).toBeGreaterThanOrEqual(2);
    for (const shell of containment.shells) {
        expect(shell.left).toBeGreaterThanOrEqual(-1);
        expect(shell.right).toBeLessThanOrEqual(321);
        for (const arrow of shell.arrows) {
            expect(arrow.left).toBeGreaterThanOrEqual(-1);
            expect(arrow.right).toBeLessThanOrEqual(321);
        }
    }
}

test.beforeEach(async ({ request }) => {
    const serverInfo = await (await request.get("/api/v1/server-info")).json();
    test.skip(
        serverInfo.deploymentMode !== "public",
        "Public account browser coverage requires a public server",
    );
});

test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
        if (!localStorage.getItem("party-game.locale"))
            localStorage.setItem("party-game.locale", "de");
    });
});

test("account entry keeps every authentication path themed and responsive", async ({
    page,
}, testInfo) => {
    test.setTimeout(60_000);
    await page.route("**/api/v1/account/status", async (route) => {
        const response = await route.fetch();
        const status = (await response.json()) as Record<string, unknown>;
        await route.fulfill({
            response,
            json: { ...status, oidcEnabled: true, oidcName: "Golden ID" },
        });
    });
    await page.goto("/play/account");
    await expect(page.getByRole("heading", { name: "Anmelden", exact: true })).toBeVisible();
    await expect(page.locator(".account-login-card")).toBeVisible();
    const register = page.getByRole("button", { name: "Konto erstellen" });
    await expect(register).toBeVisible();
    expect((await register.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    const verticalDivider = page.locator(".account-choice-divider");
    const desktopDividerBox = (await verticalDivider.boundingBox())!;
    expect(desktopDividerBox.height).toBeGreaterThan(desktopDividerBox.width);

    const provider = page.getByRole("link", { name: /Mit Golden ID anmelden/ });
    await expect(provider).toBeVisible();
    await expect(provider).toHaveAttribute("href", "/api/v1/account/oidc/login");
    await expect(provider).toHaveCSS("border-radius", "20px");
    expect(
        await provider.evaluate((element) => getComputedStyle(element).backgroundImage),
    ).not.toBe("none");
    await auditAccountSurface(page, testInfo, "70-account-login-oidc-desktop");

    await page.setViewportSize({ width: 320, height: 568 });
    const horizontalDividerBox = (await verticalDivider.boundingBox())!;
    expect(horizontalDividerBox.width).toBeGreaterThan(horizontalDividerBox.height);
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    await auditAccountSurface(page, testInfo, "71-account-login-oidc-phone");

    const maximumUsername = "u".repeat(50);
    const maximumDisplayName = "Anzeigename".repeat(5).slice(0, 50);
    const maximumEmail = `${"e".repeat(64)}@${"d".repeat(31)}.com`;
    expect(maximumEmail).toHaveLength(100);

    await register.click();
    await page.getByLabel("Benutzername").fill(maximumUsername);
    await page.getByLabel("Anzeigename").fill(maximumDisplayName);
    await page.getByLabel("E-Mail", { exact: true }).fill(maximumEmail);
    await page.getByLabel("Passwort", { exact: true }).fill("p".repeat(200));
    await page.getByLabel("Passwort wiederholen").fill("p".repeat(200));
    await auditAccountSurface(page, testInfo, "72-account-register-max-fields-phone");

    await page.getByRole("button", { name: "Zur Anmeldung" }).click();
    await page.getByRole("button", { name: "Aktivierungslink erneut senden" }).click();
    await expect(page.getByRole("heading", { name: "Konto aktivieren" })).toBeVisible();
    await page.getByLabel("Benutzername oder E-Mail").fill(maximumUsername);
    await auditAccountSurface(page, testInfo, "73-account-activation-max-field-phone");

    await page.getByRole("button", { name: "Zur Anmeldung" }).click();
    await page.getByRole("button", { name: "Passwort vergessen" }).click();
    await expect(page.getByRole("heading", { name: "Passwort vergessen?" })).toBeVisible();
    await page.getByLabel("Benutzername oder E-Mail").fill(maximumEmail);
    await auditAccountSurface(page, testInfo, "74-account-forgot-max-field-phone");

    await page.goto(`/play/account?reset=${"r".repeat(32)}`);
    await expect(page.getByRole("heading", { name: "Neues Passwort" })).toBeVisible();
    await page.getByLabel("Passwort", { exact: true }).fill("p".repeat(200));
    await page.getByLabel("Wiederholen", { exact: true }).fill("p".repeat(200));
    await auditAccountSurface(page, testInfo, "75-account-reset-max-fields-phone");
});

test("an account joins the themed SPA and unlocks MariaDB-backed saved play", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/play/");
    await expect(page.getByRole("link", { name: "Anmelden" })).toBeVisible();

    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("link", { name: /Für gespeicherte Gruppen anmelden/ }).click();
    await expect(page).toHaveURL(/\/play\/account\?returnTo=/);
    await page.getByLabel("Benutzername").fill(username);
    await page.getByLabel("Passwort", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();

    await expect(page).toHaveURL(/\/play\/?\?setup=group$/);
    await expect(page.getByRole("link", { name: /Konto und gespeicherte Spiele/ })).toContainText(
        username,
    );
    await page.getByRole("button", { name: /Neue Gruppe/ }).click();
    await page.getByLabel("Gruppenname").fill("MariaDB Runde");
    await page.getByLabel("Namen, durch Kommas getrennt").fill("Ada, Lin");
    await page.getByRole("button", { name: "Gruppe speichern" }).click();
    await expect(page.locator(".group-list-row.selected")).toContainText("MariaDB Runde");

    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Wahrheit oder Pflicht/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(page.getByRole("button", { name: /^Kinderfreundlich / })).toBeVisible();
    await page.getByRole("button", { name: /^Gute Freunde / }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Alle mit eigenem Gerät/ }).click();
    await expect(page.getByLabel("Name des Hosts")).toHaveValue(username);
    await page.getByRole("button", { name: /Nur dieser Bildschirm/ }).click();
    await page.getByRole("button", { name: /Weiter zur Lobby/ }).click();
    await page.getByRole("button", { name: /Spiel starten/ }).click();
    await page.getByRole("button", { name: "Wahrheit" }).click();
    await expect(page.locator(".game-card")).toBeVisible();

    await page.getByLabel("Einstellungen").click();
    await page.getByRole("tab", { name: /Hilfe & Konto/ }).click();
    const accountLink = page.getByRole("link", { name: /Konto/ });
    await expect(accountLink).toHaveAttribute("target", "_blank");
    const gameUrl = page.url();
    const accountPopupPromise = page.waitForEvent("popup");
    await accountLink.click();
    const accountPopup = await accountPopupPromise;
    await expect(accountPopup).toHaveURL(/\/play\/account\?returnTo=/);
    await expect(page).toHaveURL(gameUrl);
    await expect(page.locator(".game-card")).toBeVisible();
    await accountPopup.close();
    await page.getByRole("tab", { name: "Session" }).click();
    await page.getByRole("button", { name: "Spiel beenden" }).click();
    await expect(page.getByRole("heading", { name: /Gute Nacht/ })).toBeVisible();

    await page.getByRole("button", { name: "Zurück zum Hauptmenü" }).click();
    await expect(page.locator(".active-dataspace-indicator")).toContainText("Aktiver DataSpace");
    await page.goto("/play/account");
    await page.getByRole("tab", { name: "Gruppen" }).click();
    await page.getByLabel("Gruppen durchsuchen").fill("MariaDB Runde");
    await page.getByRole("option", { name: /MariaDB Runde/ }).click();
    const groupEditor = page.locator(".group-editor-card");
    await expect(groupEditor.getByLabel("Gruppenname")).toHaveValue("MariaDB Runde");
    await groupEditor.getByLabel("Gruppenname").fill("MariaDB Runde Neu");
    await groupEditor.getByLabel("Namen, durch Kommas getrennt").fill("Ada, Lin, Mo");
    await groupEditor.getByRole("button", { name: "Änderungen speichern" }).click();
    await expect(page.getByRole("status")).toContainText("Gruppe gespeichert");
    await groupEditor.getByRole("button", { name: "Kartenverlauf zurücksetzen" }).click();
    await groupEditor
        .locator(".group-action-confirmation")
        .getByRole("button", { name: "Kartenverlauf zurücksetzen" })
        .click();
    await expect(page.getByRole("status")).toContainText("Kartenverlauf zurückgesetzt");
    await page.getByRole("button", { name: "Gruppe löschen", exact: true }).click();
    await page.getByLabel("Zur Bestätigung „MariaDB Runde Neu“ eingeben").fill("MariaDB Runde Neu");
    await page.getByRole("button", { name: "Gruppe endgültig löschen" }).click();
    await expect(page.getByRole("option", { name: /MariaDB Runde/ })).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("Gruppe vollständig gelöscht");

    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await expect(page.getByRole("button", { name: /Keine Gruppe/ })).toHaveClass(/selected/);
    await expect(page.getByRole("button", { name: /Gruppe auswählen/ })).toBeDisabled();

    await page.getByRole("button", { name: /Zurück/ }).click();
    await page.getByRole("button", { name: /Spiel beitreten/ }).click();
    await expect(page.getByLabel("Dein Name")).toHaveValue(username);

    await page.goto("/play/account");
    await expect(
        page.getByRole("heading", { name: new RegExp(`Hallo, ${username}`, "i") }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Was ist ein DataSpace?" })).toBeVisible();
    await page.getByRole("tab", { name: "Kartenverwaltung" }).click();
    await expect(page.locator(".account-tab-panel")).toHaveCSS("animation-name", "account-tab-in");
    await expect(page.getByRole("heading", { name: "Kartenverwaltung", exact: true })).toHaveCount(
        0,
    );
    await expect(
        page.getByRole("heading", { name: "Drei Ebenen, eine klare Richtlinie" }),
    ).toBeVisible();
    await expect(page.locator(".account-panel main")).toHaveCount(0);
    const cardPolicyActions = page.locator(".policy-scope-actions > *");
    await expect(cardPolicyActions).toHaveCount(3);
    for (const action of await cardPolicyActions.all()) {
        await expect(action).toHaveCSS("display", "flex");
        await expect(action).toHaveCSS("white-space", "normal");
        expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByRole("button", { name: "DataSpace / Gruppe wählen" })).toBeVisible();
    await page.getByRole("tab", { name: "Kartenausnahmen" }).click();
    const cardPageButtons = page.locator(".policy-master-pane .policy-pagination button");
    await expect(cardPageButtons).toHaveCount(2);
    const previousCardPageBox = (await cardPageButtons.nth(0).boundingBox())!;
    const nextCardPageBox = (await cardPageButtons.nth(1).boundingBox())!;
    expect(Math.abs(previousCardPageBox.width - nextCardPageBox.width)).toBeLessThanOrEqual(1);
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    await page.getByRole("tab", { name: "DataSpaces" }).click();
    await page.getByPlaceholder("z. B. Freundeskreis").fill("UX Bereich");
    await page.getByRole("button", { name: "Erstellen", exact: true }).click();
    await expect(page.locator(".data-space-card.active", { hasText: "UX Bereich" })).toBeVisible();
    await page.getByRole("button", { name: "DataSpace UX Bereich löschen" }).click();
    await page.getByLabel("Zur Bestätigung „UX Bereich“ eingeben").fill("UX Bereich");
    await page.getByRole("button", { name: "DataSpace endgültig löschen" }).click();
    await expect(page.locator(".data-space-card", { hasText: "UX Bereich" })).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("DataSpace und seine gespeicherten Daten");
    await page.getByRole("tab", { name: "Geräte" }).click();
    await expect(page.getByRole("heading", { name: "Angemeldete Geräte" })).toBeVisible();
    await expect(page.getByText("Dieses Gerät")).toBeVisible();
    await page.getByRole("tab", { name: "Daten & Konto" }).click();
    const accountActions = [
        page.getByRole("link", { name: /Gespeicherte Runde starten/ }),
        page.getByRole("link", { name: /Daten exportieren/ }),
        page.getByRole("button", { name: "Abmelden", exact: true }),
    ];
    const actionMotion = await Promise.all(
        accountActions.map((action) =>
            action.evaluate((element) => {
                const style = getComputedStyle(element);
                return {
                    duration: style.transitionDuration,
                    property: style.transitionProperty,
                };
            }),
        ),
    );
    expect(new Set(actionMotion.map(({ duration }) => duration)).size).toBe(1);
    expect(new Set(actionMotion.map(({ property }) => property)).size).toBe(1);
    for (const action of accountActions) {
        await action.hover();
        await expect(action).not.toHaveCSS("transform", "none");
    }
    await page.getByRole("button", { name: "Abmelden", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();

    await page.evaluate(() => sessionStorage.removeItem("party-game:setup"));
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await expect(page.getByRole("button", { name: /Keine Gruppe/ })).toBeVisible();
    await expect(
        page.getByRole("link", { name: /Für gespeicherte Gruppen anmelden/ }),
    ).toBeVisible();
});

test("maximum-length account data stays complete and contained", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const maximumDataSpaceName = "D".repeat(50);
    const maximumGroupName = `Gruppe${"N".repeat(74)}`;
    const maximumPlayerNames = Array.from(
        { length: 50 },
        (_, index) => `${String(index + 1).padStart(2, "0")}${"P".repeat(38)}`,
    ).join(", ");
    expect(maximumPlayerNames.split(", ")).toHaveLength(50);

    await page.goto("/play/account");
    await page.getByLabel("Benutzername").fill(username);
    await page.getByLabel("Passwort", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(
        page.getByRole("heading", { name: new RegExp(`Hallo, ${username}`, "i") }),
    ).toBeVisible();

    const createDataSpaceForm = page.locator(".account-form-inline").last();
    await createDataSpaceForm
        .locator("input:not([type]), input[type=text]")
        .fill(maximumDataSpaceName);
    await createDataSpaceForm.getByRole("button", { name: "Erstellen", exact: true }).click();
    await expect(page.locator(".account-active-space strong")).toHaveText(maximumDataSpaceName);
    await dismissVisibleNotification(page);
    await auditDesktopAndPhone(page, testInfo, "76-account-dashboard-dataspaces-max");
    await expectInputPlaceholderPainted(
        createDataSpaceForm.getByLabel("Name des DataSpace"),
        "z. B. Freundeskreis",
    );

    await page.getByRole("button", { name: `DataSpace ${maximumDataSpaceName} löschen` }).click();
    const dataSpaceConfirmation = page.locator(".data-space-delete-confirmation");
    await expect(dataSpaceConfirmation).toBeVisible();
    await dataSpaceConfirmation
        .getByLabel(`Zur Bestätigung „${maximumDataSpaceName}“ eingeben`)
        .fill(maximumDataSpaceName);
    await auditDesktopAndPhone(page, testInfo, "77-account-dataspace-delete-confirmation-max");
    await dataSpaceConfirmation.getByRole("button", { name: "Abbrechen" }).click();

    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole("tab", { name: "Gruppen" }).click();
    const createGroupForm = page.locator(".account-group-create-form");
    await createGroupForm.getByLabel("Gruppenname").fill(maximumGroupName);
    await createGroupForm.getByLabel("Namen, durch Kommas getrennt").fill(maximumPlayerNames);
    await createGroupForm.getByRole("button", { name: "Gruppe speichern" }).click();
    await expect(page.locator(".group-editor-card h3")).toHaveText(maximumGroupName);
    const maximumGroupRow = page.locator(".group-browser-row", { hasText: maximumGroupName });
    await expect(maximumGroupRow.locator(".group-browser-member-count")).toHaveText("50");
    await expect(maximumGroupRow.locator(".group-browser-member-count")).toHaveAttribute(
        "aria-label",
        "50 gespeicherte Personen",
    );
    const acceptedMembers = await page.locator(".group-members-input").inputValue();
    expect(acceptedMembers.split(", ")).toHaveLength(50);

    const expectContainedCompleteText = async () => {
        const diagnostics = await page.evaluate(() => {
            const selectors = [
                ".account-active-space strong",
                ".group-browser-copy strong",
                ".group-browser-copy small",
                ".group-editor-card h3",
                ".account-explainer p",
            ];
            return {
                rootOverflow: document.documentElement.scrollWidth - innerWidth,
                viewportWidth: innerWidth,
                values: selectors.flatMap((selector) =>
                    [...document.querySelectorAll<HTMLElement>(selector)].map((element) => {
                        const bounds = element.getBoundingClientRect();
                        const style = getComputedStyle(element);
                        return {
                            selector,
                            left: bounds.left,
                            right: bounds.right,
                            overflow: style.overflow,
                            textOverflow: style.textOverflow,
                            scrollWidth: element.scrollWidth,
                            clientWidth: element.clientWidth,
                        };
                    }),
                ),
            };
        });
        expect(diagnostics.rootOverflow).toBeLessThanOrEqual(0);
        for (const value of diagnostics.values) {
            expect(value.left, value.selector).toBeGreaterThanOrEqual(-1);
            expect(value.right, value.selector).toBeLessThanOrEqual(diagnostics.viewportWidth + 1);
            expect(value.textOverflow, value.selector).not.toBe("ellipsis");
            expect(value.scrollWidth, value.selector).toBeLessThanOrEqual(value.clientWidth + 1);
        }
    };

    await expectContainedCompleteText();
    const toastClose = page.getByRole("button", { name: "Hinweis schließen" });
    if (await toastClose.isVisible()) {
        const bounds = (await toastClose.boundingBox())!;
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        await toastClose.click();
    }
    await auditDesktopAndPhone(page, testInfo, "78-account-groups-max-50-members");
    await expectInputPlaceholderPainted(page.getByLabel("Gruppen durchsuchen"), "Gruppe/Person");

    const groupMaintenance = page.locator(".group-maintenance-actions");
    await groupMaintenance
        .getByRole("button", { name: "Kartenverlauf zurücksetzen", exact: true })
        .click();
    const resetConfirmation = page.locator(".group-action-confirmation:not(.destructive)");
    await expect(resetConfirmation).toContainText(maximumGroupName);
    await auditDesktopAndPhone(page, testInfo, "79-account-group-reset-confirmation-max");
    await resetConfirmation.getByRole("button", { name: "Abbrechen" }).click();

    await groupMaintenance.getByRole("button", { name: "Gruppe löschen", exact: true }).click();
    const groupDeleteConfirmation = page.locator(".group-action-confirmation.destructive");
    await expect(groupDeleteConfirmation).toContainText(maximumGroupName);
    await groupDeleteConfirmation
        .getByLabel(`Zur Bestätigung „${maximumGroupName}“ eingeben`)
        .fill(maximumGroupName);
    await expectContainedCompleteText();
    await auditDesktopAndPhone(page, testInfo, "80-account-group-delete-confirmation-max");
    await groupDeleteConfirmation.getByRole("button", { name: "Abbrechen" }).click();

    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole("tab", { name: "Kartenverwaltung" }).click();
    await expect(page.locator(".card-management-shell.embedded")).toBeVisible();
    await expect(page.locator(".card-management-shell .responsive-tabs-shell")).toBeVisible();
    await expectResponsiveTabsContained(page);
    await auditDesktopAndPhone(page, testInfo, "81-account-card-management");

    await page.getByRole("tab", { name: "Geräte" }).click();
    await expect(page.getByRole("heading", { name: "Angemeldete Geräte" })).toBeVisible();
    await auditDesktopAndPhone(page, testInfo, "82-account-devices");

    await page.getByRole("tab", { name: "Daten & Konto" }).click();
    await expect(page.getByRole("heading", { name: "Konto löschen" })).toBeVisible();
    await auditDesktopAndPhone(page, testInfo, "83-account-data-actions");
    await page.getByLabel(`Zur Bestätigung „${username}“ eingeben`).fill(username);
    await expect(page.getByRole("button", { name: "Endgültig löschen" })).toBeEnabled();
    await auditDesktopAndPhone(page, testInfo, "84-account-delete-confirmation-enabled");

    await page.goto("/play/");
    const continueGroupButton = page.getByRole("button", {
        name: `Gruppe fortsetzen: ${maximumGroupName}`,
    });
    await expect(continueGroupButton).toBeVisible();
    await expect(page.locator(".active-dataspace-indicator")).toContainText(maximumDataSpaceName);
    await auditDesktopAndPhone(page, testInfo, "85-home-authenticated-continue-menu-max");

    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Gruppe auswählen/ }).click();
    await expect(page.locator(".group-browser")).toBeVisible();
    await expect(page.locator(".group-browser-member-count")).toHaveText("50");
    await auditDesktopAndPhone(page, testInfo, "86-home-authenticated-saved-group-max");
    await expectWizardProgressLabelsOnOneLine(page);

    await page.getByRole("button", { name: /Neue Gruppe/ }).click();
    const homeGroupForm = page.locator(".group-create");
    await expect(homeGroupForm).toBeVisible();
    await homeGroupForm.getByLabel("Gruppenname").fill(`Neu${"G".repeat(77)}`);
    await homeGroupForm.getByLabel("Namen, durch Kommas getrennt").fill(maximumPlayerNames);
    await auditDesktopAndPhone(page, testInfo, "87-home-authenticated-new-group-max");
    await expectWizardProgressLabelsOnOneLine(page);

    await page.getByRole("button", { name: /Zurück/ }).click();
    await expect(continueGroupButton).toBeVisible();
    await continueGroupButton.click();
    await expect(maximumGroupRow).toHaveClass(/selected/);
    await auditDesktopAndPhone(page, testInfo, "88-home-authenticated-continued-group-max");
    await expectWizardProgressLabelsOnOneLine(page);
    await page.locator(".active-dataspace-indicator").press("Enter");
    await expect(page).toHaveURL(/\/play\/account\?returnTo=/);
    await expect(page.locator(".account-active-space strong")).toHaveText(maximumDataSpaceName);
});
