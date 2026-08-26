import { expect, test } from "@playwright/test";

const username = process.env.E2E_ADMIN_USERNAME ?? "tester";
const password = process.env.E2E_ADMIN_PASSWORD ?? "passw0rd!";

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

test("account entry keeps every authentication path themed and responsive", async ({ page }) => {
    await page.goto("/play/account");
    await expect(page.getByRole("heading", { name: "Anmelden", exact: true })).toBeVisible();
    await expect(page.locator(".account-login-card")).toBeVisible();
    const register = page.getByRole("button", { name: "Konto erstellen" });
    await expect(register).toBeVisible();
    expect((await register.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    const verticalDivider = page.locator(".account-choice-divider");
    const desktopDividerBox = (await verticalDivider.boundingBox())!;
    expect(desktopDividerBox.height).toBeGreaterThan(desktopDividerBox.width);

    const provider = page.locator(".account-provider-button");
    if ((await provider.count()) > 0) {
        await expect(provider).toBeVisible();
        await expect(provider).toHaveCSS("border-radius", "20px");
        expect(
            await provider.evaluate((element) => getComputedStyle(element).backgroundImage),
        ).not.toBe("none");
    }

    await page.setViewportSize({ width: 360, height: 740 });
    const horizontalDividerBox = (await verticalDivider.boundingBox())!;
    expect(horizontalDividerBox.width).toBeGreaterThan(horizontalDividerBox.height);
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
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
    await expect(page.locator(".account-tab-panel")).toHaveCSS("animation-name", "page-in");
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
        await expect(action).toHaveCSS("white-space", "nowrap");
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
    await page.getByPlaceholder("Zum Beispiel: Freundeskreis").fill("UX Bereich");
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
