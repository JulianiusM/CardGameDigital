import { expect, test, type Page } from "@playwright/test";
import os from "node:os";
import { captureVisualAudit } from "./visual-audit-helpers";
import { localNetworkInterfaceAllowed } from "../../apps/server/src/modules/localNetworkInterfaces";

test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
        if (!localStorage.getItem("party-game.locale"))
            localStorage.setItem("party-game.locale", "de");
    });
});

async function hostRoom(
    page: Page,
    screen: "personal" | "party" = "personal",
    profile: RegExp = /^Gute Freunde /,
    mode?: RegExp,
    reveal: "anonymous" | "named" = "anonymous",
    startUrl = "/play/",
) {
    await page.goto(startUrl);
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    if (mode) await page.getByRole("button", { name: mode }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    const profileOption = page.getByRole("button", { name: profile });
    const customProfile = /^Custom\b/.test((await profileOption.innerText()).trim());
    await profileOption.click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    if (customProfile) {
        const questions = page.locator(".settings-section-card", {
            has: page.getByRole("heading", { name: /Themen/ }),
        });
        const dares = page.locator(".settings-section-card", {
            has: page.getByRole("heading", { name: /Arten von Pflichten/ }),
        });
        await questions.getByRole("button", { name: "Keine aktiv" }).click();
        await dares.getByRole("button", { name: "Keine aktiv" }).click();
    }
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
    if (screen === "personal") await page.getByLabel("Name des Hosts").fill("Host Anna");
    await page.getByRole("button", { name: /Weiter zur Lobby/ }).click();
    await expect(page.getByRole("heading", { name: "Lobby" })).toBeVisible();
    return (await page.locator("main > header h1").textContent())!.trim();
}

async function joinRoom(
    page: Page,
    code: string,
    name: string,
    display = false,
    startUrl = "/play/",
) {
    await page.goto(startUrl);
    await page.getByRole("button", { name: display ? /Nur anzeigen/ : /Spiel beitreten/ }).click();
    if (!display) await page.getByLabel("Dein Name").fill(name);
    await page.getByLabel("Raumcode").fill(code);
    await page.getByRole("button", { name: "Raum beitreten" }).click();
    await expect(page.getByRole("heading", { name: "Lobby" })).toBeVisible();
}

function physicalLanIpv4Address(): string | null {
    const policy = { mdnsInterfaceAllowlist: [], mdnsInterfaceDenylist: [] };
    for (const [interfaceName, addresses] of Object.entries(os.networkInterfaces())) {
        if (!addresses || !localNetworkInterfaceAllowed(interfaceName, policy)) continue;
        const address = addresses.find((entry) => entry.family === "IPv4" && !entry.internal);
        if (address) return address.address;
    }
    return null;
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
        const intensity = card.querySelector(".intensity-pair")!.getBoundingClientRect();
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

async function expectInsideViewportDuringMotion(
    page: Page,
    selectors: readonly string[],
    durationMs: number,
): Promise<void> {
    const maximumOverflow = await page.evaluate(
        async ({ selectors: observedSelectors, durationMs: observedDuration }) => {
            const elements = observedSelectors.map((selector) => {
                const element = document.querySelector(selector);
                if (!(element instanceof HTMLElement)) {
                    throw new Error(`Missing motion geometry target: ${selector}`);
                }
                return element;
            });
            let worstOverflow = Number.NEGATIVE_INFINITY;
            const sample = () => {
                for (const element of elements) {
                    const bounds = element.getBoundingClientRect();
                    worstOverflow = Math.max(
                        worstOverflow,
                        -bounds.top,
                        -bounds.left,
                        bounds.right - window.innerWidth,
                        bounds.bottom - window.innerHeight,
                    );
                }
            };
            sample();
            const startedAt = performance.now();
            await new Promise<void>((resolve) => {
                const observeFrame = (now: number) => {
                    sample();
                    if (now - startedAt >= observedDuration) {
                        resolve();
                        return;
                    }
                    requestAnimationFrame(observeFrame);
                };
                requestAnimationFrame(observeFrame);
            });
            return worstOverflow;
        },
        { selectors, durationMs },
    );
    expect(maximumOverflow).toBeLessThanOrEqual(1);
}

test("taxonomy copy follows the Card language in settings and private boundaries", async ({
    browser,
}) => {
    test.setTimeout(60_000);
    const expectedQuestionOrder = [
        "Alltag",
        "Kindheit",
        "Persönlichkeit",
        "Szenario",
        "Rausch",
        "Freundschaft",
        "Beziehung",
        "Körper",
        "Sexualität",
        "Sexuelle Offenheit",
        "Sexuelle Vorlieben",
        "Sexuelle Erfahrung",
    ];
    const expectedDareOrder = [
        "Unsinn",
        "Unbeteiligte Dritte",
        "Freundschaftliche Küsse",
        "Intime Küsse",
        "Einfache Berührung",
        "Nahegehende Berührung",
        "Intime Berührung",
        "Kleidung",
        "Nacktheit",
        "Sexuelle Spannung",
        "Borderline Sex",
        "Sex",
        "Sonstiges",
    ];
    const context = await browser.newContext({
        locale: "en-GB",
        viewport: { width: 360, height: 740 },
    });
    const page = await context.newPage();

    await page.goto("/play/");
    await page.getByRole("button", { name: /Host game/ }).click();
    await page.getByRole("button", { name: /No group/ }).click();
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.getByRole("button", { name: /Truth or Dare/ }).click();
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.getByRole("button", { name: /^Good friends / }).click();
    await page.getByRole("button", { name: /^Next/ }).click();

    await page.getByLabel("Card language", { exact: true }).fill("Deutsch");
    await page.getByRole("option", { name: /Deutsch \(Deutschland\)/ }).click();
    await expect(page.getByRole("button", { name: "Körper", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Body", exact: true })).toHaveCount(0);
    const questionSettings = page
        .getByRole("heading", { name: "Which topics would you like to discuss?" })
        .locator("../..");
    const dareSettings = page
        .getByRole("heading", { name: "Which kinds of dares are okay?" })
        .locator("../..");
    await expect(questionSettings.locator(".toggle-chip-grid button")).toHaveText(
        expectedQuestionOrder,
    );
    await expect(dareSettings.locator(".toggle-chip-grid button")).toHaveText(expectedDareOrder);

    await page.getByRole("button", { name: /^Next/ }).click();
    await page.getByRole("button", { name: /One device each/ }).click();
    await page.getByLabel("Host name").fill("Host Anna");
    await page.getByRole("button", { name: /Continue to lobby/ }).click();
    await page.locator("details.advanced > summary").click();

    const boundaries = page.locator(".boundary-panel");
    const questions = boundaries.getByRole("group", { name: "Skip these question topics" });
    const dares = boundaries.getByRole("group", { name: "Skip these dare types" });
    await expect(questions.getByRole("checkbox")).toHaveCount(12);
    await expect(dares.getByRole("checkbox")).toHaveCount(13);
    await expect(questions.locator("label")).toHaveText(expectedQuestionOrder);
    await expect(dares.locator("label")).toHaveText(expectedDareOrder);
    await expect(questions.getByText("Körper", { exact: true })).toBeVisible();
    await expect(questions.getByText("Body", { exact: true })).toHaveCount(0);
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);

    await context.close();
});

test("an IPv6 page origin completes the Room WebSocket handshake", async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    if (!baseURL) throw new Error("Playwright baseURL is required");
    const configuredUrl = new URL(baseURL);
    const port = configuredUrl.port ? `:${configuredUrl.port}` : "";
    const ipv6PlayUrl = `${configuredUrl.protocol}//[::1]${port}/play/`;
    const context = await browser.newContext({ locale: "de-DE" });
    const page = await context.newPage();

    const code = await hostRoom(
        page,
        "personal",
        /^Gute Freunde /,
        undefined,
        "anonymous",
        ipv6PlayUrl,
    );

    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    await expect(page.locator(".reconnect-panel")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Spiel starten" })).toBeVisible();
    await context.close();
});

test("a plain-HTTP LAN origin sends client.hello and joins the Room", async ({
    browser,
    baseURL,
}) => {
    test.setTimeout(60_000);
    if (!baseURL) throw new Error("Playwright baseURL is required");
    const address = physicalLanIpv4Address();
    // Multicast join URLs require an actual LAN interface, which some CI workers lack.
    test.skip(!address, "No physical IPv4 interface is available");
    const configuredUrl = new URL(baseURL);
    const port = configuredUrl.port ? `:${configuredUrl.port}` : "";
    const lanPlayUrl = `${configuredUrl.protocol}//${address}${port}/play/`;
    const hostContext = await browser.newContext({ locale: "de-DE" });
    const playerContext = await browser.newContext({ locale: "de-DE" });
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const code = await hostRoom(host, "personal");

    await joinRoom(player, code, "LAN Player", false, lanPlayUrl);

    expect(await player.evaluate(() => globalThis.isSecureContext)).toBe(false);
    await expect(player.locator(".reconnect-panel")).toHaveCount(0);
    await expect(host.getByText("LAN Player", { exact: true })).toBeVisible();
    await hostContext.close();
    await playerContext.close();
});

test("TV setup opens a display-only Room and the first phone becomes Host", async ({ browser }) => {
    test.setTimeout(60_000);
    const phoneContext = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 360, height: 740 },
    });
    const displayContext = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 1920, height: 1080 },
    });
    const display = await displayContext.newPage();
    const advertisedOrigins = Array.from(
        { length: 30 },
        (_, index) => `http://10.23.0.${index + 10}:3001`,
    );
    await display.route("**/api/v1/server-info", async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as {
            roomAccess: { configuredBaseUrl: string | null; availableBaseUrls: string[] };
        };
        body.roomAccess = {
            configuredBaseUrl: null,
            availableBaseUrls: advertisedOrigins,
        };
        await route.fulfill({ response, json: body });
    });
    const code = await hostRoom(display, "party", /^Gute Freunde /);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    await expect(display.getByAltText(`QR-Code für Raum ${code}`)).toBeVisible();
    await expect(display.locator(".host-status-banner")).toContainText(
        "Wartet auf den ersten Host",
    );
    await expect(display.locator(".public-stage-lobby")).toBeVisible();
    const expectedJoinUrl = `${new URL(display.url()).origin}/play/?room=${code}`;
    await expect(display.locator(".room-availability-urls.auto-page")).toContainText(
        expectedJoinUrl,
    );
    const urlPager = display.locator(".room-url-pages .auto-page-text");
    const completeUrlCopy = [
        expectedJoinUrl,
        ...advertisedOrigins.map((origin) => `${origin}/play/?room=${code}`),
    ].join("\n");
    await expect(urlPager.locator(".auto-page-copy").first()).toHaveAttribute(
        "aria-label",
        completeUrlCopy,
    );
    await expect
        .poll(async () => Number(await urlPager.getAttribute("data-page-count")))
        .toBeGreaterThan(1);
    const tallPageCount = Number(await urlPager.getAttribute("data-page-count"));
    await display.setViewportSize({ width: 1280, height: 600 });
    await expect
        .poll(async () => Number(await urlPager.getAttribute("data-page-count")))
        .toBeGreaterThan(tallPageCount);
    await expectInsideViewport(display, ".public-stage-lobby .join-card");
    await display.setViewportSize({ width: 1920, height: 1080 });

    const phone = await phoneContext.newPage();
    await joinRoom(phone, code, "Host Anna");
    await expect(phone.getByRole("button", { name: "Spiel starten" })).toBeVisible();
    await expect(display.locator(".host-status-banner")).toContainText(
        "Host Anna steuert das Spiel",
    );
    await expect(phone.getByText("Party Screen", { exact: true })).toBeVisible();
    await expect(display.getByRole("button", { name: "Lobby verlassen" })).toBeVisible();
    await expect(phone.locator(".lobby .eligibility-preview")).toContainText("geeignete Karten");
    const displayEligibility = display.locator(".room-settings-actions > .eligibility-preview");
    await expect(displayEligibility).toContainText("geeignete Karten");
    expect((await displayEligibility.boundingBox())!.height).toBeLessThanOrEqual(52);
    await expect(display.locator(".stage-player-roster")).toBeVisible();
    await expect(phone.locator(".room-size")).toContainText(/1 \/ \d+ Personen/);
    await expect(display.locator(".room-size")).toContainText(/1 \/ \d+ Personen/);
    expect(
        await display.evaluate(
            () => document.scrollingElement!.scrollHeight <= window.innerHeight + 1,
        ),
    ).toBe(true);
    await expect
        .poll(() => phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    await phone.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await phone.getByRole("tab", { name: "Raum" }).click();
    const leaveRoom = phone.getByRole("button", { name: "Spiel verlassen" });
    const settingsJoinInfo = phone.locator(".settings-join-info");
    await expect(settingsJoinInfo.locator(".room-availability-urls")).toContainText(
        expectedJoinUrl,
    );
    await expect(leaveRoom).toBeVisible();
    expect((await leaveRoom.boundingBox())!.y).toBeLessThan(
        (await settingsJoinInfo.boundingBox())!.y,
    );

    const joinOnlyDisplay = await phoneContext.newPage();
    await joinOnlyDisplay.goto("/play/");
    await joinOnlyDisplay.getByRole("button", { name: /Nur anzeigen/ }).click();
    await expect(joinOnlyDisplay.getByLabel("Raumcode")).toBeVisible();
    await expect(joinOnlyDisplay.getByRole("button", { name: "Raum beitreten" })).toBeVisible();

    await phoneContext.close();
    await displayContext.close();
});

test("settings, device players and transferred Host authority synchronize across reload", async ({
    browser,
}) => {
    test.setTimeout(60_000);
    const oldContext = await browser.newContext({ locale: "de-DE" });
    const newContext = await browser.newContext({ locale: "de-DE" });
    const thirdContext = await browser.newContext({ locale: "de-DE" });
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
    for (const page of [oldHost, newHost, thirdPlayer]) {
        await expect(page.locator(".room-size")).toContainText(/3 \/ \d+ Personen/);
    }
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
    const transferPicker = oldHost.locator(".host-transfer-control .wrapping-select");
    await transferPicker.locator(":scope > summary").click();
    await transferPicker
        .locator(".wrapping-select-options")
        .getByRole("button", { name: "Ben", exact: true })
        .click();
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
    await expect(newHost.getByText("Personen auf diesem Gerät sind gespeichert")).toBeVisible();
    await expect(oldHost.locator(".participant.device-player").getByText("Bea")).toBeVisible();
    await expect(newHost.getByRole("button", { name: "Lobby verlassen" })).toBeVisible();

    await oldContext.close();
    await newContext.close();
    await thirdContext.close();
});

test("players can inspect complete public settings without private boundaries", async ({
    browser,
}) => {
    const hostContext = await browser.newContext({ locale: "de-DE" });
    const playerContext = await browser.newContext({ locale: "de-DE" });
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const code = await hostRoom(host, "personal", /^Gute Freunde /, /Zufällige Wahl/);
    await joinRoom(player, code, "Ben");

    await player.getByRole("button", { name: "Spieleinstellungen ansehen" }).click();
    const modal = player.locator(".current-settings-modal");
    await expect(modal.getByRole("heading", { name: "Aktuelle Spieleinstellungen" })).toBeVisible();
    await expect(modal).toContainText("Fragenanteil");
    await expect(modal).toContainText("Startintensität");
    await expect(modal).toContainText("Endintensität");
    await expect(modal).toContainText("Maximale soziale Sensibilität");
    await expect(modal.locator(".eligibility-preview")).toContainText("geeignete Karten");
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
    await expect(
        host.locator(".host-transfer-control .wrapping-select > summary"),
    ).toHaveAccessibleName("Host-Aufgabe übertragen");
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
}, testInfo) => {
    test.setTimeout(60_000);
    const hostContext = await browser.newContext({ locale: "de-DE" });
    const firstContext = await browser.newContext({ locale: "de-DE" });
    const lateContext = await browser.newContext({ locale: "de-DE" });
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

    await expect(late.getByRole("heading", { name: "In dieses Spiel einsteigen" })).toBeVisible();
    await expect(late.getByText("Runde 1")).toHaveCount(0);
    for (const width of [1280, 320]) {
        await late.setViewportSize({ width, height: width === 320 ? 568 : 800 });
        const report = await captureVisualAudit(
            late,
            `phase-2-enrollment-${width}-${testInfo.repeatEachIndex}`,
            {
                fullPage: true,
            },
        );
        await testInfo.attach(`enrollment-${width}`, {
            path: report.screenshotPath,
            contentType: "image/png",
        });
        expect(report.horizontalOverflow).toBe(0);
        expect(report.outOfBounds).toEqual([]);
        expect(report.smallTargets).toEqual([]);
        expect(report.overlaps).toEqual([]);
        expect(report.truncations).toEqual([]);
    }
    await late.locator(".boundary-panel fieldset").nth(1).getByRole("checkbox").first().check();
    await Promise.all([
        ...[host, first].map((page) =>
            expect(page.locator(".notification-toast")).toContainText(
                "Carla ist dem laufenden Spiel beigetreten.",
            ),
        ),
        late.locator(".boundary-panel > button").click(),
    ]);
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
    const hostContext = await browser.newContext({ locale: "de-DE" });
    const playerContext = await browser.newContext({ locale: "de-DE" });
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const code = await hostRoom(host, "personal");
    await joinRoom(player, code, "Ben");
    await expect(host.locator(".participant:not(.device-player)")).toHaveCount(2);

    await playerContext.setOffline(true);
    const reconnectPanel = player.locator(".reconnect-panel");
    await expect(reconnectPanel).toContainText("Verbindung unterbrochen", { timeout: 2_000 });
    await expect(reconnectPanel).toContainText("Du bist offline");
    await expect(
        reconnectPanel.getByRole("button", { name: "Jetzt erneut versuchen" }),
    ).toBeVisible();
    await expect(
        reconnectPanel.getByRole("button", { name: "Wiederverbindung stoppen" }),
    ).toBeVisible();
    const reconnectLayout = await reconnectPanel.evaluate((panel) => {
        const heading = panel.querySelector("h1")!;
        const status = panel.querySelector<HTMLElement>(".reconnect-status")!;
        const panelStyle = getComputedStyle(panel);
        return {
            headingSize: Number.parseFloat(getComputedStyle(heading).fontSize),
            horizontalPadding: Number.parseFloat(panelStyle.paddingLeft),
            statusWidth: status.getBoundingClientRect().width,
        };
    });
    expect(reconnectLayout.headingSize).toBeLessThanOrEqual(48);
    expect(reconnectLayout.horizontalPadding).toBeGreaterThanOrEqual(24);
    expect(reconnectLayout.statusWidth).toBeGreaterThan(250);
    await playerContext.setOffline(false);
    await expect(player.getByRole("heading", { name: "Lobby" })).toBeVisible({ timeout: 5_000 });
    await expect(host.locator(".participant:not(.device-player)")).toHaveCount(2);
    await expect(player).toHaveURL(/\/play\/room$/);

    await hostContext.close();
    await playerContext.close();
});

test("hosted players see both Card intensities and shared game/modal transitions", async ({
    browser,
}) => {
    const hostContext = await browser.newContext({ locale: "de-DE" });
    const playerContext = await browser.newContext({ locale: "de-DE" });
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

    const hostCardIntensity = host.locator(".game-card .card-intensity");
    await expect(hostCardIntensity).toHaveAttribute("aria-label", /^Kartenintensität [1-5]$/);
    const selectedCardIntensity = await hostCardIntensity.getAttribute("aria-label");
    for (const page of [host, player]) {
        const intensityPair = page.locator(".game-card .intensity-pair");
        await expect(intensityPair).toBeVisible();
        await expect(intensityPair.locator(".intensity-meter")).toHaveCount(2);
        await expect(page.locator(".game-card")).toHaveCSS("animation-name", "card-enter");
        await expect(intensityPair.locator(".card-intensity")).toHaveAttribute(
            "aria-label",
            selectedCardIntensity!,
        );
        await expect(intensityPair.locator(".global-intensity")).toHaveAttribute(
            "aria-label",
            "Globale Intensität 1",
        );
        await expect(intensityPair).not.toContainText("Intensität");
        await expect(intensityPair.locator(".card-intensity use")).toHaveAttribute(
            "href",
            /#card-intensity$/,
        );
        await expect(intensityPair.locator(".global-intensity use")).toHaveAttribute(
            "href",
            /#global-intensity$/,
        );
        await expect(page.locator(".atmosphere-layer")).toHaveAttribute(
            "data-backdrop-intensity",
            "1",
        );
        await expect(page.locator(".game-phase")).toHaveCSS("animation-name", "phase-enter");
    }

    const settingsButton = host.getByRole("button", { name: "Einstellungen", exact: true });
    await host.emulateMedia({ reducedMotion: "no-preference" });
    const modalDurations = await settingsButton.evaluate(async (button) => {
        (button as HTMLElement).click();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const backdrop = document.querySelector(".modal-backdrop");
        return (
            backdrop
                ?.getAnimations({ subtree: true })
                .map((animation) => Number(animation.effect?.getTiming().duration ?? 0)) ?? []
        );
    });
    await expect(host.locator(".settings-modal")).toBeVisible();
    await expect(host.locator(".settings-modal button").first()).toBeFocused();
    expect(modalDurations.some((duration) => duration >= 160)).toBe(true);
    await host.keyboard.press("Escape");
    await expect(host.locator(".settings-modal")).toBeHidden();
    await expect(settingsButton).toBeFocused();

    await hostContext.close();
    await playerContext.close();
});

test("named Never Have I Ever synchronizes private progress then public answer columns", async ({
    browser,
}) => {
    test.setTimeout(60_000);
    const hostContext = await browser.newContext({ locale: "de-DE" });
    const playerContext = await browser.newContext({ locale: "de-DE" });
    const displayContext = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 1920, height: 1080 },
    });
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const display = await displayContext.newPage();
    const code = await hostRoom(host, "personal", /^Gute Freunde /, /Ich hab noch nie/, "named");
    await joinRoom(player, code, "Ben");
    await joinRoom(display, code, "", true);
    await expect(player.locator(".room-settings-summary")).toContainText("Deutsch (Deutschland)");
    await expect(player.locator(".room-settings-summary")).toContainText(
        "Antworten werden aufgedeckt",
    );

    await host.getByRole("button", { name: "Spiel starten" }).click();
    await host.getByRole("button", { name: "Karte aufdecken" }).click();
    const displayRoomCode = display.locator(".status > .stage-room-code[data-adaptive-contrast]");
    await expect(displayRoomCode).toHaveText(code);
    await expect(displayRoomCode).toHaveCSS("border-radius", "999px");
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
    const namedRowStyles = await display.evaluate(() => {
        const yes = getComputedStyle(
            document.querySelector<HTMLElement>(".yes-column .answer-name")!,
        );
        const no = getComputedStyle(
            document.querySelector<HTMLElement>(".no-column .answer-name")!,
        );
        return {
            yes: [yes.color, yes.backgroundColor, yes.borderColor],
            no: [no.color, no.backgroundColor, no.borderColor],
        };
    });
    expect(namedRowStyles.yes).toEqual(namedRowStyles.no);
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
    const hostContext = await browser.newContext({ locale: "de-DE" });
    const playerContext = await browser.newContext({ locale: "de-DE" });
    const displayContext = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 640, height: 360 },
    });
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const display = await displayContext.newPage();
    const code = await hostRoom(
        host,
        "personal",
        /^Gute Freunde /,
        /Ich hab noch nie/,
        "anonymous",
    );
    await joinRoom(player, code, "Ben");
    await joinRoom(display, code, "", true);

    await host.getByRole("button", { name: "Spiel starten" }).click();
    await host.getByRole("button", { name: "Karte aufdecken" }).click();
    await host.getByRole("button", { name: "Trifft zu" }).click();
    await expect(
        player.locator(".vote-progress-row").filter({ hasText: "Host Anna" }),
    ).toContainText("Abgestimmt");
    await player.getByRole("button", { name: "Trifft nicht zu" }).click();

    for (const page of [host, player, display]) {
        await expect(page.locator(".anonymous-result")).toBeVisible();
        await expect(page.locator(".aggregate-split")).toBeVisible();
        await expect(page.locator(".aggregate-metric")).toHaveCount(2);
        await expect(page.locator(".never-result-columns")).toHaveCount(0);
        await expect(page.locator(".answer-name-list")).toHaveCount(0);
    }
    await expect(display.locator(".aggregate-total")).toContainText("2");
    await expect(display.locator(".aggregate-yes")).toHaveCSS(
        "background-image",
        "linear-gradient(90deg, rgb(228, 186, 97), rgb(166, 104, 18))",
    );
    await expect(display.locator(".aggregate-no")).toHaveCSS(
        "background-image",
        "linear-gradient(90deg, rgb(227, 180, 165), rgb(159, 101, 88))",
    );
    await expect(display.locator(".aggregate-metric").first().locator("strong")).toHaveCSS(
        "color",
        "rgb(59, 36, 22)",
    );
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
    const hostContext = await browser.newContext({ locale: "de-DE" });
    const playerContext = await browser.newContext({ locale: "de-DE" });
    const displayContext = await browser.newContext({ locale: "de-DE" });
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const display = await displayContext.newPage();
    const code = await hostRoom(host, "personal");
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

test("saving device players preserves a row added before the acknowledgement", async ({
    page,
}, testInfo) => {
    test.setTimeout(60_000);
    let holdAcknowledgement = false;
    let deliverAcknowledgement: (() => void) | undefined;
    await page.routeWebSocket("**/*", (socket) => {
        const server = socket.connectToServer();
        server.onMessage((message) => {
            const body = JSON.parse(message.toString());
            if (
                holdAcknowledgement &&
                body.type === "room.snapshot" &&
                message.toString().includes('"Person 2"')
            ) {
                holdAcknowledgement = false;
                deliverAcknowledgement = () => socket.send(message);
                return;
            }
            socket.send(message);
        });
    });
    await hostRoom(page, "personal", /^Gute Freunde /, /Ich hab noch nie/, "named");
    const names = page.locator(".player-name-row input");
    const originalCount = await names.count();
    await page.getByRole("button", { name: /Person auf diesem Gerät/ }).click();
    holdAcknowledgement = true;
    await names.last().fill("Person 2");
    await expect.poll(() => Boolean(deliverAcknowledgement)).toBe(true);
    await page.getByRole("button", { name: /Person auf diesem Gerät/ }).click();
    await expect(names).toHaveCount(originalCount + 2);
    deliverAcknowledgement!();
    await expect(page.getByText("Personen auf diesem Gerät sind gespeichert")).toBeVisible();
    await expect(names).toHaveCount(originalCount + 2);
    await expect(names.last()).toHaveValue("");
    for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 800 });
        const report = await captureVisualAudit(
            page,
            `device-player-ack-${width}-${testInfo.repeatEachIndex}`,
        );
        await testInfo.attach(`device-player-ack-${width}`, {
            path: report.screenshotPath,
            contentType: "image/png",
        });
        expect(report.horizontalOverflow).toBe(0);
        expect(report.outOfBounds).toEqual([]);
        expect(report.smallTargets).toEqual([]);
        expect(report.overlaps).toEqual([]);
        expect(report.truncations).toEqual([]);
    }
    await names.last().fill("Person 3");
    await expect(page.getByText("Personen auf diesem Gerät sind gespeichert")).toBeVisible();
    await page.getByRole("button", { name: "Spiel starten", exact: true }).click();
    await page.getByRole("button", { name: "Karte aufdecken", exact: true }).click();
    await expect(page.locator(".never-vote-row > strong")).toHaveText([
        "Host Anna",
        "Person 2",
        "Person 3",
    ]);
});

test("small public displays automatically page long voting rosters and named results", async ({
    browser,
}) => {
    test.setTimeout(75_000);
    const hostContext = await browser.newContext({ locale: "de-DE" });
    const displayContext = await browser.newContext({
        locale: "de-DE",
        viewport: { width: 800, height: 600 },
    });
    const host = await hostContext.newPage();
    const display = await displayContext.newPage();
    const code = await hostRoom(host, "personal", /^Gute Freunde /, /Ich hab noch nie/, "named");

    for (let index = 0; index < 11; index += 1) {
        await host.getByRole("button", { name: /Person auf diesem Gerät/ }).click();
        await host
            .locator(".player-name-row")
            .last()
            .locator("input")
            .fill(`Person ${index + 2}`);
    }
    await expect(host.getByText("Personen auf diesem Gerät sind gespeichert")).toBeVisible();
    await joinRoom(display, code, "", true);
    await expectInsideViewport(display, ".public-stage-lobby");
    await expectInsideViewport(display, ".public-stage-lobby .stage-player-roster");
    await expectInsideViewport(display, ".public-stage-lobby .join-card");
    await host.getByRole("button", { name: "Spiel starten" }).click();
    await host.getByRole("button", { name: "Karte aufdecken" }).click();

    const displayVoting = display.locator(".never-voting");
    await expect(display.locator(".public-stage")).toBeVisible();
    await expect(display.locator(".game-card")).toBeVisible();
    await expect(display.locator(".gameplay-focus")).toHaveCSS(
        "animation-name",
        "public-stage-phase-enter",
    );
    await expect(display.locator(".game-card")).toHaveCSS(
        "animation-name",
        "public-stage-card-enter",
    );
    await expectInsideViewport(display, ".game-card");
    await expectInsideViewport(display, ".never-voting");
    await expectInsideViewportDuringMotion(
        display,
        [".gameplay-focus", ".game-card", ".never-voting"],
        600,
    );
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

    await expect(host.locator(".never-vote-row")).toHaveCount(12);
    for (let remaining = 12; remaining > 0; remaining -= 1) {
        const pendingVotes = host.locator(".never-vote-row");
        await pendingVotes.first().getByRole("button", { name: "Trifft zu" }).click();
        await expect(pendingVotes).toHaveCount(remaining - 1);
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
    for (const page of [host, display]) {
        await expect(page.locator(".stage-status")).toHaveCount(0);
        await expect(page.locator(".stage-player-roster")).toHaveCount(0);
        await expect(page.locator(".active-player")).toHaveCount(0);
        await expect(page.locator(".room-size")).toBeVisible();
    }
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
    const hostContext = await browser.newContext({ locale: "de-DE" });
    const playerContext = await browser.newContext({ locale: "de-DE" });
    const displayContext = await browser.newContext({ locale: "de-DE" });
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const display = await displayContext.newPage();
    const code = await hostRoom(host, "personal");
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
    for (const page of [host, player, display]) {
        await expect(page.locator(".stage-status")).toHaveCount(0);
        await expect(page.locator(".stage-player-roster")).toHaveCount(0);
        await expect(page.locator(".active-player")).toHaveCount(0);
        await expect(page.locator(".room-size")).toBeVisible();
    }
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
    const hostContext = await browser.newContext({ locale: "de-DE" });
    const playerContext = await browser.newContext({ locale: "de-DE" });
    const displayContext = await browser.newContext({ locale: "de-DE" });
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const display = await displayContext.newPage();
    const code = await hostRoom(host, "personal");
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
        await expect(page.locator(".notification-toast")).toContainText(
            "Der Host hat den Raum geschlossen. Du bist zurück im Hauptmenü.",
        );
    }
    await expect(player.locator(".notification-toast")).toHaveCount(0, { timeout: 7_000 });
    await player.reload();
    await expect(player).toHaveURL(/\/play\/?$/);
    await expect(player.getByRole("heading", { name: "Lobby" })).toHaveCount(0);

    await hostContext.close();
    await playerContext.close();
    await displayContext.close();
});

test("hosted zero-card settings are rejected without leaving the lobby", async ({ browser }) => {
    const hostContext = await browser.newContext({ locale: "de-DE" });
    const playerContext = await browser.newContext({ locale: "de-DE" });
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const code = await hostRoom(host, "personal", /^Custom /);
    await joinRoom(player, code, "Ben");
    await host.getByRole("button", { name: "Spiel starten" }).click();
    await expect(host.getByRole("alert")).toContainText("Keine Karte erfüllt alle aktiven Regeln.");
    const notificationLane = host.locator(".notification-lane");
    const notificationToast = host.locator(".notification-toast");
    await expect(notificationToast).toHaveCSS("position", "relative");
    const notificationBounds = await notificationLane.boundingBox();
    const contentBounds = await host.locator(".app-location").boundingBox();
    expect(notificationBounds!.y + notificationBounds!.height).toBeLessThanOrEqual(
        contentBounds!.y + 1,
    );
    await expect(host.locator(".room-error, .error, .notice")).toHaveCount(0);
    await expect(host.getByRole("heading", { name: "Lobby" })).toBeVisible();
    await expect(player.getByRole("heading", { name: "Lobby" })).toBeVisible();
    await expect(host.getByRole("alert")).toHaveCount(0, { timeout: 7_000 });
    await hostContext.close();
    await playerContext.close();
});
