import { expect, test, type Page } from "@playwright/test";

async function reachCouch(page: Page, modeLabel: string) {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: new RegExp(modeLabel) }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Freunde / }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(page.getByRole("heading", { name: "Erlebnis anpassen" })).toBeVisible();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Nur dieser Bildschirm/ }).click();
    await page.getByRole("button", { name: /Weiter zur Lobby/ }).click();
    await expect(page).toHaveURL(/\/play\/couch$/);
}

async function createGame(page: Page, modeLabel: string) {
    await reachCouch(page, modeLabel);
    expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(1);
    await page.getByRole("button", { name: /Spiel starten/ }).click();
    await expect(page.getByText("Runde 1")).toBeVisible();
}

test("Couch Mode runs all four modes through the server-authoritative engine", async ({
    browser,
}) => {
    test.setTimeout(90_000);
    for (const mode of [
        "Wahrheit oder Pflicht",
        "Zufällige Wahl",
        "Ich hab noch nie",
        "Let's Talk",
    ]) {
        const context = await browser.newContext();
        const page = await context.newPage();
        await createGame(page, mode);
        if (mode === "Wahrheit oder Pflicht") {
            await page.getByRole("button", { name: "Wahrheit", exact: true }).click();
        } else {
            await page.getByRole("button", { name: "Karte aufdecken" }).click();
        }
        await expect(page.locator(".game-card")).toBeVisible();
        await context.close();
    }
});

test("main setup exposes Host, Join and Display and guards direct Host URLs", async ({ page }) => {
    await page.goto("/play/");
    await expect(page.getByRole("button", { name: /Spiel hosten/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Spiel beitreten/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Nur anzeigen/ })).toBeVisible();

    await page.goto("/play/host");
    await expect(page).toHaveURL(/\/play\/?$/);
    await expect(page.getByRole("button", { name: /Spiel hosten/ })).toBeVisible();
    await expect(page.getByText("Lobby", { exact: true })).toHaveCount(0);
});

test("Group step has exactly three choices and a new Group is immediately selected", async ({
    page,
}) => {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await expect(page.getByRole("button", { name: /Keine Gruppe/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Gruppe auswählen/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Neue Gruppe/ })).toBeVisible();
    await page.getByRole("button", { name: /Neue Gruppe/ }).click();
    const name = `Testgruppe ${Date.now()}`;
    await page.getByLabel("Gruppenname").fill(name);
    await page.getByLabel("Namen, durch Kommas getrennt").fill("Anna, Ben");
    await page.getByRole("button", { name: "Gruppe speichern" }).click();
    await expect(page.locator(".group-option.selected")).toContainText(name);
    await expect(page.getByRole("button", { name: /Gruppe auswählen/ })).toHaveClass(/selected/);
    await page.getByRole("button", { name: /Zurück/ }).click();
    await page.getByRole("button", { name: new RegExp(`Gruppe fortsetzen: ${name}`) }).click();
    await expect(page.locator(".group-option.selected")).toContainText(name);
    await expect(page.getByRole("button", { name: /^Weiter/ })).toBeEnabled();
});

test("Custom profile exposes the full shared customization editor", async ({ page }) => {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Wahrheit oder Pflicht/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Custom/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(page.getByRole("heading", { name: /Themen/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Arten von Pflichten/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Zusätzliche Inhaltsregeln/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "ALLTAG" })).toBeVisible();
    await expect(page.getByRole("button", { name: "KUSS", exact: true })).toBeVisible();
});

test("shared tabs and wizard progress stay within a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    const wizard = page.locator(".wizard");
    const progress = page.locator(".wizard-progress");
    await expect(progress).toBeVisible();
    expect((await progress.boundingBox())!.width).toBeLessThanOrEqual(
        (await wizard.boundingBox())!.width,
    );

    await page.getByLabel("Einstellungen").click();
    const modal = page.locator(".settings-modal");
    const tabs = page.locator(".responsive-tabs");
    expect((await tabs.boundingBox())!.width).toBeLessThanOrEqual(
        (await modal.boundingBox())!.width,
    );
    const displayTab = tabs.getByRole("tab", { name: /Darstellung/ });
    const before = await displayTab.boundingBox();
    await displayTab.click();
    const after = await displayTab.boundingBox();
    expect(Math.abs(after!.width - before!.width)).toBeLessThan(2);
    expect(Math.abs(after!.height - before!.height)).toBeLessThan(2);
});

test("Help opens in a new tab and AUTH_MODE=none hides Account", async ({ page }) => {
    await page.goto("/play/account");
    await expect(page).toHaveURL(/\/play\/?$/);
    await expect(page.getByRole("heading", { name: /Anmelden/ })).toHaveCount(0);
    await page.goto("/play/");
    await page.getByLabel("Einstellungen").click();
    await page.getByRole("tab", { name: /Hilfe & Konto/ }).click();
    const help = page.getByRole("link", { name: "Hilfe öffnen" });
    await expect(help).toHaveAttribute("target", "_blank");
    await expect(help).toHaveAttribute("rel", /noopener/);
    await expect(page.getByRole("link", { name: "Konto öffnen" })).toHaveCount(0);
    const popup = page.waitForEvent("popup");
    await help.click();
    await expect(await popup).toHaveURL(/\/play\/help$/);
});

test("beforeunload protection is enabled only after setup becomes meaningful", async ({ page }) => {
    await page.goto("/play/");
    const isProtected = () =>
        page.evaluate(() => {
            const event = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
        });
    expect(await isProtected()).toBe(false);
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    expect(await isProtected()).toBe(true);
});
