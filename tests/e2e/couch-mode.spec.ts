import { expect, test, type Page } from "@playwright/test";

async function reachCouch(
    page: Page,
    modeLabel: string,
    reveal: "anonymous" | "named" = "anonymous",
) {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: new RegExp(modeLabel) }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Freunde / }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(page.getByRole("heading", { name: "Erlebnis anpassen" })).toBeVisible();
    if (modeLabel === "Ich hab noch nie") {
        await page
            .getByRole("button", { name: reveal === "named" ? /^Antworten offen/ : /^Anonym/ })
            .click();
    }
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

test("card text remains centered on a narrow, short viewport", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await createGame(page, "Wahrheit oder Pflicht");
    await page.getByRole("button", { name: "Wahrheit", exact: true }).click();
    const card = page.locator(".game-card");
    const text = card.locator("p");
    await expect(text).toBeVisible();
    const cardBox = (await card.boundingBox())!;
    const textBox = (await text.boundingBox())!;
    const cardCenter = cardBox.y + cardBox.height / 2;
    const textCenter = textBox.y + textBox.height / 2;
    expect(Math.abs(textCenter - cardCenter)).toBeLessThan(cardBox.height * 0.2);
});

test("game card and actions fit medium and TV viewports without document scrolling", async ({
    browser,
}) => {
    for (const viewport of [
        { width: 1024, height: 768 },
        { width: 1920, height: 1080 },
    ]) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        await createGame(page, "Wahrheit oder Pflicht");
        await page.getByRole("button", { name: "Wahrheit", exact: true }).click();
        await expect(page.locator(".game-card")).toBeVisible();
        await expect(page.getByRole("button", { name: "Überspringen" })).toBeVisible();
        const viewportUsage = await page.evaluate(() => ({
            height: window.innerHeight,
            scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
        }));
        expect(viewportUsage.scrollHeight).toBeLessThanOrEqual(viewportUsage.height);
        const actionBox = (await page.locator(".actions").boundingBox())!;
        expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(viewport.height);
        const cardBox = (await page.locator(".game-card").boundingBox())!;
        expect(cardBox.width).toBeLessThanOrEqual(900);
        expect(cardBox.width / cardBox.height).toBeGreaterThan(1.45);
        expect(Math.abs(cardBox.x + cardBox.width / 2 - viewport.width / 2)).toBeLessThan(3);
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
    await page.setViewportSize({ width: 360, height: 740 });
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
    await expect(page.locator(".group-list-row.selected")).toContainText(name);
    const groupAction = page.getByRole("button", { name: new RegExp(name) });
    await groupAction.hover();
    await expect(groupAction).toHaveCSS("transform", "none");
    await expect(groupAction).toHaveCSS("box-shadow", "none");
    expect((await page.locator(".group-list").boundingBox())!.width).toBeLessThanOrEqual(
        (await page.locator(".wizard").boundingBox())!.width,
    );
    await expect(page.getByRole("button", { name: /Gruppe auswählen/ })).toHaveClass(/selected/);
    await page.getByRole("button", { name: /Zurück/ }).click();
    await page.getByRole("button", { name: new RegExp(`Gruppe fortsetzen: ${name}`) }).click();
    await expect(page.locator(".group-list-row.selected")).toContainText(name);
    await expect(page.getByRole("button", { name: /^Weiter/ })).toBeEnabled();
});

test("Custom profile exposes the full shared customization editor", async ({ page }) => {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(page.getByRole("button", { name: "Überspringen" })).toHaveCount(0);
    await page.getByRole("button", { name: /Wahrheit oder Pflicht/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Custom/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(page.getByRole("heading", { name: /Themen/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Arten von Pflichten/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Zusätzliche Inhaltsregeln/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "ALLTAG" })).toBeVisible();
    await expect(page.getByRole("button", { name: "KUSS", exact: true })).toBeVisible();
    await expect(
        page.getByRole("button", { name: /Deutsch \(Deutschland\).*de-DE/ }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: /English \(United Kingdom\).*en-GB/ }),
    ).toBeVisible();
});

test("Never Have I Ever reveal policy lives only in Customize Experience", async ({ page }) => {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Ich hab noch nie/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(
        page.getByRole("heading", { name: "Welche Stimmung passt zu euch?" }),
    ).toBeVisible();
    await expect(
        page.getByRole("heading", { name: "Wie sollen die Antworten aufgedeckt werden?" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /^Freunde / }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await expect(page.getByRole("heading", { name: "Erlebnis anpassen" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Anzeige der Antworten" })).toBeVisible();
    await expect(page.locator(".wizard-progress span")).toHaveCount(5);
});

test("Couch named Never Have I Ever uses public progress and neutral answer columns", async ({
    page,
}) => {
    await reachCouch(page, "Ich hab noch nie", "named");
    await page.getByRole("button", { name: /Spiel starten/ }).click();
    await page.getByRole("button", { name: "Karte aufdecken" }).click();
    await expect(page.getByText("Antworten werden aufgedeckt", { exact: true })).toBeVisible();
    const progress = page.locator(".vote-progress-list");
    await expect(progress).toContainText("Anna");
    await expect(progress).toContainText("Ben");
    await expect(progress.getByText("Wartet")).toHaveCount(2);

    await page
        .locator(".never-vote-row")
        .filter({ hasText: "Anna" })
        .getByRole("button", {
            name: "Trifft zu",
        })
        .click();
    await expect(progress.locator(".vote-progress-row").filter({ hasText: "Anna" })).toContainText(
        "Abgestimmt",
    );
    await expect(page.locator(".never-result-columns")).toHaveCount(0);

    await page
        .locator(".never-vote-row")
        .filter({ hasText: "Ben" })
        .getByRole("button", {
            name: "Trifft nicht zu",
        })
        .click();
    await expect(page.locator(".yes-column")).toContainText("Anna");
    await expect(page.locator(".no-column")).toContainText("Ben");
    await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await page.getByRole("tab", { name: "Aktuelle Spieleinstellungen" }).click();
    await expect(page.locator(".settings-modal")).toContainText("de-DE");
    await expect(page.locator(".settings-modal")).toContainText("Antworten werden aufgedeckt");
});

test("built-in profiles offer a validation-preserving Customize shortcut", async ({ page }) => {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Freunde / }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    const skip = page.getByRole("button", { name: /Überspringen/ });
    const next = page.getByRole("button", { name: /^Weiter/ });
    const styles = async (locator: typeof skip) =>
        locator.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
                background: style.backgroundColor,
                borderRadius: style.borderRadius,
                fontWeight: style.fontWeight,
                height: element.getBoundingClientRect().height,
                width: element.getBoundingClientRect().width,
            };
        });
    expect(await styles(skip)).toEqual(await styles(next));
    await skip.click();
    await expect(page.getByRole("heading", { name: /Bildschirme/ })).toBeVisible();
});

test("Couch lobby has canonical Settings and zero-card start stays with a warning", async ({
    page,
}) => {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Wahrheit oder Pflicht/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Custom/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Nur dieser Bildschirm/ }).click();
    await page.getByRole("button", { name: /Weiter zur Lobby/ }).click();
    await expect(page.getByLabel("Einstellungen")).toBeVisible();
    const backToMain = page.getByRole("button", { name: /Zurück zum Hauptmenü/ });
    await expect(backToMain).toBeVisible();
    await expect(backToMain).toHaveClass(/text-action/);
    await expect(backToMain).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const backBox = (await backToMain.boundingBox())!;
    const setupBox = (await page.locator(".player-setup").boundingBox())!;
    expect(backBox.y + backBox.height).toBeLessThanOrEqual(setupBox.y);
    const addPlayer = page.getByRole("button", { name: /Person hinzufügen/ });
    const start = page.getByRole("button", { name: /Spiel starten/ });
    const addBox = (await addPlayer.boundingBox())!;
    const startBox = (await start.boundingBox())!;
    expect(startBox.y - (addBox.y + addBox.height)).toBeGreaterThanOrEqual(12);
    await page.getByRole("button", { name: /Spiel starten/ }).click();
    await expect(page.getByRole("alert")).toContainText(
        "Mit dem aktuellen Profil und den Einstellungen sind keine Karten verfügbar.",
    );
    await expect(page.getByRole("heading", { name: "Wer spielt mit?" })).toBeVisible();
});

test("Couch end summary offers a clean return to the main menu", async ({ page }) => {
    await createGame(page, "Wahrheit oder Pflicht");
    await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Session" })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await page.getByRole("button", { name: "Spiel beenden" }).click();
    await expect(page.getByRole("heading", { name: /Gute Nacht/ })).toBeVisible();
    await page.getByRole("button", { name: "Zurück zum Hauptmenü" }).click();
    await expect(page).toHaveURL(/\/play\/?$/);
    await expect(page.getByRole("button", { name: /Spiel hosten/ })).toBeVisible();
});

test("same-device Couch player actions stay aligned on a narrow phone", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await reachCouch(page, "Wahrheit oder Pflicht");
    await page.getByRole("button", { name: /Person hinzufügen/ }).click();
    const row = page.locator(".player-name-row").last();
    await row.getByRole("textbox").fill("Eine sehr lange Person mit langem Namen");
    const input = (await row.getByRole("textbox").boundingBox())!;
    const remove = (await row.getByRole("button").boundingBox())!;
    expect(Math.abs(input.y + input.height / 2 - (remove.y + remove.height / 2))).toBeLessThan(4);
    expect((await row.boundingBox())!.width).toBeLessThanOrEqual(
        (await page.locator(".player-setup").boundingBox())!.width,
    );
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
    const viewport = page.locator(".responsive-tabs");
    const scrollBefore = await viewport.evaluate((element) => element.scrollLeft);
    const nextArrow = page.locator(".tab-scroll-arrow.next");
    await expect(nextArrow).toHaveCSS("box-shadow", "none");
    await expect(nextArrow).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    if (await nextArrow.isVisible()) {
        await nextArrow.click();
        await expect
            .poll(() => viewport.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(scrollBefore);
    }
});

test("Help topic tabs stay inside their article and support arrow scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/play/help");
    const panel = page.locator(".article-panel");
    const shell = page.locator(".responsive-tabs-shell");
    await expect(shell).toBeVisible();
    expect((await shell.boundingBox())!.width).toBeLessThanOrEqual(
        (await panel.boundingBox())!.width,
    );
    const viewport = page.locator(".responsive-tabs");
    const next = page.locator(".tab-scroll-arrow.next");
    if (await next.isVisible()) {
        await next.click();
        await expect
            .poll(() => viewport.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(0);
    }
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
