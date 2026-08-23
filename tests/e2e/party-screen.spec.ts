import { expect, test, type Page } from "@playwright/test";

async function hostRoom(
    page: Page,
    screen: "personal" | "party" = "party",
    profile: RegExp = /^Freunde /,
    mode?: RegExp,
    reveal: "anonymous" | "named" = "anonymous",
) {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    if (mode) await page.getByRole("button", { name: mode }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: profile }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    if (mode?.test("Ich hab noch nie")) {
        await page
            .getByRole("button", { name: reveal === "named" ? /^Antworten offen/ : /^Anonym/ })
            .click();
    }
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page
        .getByRole("button", {
            name: screen === "party" ? /TV \+ Smartphones/ : /Alle mit eigenem Gerät/,
        })
        .click();
    await page.getByLabel("Name des Hosts").fill("Host Anna");
    await page.getByRole("button", { name: /Weiter zur Lobby/ }).click();
    await expect(page.getByRole("heading", { name: "Lobby" })).toBeVisible();
    return (await page.locator("main > header h1").textContent())!.trim();
}

async function joinRoom(page: Page, code: string, name: string, display = false) {
    await page.goto("/play/");
    await page.getByRole("button", { name: display ? /Nur anzeigen/ : /Spiel beitreten/ }).click();
    if (!display) await page.getByLabel("Dein Name").fill(name);
    await page.getByLabel("Raumcode").fill(code);
    await page.getByRole("button", { name: "Raum beitreten" }).click();
    await expect(page.getByRole("heading", { name: "Lobby" })).toBeVisible();
}

async function forbidDocumentTransitions(page: Page): Promise<void> {
    await page.evaluate(() => {
        document.documentElement.dataset.documentTransitionCalls = "0";
        Object.defineProperty(document, "startViewTransition", {
            configurable: true,
            value: () => {
                const current = Number(
                    document.documentElement.dataset.documentTransitionCalls ?? "0",
                );
                document.documentElement.dataset.documentTransitionCalls = String(current + 1);
                throw new Error("Document-level transition must not be used");
            },
        });
    });
}

async function expectCompactResultCard(page: Page): Promise<void> {
    const layout = await page.locator(".game-card.result-compact").evaluate((card) => {
        const bounds = card.getBoundingClientRect();
        const type = card.querySelector(".card-type")!.getBoundingClientRect();
        const text = card.querySelector("p")!.getBoundingClientRect();
        const intensity = card.querySelector(".dots")!.getBoundingClientRect();
        return {
            inside:
                type.top >= bounds.top - 1 &&
                intensity.bottom <= bounds.bottom + 1 &&
                text.left >= bounds.left - 1 &&
                text.right <= bounds.right + 1,
            ordered: type.bottom <= text.top + 1 && text.bottom <= intensity.top + 1,
        };
    });
    expect(layout.inside).toBe(true);
    expect(layout.ordered).toBe(true);
}

async function expectInsideViewport(page: Page, selector: string): Promise<void> {
    const bounds = await page.locator(selector).evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            left: box.left,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
        };
    });
    expect(bounds.top).toBeGreaterThanOrEqual(-1);
    expect(bounds.left).toBeGreaterThanOrEqual(-1);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth + 1);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight + 1);
}

test("host creates a Party Screen Room and exposes safe QR join information", async ({
    browser,
}) => {
    const hostContext = await browser.newContext();
    const displayContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const host = await hostContext.newPage();
    const code = await hostRoom(host);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    const display = await displayContext.newPage();
    await joinRoom(display, code, "", true);
    await expect(display.getByAltText(`QR-Code für Raum ${code}`)).toBeVisible();
    await expect(host.getByText("Party Screen", { exact: true })).toBeVisible();
    await expect(display.getByRole("button", { name: "Lobby verlassen" })).toBeVisible();
    await expect(display.locator(".public-stage-lobby")).toBeVisible();
    expect(
        await display.evaluate(
            () => document.scrollingElement!.scrollHeight <= window.innerHeight + 1,
        ),
    ).toBe(true);
    await hostContext.close();
    await displayContext.close();
});

test("settings, device players and transferred Host authority synchronize across reload", async ({
    browser,
}) => {
    test.setTimeout(60_000);
    const oldContext = await browser.newContext();
    const newContext = await browser.newContext();
    const thirdContext = await browser.newContext();
    const oldHost = await oldContext.newPage();
    const newHost = await newContext.newPage();
    const thirdPlayer = await thirdContext.newPage();
    const code = await hostRoom(oldHost, "personal");
    await joinRoom(newHost, code, "Ben");
    await joinRoom(thirdPlayer, code, "Carla");
    await expect(oldHost.getByText("Ben", { exact: true })).toBeVisible();
    await expect(oldHost.getByText("Carla", { exact: true })).toBeVisible();
    await expect(newHost.getByText("Carla", { exact: true })).toBeVisible();
    await expect(thirdPlayer.getByText("Ben", { exact: true })).toBeVisible();
    await expect(newHost.getByText("Host Anna", { exact: true })).toBeVisible();
    await expect(newHost.getByText(/Startintensität: 1 → Endintensität: 3/)).toBeVisible();

    await oldHost.getByRole("button", { name: "Spieleinstellungen bearbeiten" }).click();
    await expect(oldHost.locator(".number-input")).toBeVisible();
    await expect(
        oldHost.getByRole("button", { name: /Verringern: Steigerung alle/ }),
    ).toBeVisible();
    await expect(oldHost.getByRole("button", { name: /Erhöhen: Steigerung alle/ })).toBeVisible();
    await oldHost.getByRole("slider", { name: /Endintensität/ }).fill("2");
    await oldHost.getByRole("button", { name: "Nach Karten" }).click();
    await oldHost.getByRole("spinbutton", { name: /Steigerung alle/ }).fill("4");
    await oldHost.getByRole("slider", { name: /Stärke je Steigerung/ }).fill("0.5");
    await oldHost.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(newHost.getByRole("status")).toContainText(
        "Der Host hat die Spieleinstellungen geändert.",
    );
    await expect(thirdPlayer.getByRole("status")).toContainText(
        "Der Host hat die Spieleinstellungen geändert.",
    );
    await expect(newHost.getByText(/Startintensität: 1 → Endintensität: 2/)).toBeVisible();
    await newHost.getByRole("button", { name: "Spieleinstellungen ansehen" }).click();
    const changedSettings = newHost.locator(".current-settings-modal");
    await expect(changedSettings).toContainText("Alle 4 Karten · +0.5");
    await changedSettings.getByLabel("Einstellungen schließen").click();
    await expect(newHost.getByRole("status")).toHaveCount(0, { timeout: 7_000 });

    await oldHost.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await oldHost.getByRole("tab", { name: /Erweiterte Einstellungen/ }).click();
    await oldHost.getByLabel("Host-Aufgabe übertragen").selectOption({ label: "Ben" });
    await oldHost.getByRole("button", { name: "Übertragen" }).click();
    await expect(
        newHost.getByRole("button", { name: "Spieleinstellungen bearbeiten" }),
    ).toBeVisible();
    await expect(
        oldHost.getByRole("button", { name: "Spieleinstellungen bearbeiten" }),
    ).toHaveCount(0);
    await expect(oldHost.getByRole("button", { name: "Spiel starten" })).toHaveCount(0);

    newHost.once("dialog", (dialog) => dialog.accept());
    await newHost.reload();
    await expect(newHost.locator("main > header .eyebrow")).toHaveText("HOST");
    await expect(newHost.locator(".participant:not(.device-player)")).toHaveCount(3);
    await expect(newHost.getByRole("button", { name: "Spiel starten" })).toBeVisible();

    await newHost.setViewportSize({ width: 360, height: 740 });
    await newHost.getByRole("button", { name: /Person auf diesem Gerät/ }).click();
    const editor = newHost.locator(".player-name-row");
    await editor.getByRole("textbox").fill("Bea");
    const playersPanel = newHost.locator(".players");
    expect((await editor.boundingBox())!.width).toBeLessThanOrEqual(
        (await playersPanel.boundingBox())!.width,
    );
    await newHost.getByRole("button", { name: "Personen für dieses Gerät speichern" }).click();
    await expect(oldHost.locator(".participant.device-player").getByText("Bea")).toBeVisible();
    await expect(newHost.getByRole("button", { name: "Lobby verlassen" })).toBeVisible();

    await oldContext.close();
    await newContext.close();
    await thirdContext.close();
});

test("players can inspect complete public settings without private boundaries", async ({
    browser,
}) => {
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const code = await hostRoom(host, "personal", /^Freunde /, /Zufällige Wahl/);
    await joinRoom(player, code, "Ben");

    await player.getByRole("button", { name: "Spieleinstellungen ansehen" }).click();
    const modal = player.locator(".current-settings-modal");
    await expect(modal.getByRole("heading", { name: "Aktuelle Spieleinstellungen" })).toBeVisible();
    await expect(modal).toContainText("Fragenanteil");
    await expect(modal).toContainText("Startintensität");
    await expect(modal).toContainText("Endintensität");
    await expect(modal).toContainText("Alle 2 Karten · +1");
    await expect(modal).toContainText("Maximale Kartenfolge desselben Typs");
    await expect(modal).toContainText("Zusätzliche Inhaltsregeln");
    await expect(modal).toContainText("Deutsch (Deutschland) · de-DE");
    await expect(modal).not.toContainText("Private Grenzen gespeichert");
    await modal.getByLabel("Einstellungen schließen").click();

    await host.getByRole("button", { name: "Spiel starten" }).click();
    await expect(player.getByRole("button", { name: "Spieleinstellungen ansehen" })).toHaveCount(0);
    await host.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await expect(host.getByRole("tab", { name: "Session" })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await expect(host.getByRole("tab", { name: /Erweiterte Einstellungen/ })).toBeVisible();
    await host.getByRole("tab", { name: /Erweiterte Einstellungen/ }).click();
    await expect(host.getByLabel("Host-Aufgabe übertragen")).toBeVisible();
    await host.getByLabel("Einstellungen schließen").click();
    await player.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await expect(player.getByRole("tab", { name: "Raum" })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await player.getByRole("tab", { name: "Aktuelle Spieleinstellungen" }).click();
    const inGameSettings = player.locator(".settings-modal");
    await expect(inGameSettings).toContainText("Fragenanteil");
    await expect(inGameSettings).toContainText("Startintensität");
    await expect(inGameSettings).toContainText("Endintensität");
    await expect(inGameSettings).toContainText("Maximale Kartenfolge desselben Typs");
    await expect(inGameSettings).toContainText("Deutsch (Deutschland) · de-DE");
    await expect(inGameSettings).not.toContainText("Private Grenzen gespeichert");
    await hostContext.close();
    await playerContext.close();
});

test("a player joining during active play enters the authoritative Session roster", async ({
    browser,
}) => {
    const hostContext = await browser.newContext();
    const firstContext = await browser.newContext();
    const lateContext = await browser.newContext();
    const host = await hostContext.newPage();
    const first = await firstContext.newPage();
    const late = await lateContext.newPage();
    const code = await hostRoom(host, "personal");
    await joinRoom(first, code, "Ben");
    await host.getByRole("button", { name: "Spiel starten" }).click();
    await expect(first.getByText("Runde 1")).toBeVisible();

    await late.goto("/play/");
    await late.getByRole("button", { name: /Spiel beitreten/ }).click();
    await late.getByLabel("Dein Name").fill("Carla");
    await late.getByLabel("Raumcode").fill(code);
    await late.getByRole("button", { name: "Raum beitreten" }).click();

    await expect(late.getByText("Runde 1")).toBeVisible();
    for (const page of [host, first, late]) {
        await expect(page.locator(".live-players summary")).toContainText("3");
        await page.locator(".live-players summary").click();
        await expect(
            page.locator(".live-players").getByText("Carla", { exact: true }),
        ).toBeVisible();
    }

    await hostContext.close();
    await firstContext.close();
    await lateContext.close();
});

test("network loss enters reconnecting immediately and restores the same participant", async ({
    browser,
}) => {
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const code = await hostRoom(host, "personal");
    await joinRoom(player, code, "Ben");
    await expect(host.locator(".participant:not(.device-player)")).toHaveCount(2);

    await playerContext.setOffline(true);
    await expect(player.locator(".reconnect-panel")).toContainText(
        "Verbindung wird wiederhergestellt",
        { timeout: 2_000 },
    );
    await playerContext.setOffline(false);
    await expect(player.getByRole("heading", { name: "Lobby" })).toBeVisible({ timeout: 5_000 });
    await expect(host.locator(".participant:not(.device-player)")).toHaveCount(2);
    await expect(player).toHaveURL(/\/play\/room$/);

    await hostContext.close();
    await playerContext.close();
});

test("hosted players see Card intensity and shared game/modal transitions", async ({ browser }) => {
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const code = await hostRoom(host, "personal");
    await joinRoom(player, code, "Ben");
    await host.getByRole("button", { name: "Spiel starten" }).click();
    const hostChoice = host.getByRole("button", { name: "Wahrheit", exact: true });
    const playerChoice = player.getByRole("button", { name: "Wahrheit", exact: true });
    await expect
        .poll(async () => (await hostChoice.isVisible()) || playerChoice.isVisible())
        .toBe(true);
    const chooser = (await hostChoice.isVisible()) ? host : player;
    await chooser.getByRole("button", { name: "Wahrheit", exact: true }).click();

    for (const page of [host, player]) {
        await expect(page.locator(".game-card .dots")).toBeVisible();
        await expect(page.locator(".game-card")).toHaveCSS("animation-name", "card-enter");
        await expect(page.locator(".game-card .dots")).toHaveAttribute(
            "aria-label",
            /Intensität [1-5]/,
        );
        await expect(page.locator(".game-phase")).toHaveCSS("animation-name", "phase-enter");
    }

    const settingsButton = host.getByRole("button", { name: "Einstellungen", exact: true });
    await host.emulateMedia({ reducedMotion: "no-preference" });
    const modalDurations = await settingsButton.evaluate(async (button) => {
        button.click();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const backdrop = document.querySelector(".modal-backdrop");
        return (
            backdrop
                ?.getAnimations({ subtree: true })
                .map((animation) => Number(animation.effect?.getTiming().duration ?? 0)) ?? []
        );
    });
    await expect(host.locator(".settings-modal")).toBeVisible();
    expect(modalDurations.some((duration) => duration >= 160)).toBe(true);

    await hostContext.close();
    await playerContext.close();
});

test("named Never Have I Ever synchronizes private progress then public answer columns", async ({
    browser,
}) => {
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const displayContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const display = await displayContext.newPage();
    const code = await hostRoom(host, "party", /^Freunde /, /Ich hab noch nie/, "named");
    await joinRoom(player, code, "Ben");
    await joinRoom(display, code, "", true);
    await expect(player.locator(".room-settings-summary")).toContainText("Deutsch (Deutschland)");
    await expect(player.locator(".room-settings-summary")).toContainText(
        "Antworten werden aufgedeckt",
    );

    await host.getByRole("button", { name: "Spiel starten" }).click();
    await host.getByRole("button", { name: "Karte aufdecken" }).click();
    for (const page of [host, player, display]) {
        await expect(page.getByText("Antworten werden aufgedeckt", { exact: true })).toBeVisible();
        await expect(page.locator(".vote-progress-list")).toContainText("Host Anna");
        await expect(page.locator(".vote-progress-list")).toContainText("Ben");
        await expect(page.locator(".never-result-columns")).toHaveCount(0);
    }
    const progressCard = await display.locator(".game-card").boundingBox();
    const progressPanel = await display.locator(".never-voting").boundingBox();
    expect(progressCard!.height).toBeGreaterThan(progressPanel!.height * 1.2);

    await host.getByRole("button", { name: "Trifft zu" }).click();
    await expect(
        display.locator(".vote-progress-row").filter({ hasText: "Host Anna" }),
    ).toContainText("Abgestimmt");
    await expect(display.locator(".vote-progress-row").filter({ hasText: "Ben" })).toContainText(
        "Wartet",
    );
    await expect(display.locator(".never-voting")).not.toContainText("Trifft zu");

    await player.getByRole("button", { name: "Trifft nicht zu" }).click();
    for (const page of [host, player, display]) {
        await expect(page.locator(".yes-column")).toContainText("Host Anna");
        await expect(page.locator(".no-column")).toContainText("Ben");
    }
    await expect
        .poll(async () => {
            const cardBox = await display.locator(".game-card").boundingBox();
            const panelBox = await display.locator(".never-voting").boundingBox();
            return panelBox!.width / cardBox!.width;
        })
        .toBeGreaterThan(1.5);
    const resultCard = await display.locator(".game-card").boundingBox();
    const resultPanel = await display.locator(".never-voting").boundingBox();
    expect(resultPanel!.height).toBeGreaterThan(resultCard!.height * 1.5);
    await expect(display.locator(".gameplay-focus.voting-results")).toHaveCSS(
        "transition-duration",
        /0\.46s/,
    );
    expect(
        await display.evaluate(
            () => document.scrollingElement!.scrollHeight <= window.innerHeight + 1,
        ),
    ).toBe(true);
    await expectCompactResultCard(display);

    await display.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await expect(display.getByRole("tab", { name: "Aktuelle Spieleinstellungen" })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await expect(display.locator(".settings-modal")).toContainText("Deutsch (Deutschland) · de-DE");
    await expect(display.locator(".settings-modal")).toContainText("Antworten werden aufgedeckt");
    await expect(display.getByRole("tab", { name: /Erweiterte Einstellungen/ })).toHaveCount(0);
    await display.getByLabel("Einstellungen schließen").click();

    await hostContext.close();
    await playerContext.close();
    await displayContext.close();
});

test("anonymous Never Have I Ever uses a compact aggregate on a short display", async ({
    browser,
}) => {
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const displayContext = await browser.newContext({ viewport: { width: 640, height: 360 } });
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const display = await displayContext.newPage();
    const code = await hostRoom(host, "party", /^Freunde /, /Ich hab noch nie/, "anonymous");
    await joinRoom(player, code, "Ben");
    await joinRoom(display, code, "", true);

    await host.getByRole("button", { name: "Spiel starten" }).click();
    await host.getByRole("button", { name: "Karte aufdecken" }).click();
    await host.getByRole("button", { name: "Trifft zu" }).click();
    await player.getByRole("button", { name: "Trifft nicht zu" }).click();

    for (const page of [host, player, display]) {
        await expect(page.locator(".anonymous-result")).toBeVisible();
        await expect(page.locator(".aggregate-split")).toBeVisible();
        await expect(page.locator(".aggregate-metric")).toHaveCount(2);
        await expect(page.locator(".never-result-columns")).toHaveCount(0);
        await expect(page.locator(".answer-name-list")).toHaveCount(0);
    }
    await expect(display.locator(".aggregate-total")).toContainText("2");
    await expectCompactResultCard(display);
    expect(
        await display.evaluate(
            () => document.scrollingElement!.scrollHeight <= window.innerHeight + 1,
        ),
    ).toBe(true);

    await display.setViewportSize({ width: 480, height: 640 });
    await expect
        .poll(async () => {
            const card = await display.locator(".game-card").boundingBox();
            const result = await display.locator(".never-voting").boundingBox();
            return Boolean(card && result && card.y + card.height <= result.y + 1);
        })
        .toBe(true);
    await expectCompactResultCard(display);
    expect(
        await display.evaluate(
            () => document.scrollingElement!.scrollHeight <= window.innerHeight + 1,
        ),
    ).toBe(true);

    await hostContext.close();
    await playerContext.close();
    await displayContext.close();
});

test("leaving notifies every remaining device and a clean rejoin keeps Settings closed", async ({
    browser,
}) => {
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const displayContext = await browser.newContext();
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const display = await displayContext.newPage();
    const code = await hostRoom(host, "party");
    await joinRoom(player, code, "Ben");
    await joinRoom(display, code, "", true);

    await player.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await expect(player.getByRole("tab", { name: "Inhalte" })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    await player.getByRole("tab", { name: "Raum" }).click();
    await player.getByRole("button", { name: "Spiel verlassen" }).click();
    await expect(player).toHaveURL(/\/play\/?$/);
    for (const page of [host, display]) {
        await expect(page.getByRole("status")).toContainText("Ben hat den Raum verlassen.");
    }

    await player.getByRole("button", { name: /Spiel beitreten/ }).click();
    await player.getByLabel("Dein Name").fill("Ben zurück");
    await player.getByLabel("Raumcode").fill(code);
    await player.getByRole("button", { name: "Raum beitreten" }).click();
    await expect(player.getByRole("heading", { name: "Lobby" })).toBeVisible();
    await expect(player.locator(".settings-modal")).toHaveCount(0);

    await hostContext.close();
    await playerContext.close();
    await displayContext.close();
});

test("small public displays automatically page long voting rosters and named results", async ({
    browser,
}) => {
    test.setTimeout(75_000);
    const hostContext = await browser.newContext();
    const displayContext = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const host = await hostContext.newPage();
    const display = await displayContext.newPage();
    const code = await hostRoom(host, "party", /^Freunde /, /Ich hab noch nie/, "named");

    for (let index = 0; index < 11; index += 1) {
        await host.getByRole("button", { name: /Person auf diesem Gerät/ }).click();
        await host
            .locator(".player-name-row")
            .last()
            .locator("input")
            .fill(`Person ${index + 2}`);
    }
    await host.getByRole("button", { name: "Personen für dieses Gerät speichern" }).click();
    await joinRoom(display, code, "", true);
    await expectInsideViewport(display, ".public-stage-lobby");
    await expectInsideViewport(display, ".public-stage-lobby .stage-player-roster");
    await expectInsideViewport(display, ".public-stage-lobby .join-card");
    await host.getByRole("button", { name: "Spiel starten" }).click();
    await host.getByRole("button", { name: "Karte aufdecken" }).click();

    const displayVoting = display.locator(".never-voting");
    await expect(display.locator(".public-stage")).toBeVisible();
    await expect(display.locator(".game-card")).toBeVisible();
    await expectInsideViewport(display, ".game-card");
    await expectInsideViewport(display, ".never-voting");
    await expect(displayVoting.locator(".auto-page-status")).toBeVisible();
    const firstProgressPage = await displayVoting.locator(".vote-progress-list").innerText();
    await expect
        .poll(() => displayVoting.locator(".vote-progress-list").innerText(), { timeout: 7_000 })
        .not.toBe(firstProgressPage);
    await expect(display.locator(".game-card")).toBeVisible();
    expect(
        await display.evaluate(
            () => document.scrollingElement!.scrollHeight <= window.innerHeight + 1,
        ),
    ).toBe(true);

    for (let remaining = 12; remaining > 0; remaining -= 1) {
        await host
            .locator(".never-vote-row")
            .first()
            .getByRole("button", { name: "Trifft zu" })
            .click();
    }
    await expect(display.locator(".yes-column")).toBeVisible();
    await expect(display.locator(".no-column")).toBeVisible();
    await expect(display.locator(".game-card")).toBeVisible();
    await expect(display.locator(".yes-column .auto-page-status")).toBeVisible();
    const firstResultPage = await display.locator(".yes-column .answer-name-list").innerText();
    await expect
        .poll(() => display.locator(".yes-column .answer-name-list").innerText(), {
            timeout: 7_000,
        })
        .not.toBe(firstResultPage);
    expect(
        await display.evaluate(
            () => document.scrollingElement!.scrollHeight <= window.innerHeight + 1,
        ),
    ).toBe(true);
    await expectCompactResultCard(display);
    await expectInsideViewport(display, ".never-voting");

    await host.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await host.getByRole("tab", { name: "Session" }).click();
    await host.getByRole("button", { name: "Spiel beenden" }).click();
    await expect(display.getByRole("heading", { name: /Gute Nacht/ })).toBeVisible();
    await expectInsideViewport(display, ".ended-stage");
    await expectInsideViewport(display, ".ended-stage .session-summary");
    expect(
        await display.evaluate(
            () => document.scrollingElement!.scrollHeight <= window.innerHeight + 1,
        ),
    ).toBe(true);

    await hostContext.close();
    await displayContext.close();
});

test("New Game reuses the Room for Host, Player, and Display", async ({ browser }) => {
    test.setTimeout(60_000);
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const displayContext = await browser.newContext();
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const display = await displayContext.newPage();
    const code = await hostRoom(host, "party");
    await joinRoom(player, code, "Ben");
    await joinRoom(display, code, "", true);

    await host.getByRole("button", { name: "Spiel starten" }).click();
    await expect(player.getByText("Runde 1")).toBeVisible();
    await expect(display.getByText("Runde 1")).toBeVisible();
    await host.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await host.getByRole("tab", { name: "Session" }).click();
    await host.getByRole("button", { name: "Spiel beenden" }).click();
    await expect(host.getByRole("heading", { name: /Gute Nacht/ })).toBeVisible();
    await expect(player.getByRole("heading", { name: /Gute Nacht/ })).toBeVisible();
    await expect(display.getByRole("heading", { name: /Gute Nacht/ })).toBeVisible();
    await expect(host.getByRole("button", { name: "Raum schließen" })).toBeVisible();
    await expect(player.getByRole("button", { name: "Raum verlassen" })).toBeVisible();
    await expect(display.getByRole("button", { name: "Raum verlassen" })).toBeVisible();
    await host.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await expect(host.getByRole("tab", { name: "Audio" })).toHaveAttribute("aria-selected", "true");
    await host.getByLabel("Einstellungen schließen").click();

    await host.getByRole("button", { name: "Neues Spiel" }).click();
    await expect(host.getByRole("heading", { name: "Einstellungen", exact: true })).toBeVisible();
    await host.getByLabel("Einstellungen schließen").click();
    for (const page of [host, player, display]) {
        await expect(page.getByRole("heading", { name: "Lobby" })).toBeVisible();
        await expect(page).toHaveURL(/\/play\/room$/);
    }
    await expect(host.locator(".participant:not(.device-player)")).toHaveCount(3);
    await host.getByRole("button", { name: "Spiel starten" }).click();
    await expect(player.getByText("Runde 1")).toBeVisible();
    await expect(display.getByText("Runde 1")).toBeVisible();

    await hostContext.close();
    await playerContext.close();
    await displayContext.close();
});

test("Host closes an active Room and every device returns cleanly to the main menu", async ({
    browser,
}) => {
    test.setTimeout(60_000);
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const displayContext = await browser.newContext();
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const display = await displayContext.newPage();
    const code = await hostRoom(host, "party");
    await joinRoom(player, code, "Ben");
    await joinRoom(display, code, "", true);
    await host.getByRole("button", { name: "Spiel starten" }).click();
    await expect(player.getByText("Runde 1")).toBeVisible();
    for (const page of [host, player, display]) await forbidDocumentTransitions(page);

    await host.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await host.getByRole("tab", { name: "Session" }).click();
    host.once("dialog", (dialog) => dialog.accept());
    await host.getByRole("button", { name: "Raum schließen" }).click();

    for (const page of [host, player, display]) {
        await expect(page).toHaveURL(/\/play\/?$/);
        await expect(page.getByRole("button", { name: /Spiel hosten/ })).toBeVisible();
        await expect(page.locator(".app-location")).toHaveCSS("animation-name", "none");
        await expect(page.locator(".home-phase-transition")).toHaveCSS(
            "animation-name",
            "phase-enter",
        );
        await expect(page.locator("html")).toHaveAttribute("data-document-transition-calls", "0");
        await expect(page.getByRole("status")).toContainText(
            "Der Host hat den Raum geschlossen. Du bist zurück im Hauptmenü.",
        );
    }
    await expect(player.getByRole("status")).toHaveCount(0, { timeout: 7_000 });
    await player.reload();
    await expect(player).toHaveURL(/\/play\/?$/);
    await expect(player.getByRole("heading", { name: "Lobby" })).toHaveCount(0);

    await hostContext.close();
    await playerContext.close();
    await displayContext.close();
});

test("hosted zero-card settings are rejected without leaving the lobby", async ({ browser }) => {
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const code = await hostRoom(host, "personal", /^Custom /);
    await joinRoom(player, code, "Ben");
    await host.getByRole("button", { name: "Spiel starten" }).click();
    await expect(host.getByRole("alert")).toContainText("Keine Karte erfüllt alle aktiven Regeln.");
    await expect(host.locator(".notification-toast")).toHaveCSS("position", "fixed");
    await expect(host.locator(".room-error, .error, .notice")).toHaveCount(0);
    await expect(host.getByRole("heading", { name: "Lobby" })).toBeVisible();
    await expect(player.getByRole("heading", { name: "Lobby" })).toBeVisible();
    await expect(host.getByRole("alert")).toHaveCount(0, { timeout: 7_000 });
    await hostContext.close();
    await playerContext.close();
});
