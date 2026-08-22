<script lang="ts">
    import { messages, gameModes } from "./i18n";
    import { presentation } from "./presentation";

    type DeviceMode = "couch" | "personal" | "party";
    const steps = [
        messages.setup.mode,
        messages.setup.devices,
        messages.setup.profile,
        messages.setup.group,
    ] as const;
    let screen: "menu" | "new-game" = "menu";
    let step = 0;
    let mode = gameModes[0][0];
    let device: DeviceMode = "couch";
    let profile = "PROFILE_FRIENDS";
    let adultContentConfirmed = false;
    let group = "quick";
    $: presentation.setScene(screen === "menu" ? "MENU" : "LOBBY");

    function choose<T>(setter: (value: T) => void, value: T): void {
        setter(value);
        presentation.playEffect("confirm");
    }
    function continueFlow(): void {
        presentation.playEffect("turn");
        if (step < steps.length - 1) step += 1;
        else {
            const route = device === "couch" ? "couch" : "host";
            location.href = `/play/${route}?mode=${mode}&device=${device}&profile=${profile}&group=${group}&adult=${adultContentConfirmed ? "1" : "0"}`;
        }
    }
</script>

<main class="home-shell">
    <nav class="home-links" aria-label={messages.menu.serviceNavigation}>
        <a href="/play/account">{messages.menu.account}</a>
        <a href="/play/help">{messages.menu.help}</a>
    </nav>
    <header class="hero">
        <span class="spark" aria-hidden="true">✦</span>
        <span class="eyebrow">{messages.brand}</span>
        <h1>{messages.menu.title}</h1>
        <p>{messages.menu.subtitle}</p>
    </header>

    {#if screen === "menu"}
        <nav class="main-menu" aria-label={messages.menu.title}>
            <button class="menu-tile primary-tile" on:click={() => (screen = "new-game")}>
                <span class="tile-symbol" aria-hidden="true">↗</span>
                <strong>{messages.menu.newGame}</strong><small>{messages.menu.newGameHint}</small>
            </button>
            <a class="menu-tile" href="/play/host"
                ><span aria-hidden="true">◎</span><strong>{messages.menu.continueGroup}</strong></a
            >
            <button class="menu-tile" disabled
                ><span aria-hidden="true">◇</span><strong>{messages.menu.profiles}</strong><small
                    >{messages.menu.comingSoon}</small
                ></button
            >
        </nav>
    {:else}
        <section class="wizard card-panel" aria-labelledby="wizard-title">
            <div
                class="wizard-progress"
                aria-label={messages.setup.progress(step + 1, steps.length)}
            >
                {#each steps as label, index}
                    <span class:current={index === step} class:done={index < step}
                        ><i></i>{label}</span
                    >
                {/each}
            </div>
            <button class="back-link" on:click={() => (step ? (step -= 1) : (screen = "menu"))}
                >← {messages.setup.back}</button
            >
            {#key step}
                <div class="wizard-page">
                    <span class="step-label">{messages.setup.step(step + 1, steps.length)}</span>
                    {#if step === 0}
                        <h2 id="wizard-title">{messages.setup.chooseMode}</h2>
                        <div class="option-grid">
                            {#each gameModes as item, index}
                                <button
                                    class:selected={mode === item[0]}
                                    class="option-card"
                                    on:click={() => choose((v) => (mode = v), item[0])}
                                >
                                    <span class="option-symbol">{["?", "↝", "✋", "◌"][index]}</span
                                    ><strong>{item[1]}</strong><small>{item[2]}</small>
                                </button>
                            {/each}
                        </div>
                    {:else if step === 1}
                        <h2 id="wizard-title">{messages.setup.chooseDevice}</h2>
                        <div class="option-grid three">
                            {#each messages.setup.deviceOptions as item}
                                <button
                                    class:selected={device === item[0]}
                                    class="option-card"
                                    on:click={() => choose((v) => (device = v), item[0])}
                                >
                                    <span class="option-symbol">{item[1]}</span><strong
                                        >{item[2]}</strong
                                    ><small>{item[3]}</small>
                                </button>
                            {/each}
                        </div>
                    {:else if step === 2}
                        <h2 id="wizard-title">{messages.setup.chooseProfile}</h2>
                        <div class="option-grid profiles">
                            {#each messages.setup.profiles as item}
                                <button
                                    class:selected={profile === item[0]}
                                    class="option-card"
                                    on:click={() => choose((v) => (profile = v), item[0])}
                                    ><strong>{item[1]}</strong><small>{item[2]}</small></button
                                >
                            {/each}
                        </div>
                        {#if profile === "PROFILE_COUPLES_SPICY"}
                            <label class="adult-confirmation wizard-confirmation">
                                <input type="checkbox" bind:checked={adultContentConfirmed} />
                                {messages.room.adultConfirmation}
                            </label>
                        {/if}
                    {:else}
                        <h2 id="wizard-title">{messages.setup.chooseGroup}</h2>
                        <div class="option-grid three">
                            {#each messages.setup.groupOptions as item}
                                <button
                                    class:selected={group === item[0]}
                                    class="option-card"
                                    on:click={() => choose((v) => (group = v), item[0])}
                                    ><span class="option-symbol">{item[1]}</span><strong
                                        >{item[2]}</strong
                                    ><small>{item[3]}</small></button
                                >
                            {/each}
                        </div>
                    {/if}
                </div>
            {/key}
            <button
                class="primary wizard-next"
                disabled={step === 2 &&
                    profile === "PROFILE_COUPLES_SPICY" &&
                    !adultContentConfirmed}
                on:click={continueFlow}
                >{step === steps.length - 1 ? messages.setup.continue : messages.common.next}
                <span>→</span></button
            >
        </section>
    {/if}
</main>
