// timezone-select.ts
interface BootstrapModal {
    show: () => void;
    hide: () => void;
}

interface BootstrapGlobal {
    Modal: new (element: HTMLElement, options?: { focus?: boolean }) => BootstrapModal;
}

declare const bootstrap: BootstrapGlobal;

export function initTimezoneSelect(id: number, opts: any) {
    const hid = document.getElementById(`${id}`) as HTMLInputElement;
    const btn = document.getElementById(`${id}-btn`) as HTMLButtonElement;
    const btnLbl = document.getElementById(`${id}-btn-label`) as HTMLSpanElement;
    const guess = document.getElementById(`${id}-guess`) as HTMLButtonElement;

    const modalEl = document.getElementById(`${id}-modal`) as HTMLElement;
    const chipsEl = document.getElementById(`${id}-chips`) as HTMLElement;
    const search = document.getElementById(`${id}-search`) as HTMLInputElement;
    const list = document.getElementById(`${id}-list`) as HTMLUListElement;

    if (!hid || !btn || !btnLbl || !modalEl || !chipsEl || !search || !list) return;

    // Bootstrap Modal instance (expects Bootstrap JS included on the page)
    const modal = new bootstrap.Modal(modalEl, { focus: true });

    const refDate = opts?.refDateIso ? new Date(opts.refDateIso) : new Date();

    function offsetLabel(zone: string) {
        try {
            const parts = new Intl.DateTimeFormat(undefined, {
                timeZone: zone,
                timeZoneName: "longOffset",
            }).formatToParts(refDate);
            const tzn = (parts.find(p => p.type === "timeZoneName") || ({} as any)).value || "";
            return tzn.replace("GMT", "UTC"); // e.g. UTC+02:00
        } catch {
            return "";
        }
    }

    const allZones: string[] =
        (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf("timeZone") as string[] : undefined) ||
        [
            "UTC", "Europe/Berlin", "Europe/London", "America/New_York", "America/Chicago",
            "America/Denver", "America/Los_Angeles", "America/Sao_Paulo", "Africa/Johannesburg",
            "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland",
        ];

    const common: string[] = Array.isArray(opts?.common) && opts.common.length
        ? opts.common
        : [
            "UTC", "Europe/Berlin", "Europe/London", "America/New_York", "America/Chicago",
            "America/Denver", "America/Los_Angeles", "America/Sao_Paulo", "Africa/Johannesburg",
            "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland",
        ];

    function label(zone: string) {
        const off = offsetLabel(zone);
        return off ? `${zone} • ${off}` : zone;
    }

    function setZone(zone: string) {
        if (!zone || allZones.indexOf(zone) === -1) return;
        hid.value = zone;
        btnLbl.textContent = label(zone);
        // subtle valid feedback
        btn.classList.add("btn-outline-success");
        setTimeout(() => btn.classList.remove("btn-outline-success"), 300);
    }

    // Render quick chips
    function renderChips() {
        chipsEl.innerHTML = "";
        common.forEach(z => {
            if (!allZones.includes(z)) return;
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "btn btn-sm btn-outline-light me-2 mb-2";
            chip.textContent = label(z);
            chip.addEventListener("click", () => {
                setZone(z);
                modal.hide();
            });
            chipsEl.appendChild(chip);
        });
    }

    // Render list (filtered)
    function renderList(filter: string) {
        list.innerHTML = "";
        const query = filter.trim().toLowerCase();
        const maxItems = 200; // keep it snappy on mobile
        let count = 0;

        for (const z of allZones) {
            if (query && !z.toLowerCase().includes(query)) continue;
            const li = document.createElement("li");
            li.className = "list-group-item list-group-item-action py-2 text-bg-dark hover-background";
            li.role = "option";
            li.tabIndex = 0;
            li.dataset.zone = z;
            li.innerHTML =
                `<div class="d-flex justify-content-between align-items-center hover-background">
           <span class="fw-medium">${z}</span>
           <small>${offsetLabel(z)}</small>
         </div>`;
            li.addEventListener("click", () => {
                setZone(z);
                modal.hide();
            });
            li.addEventListener("keydown", (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setZone(z);
                    modal.hide();
                }
            });
            list.appendChild(li);
            if (++count >= maxItems) break;
        }

        if (count === 0) {
            const empty = document.createElement("li");
            empty.className = "list-group-item text-bg-dark";
            empty.textContent = "No matches";
            list.appendChild(empty);
        }
    }

    // Initial state
    const provided = (opts?.value ?? "").toString();
    let guessZone = "";
    try {
        guessZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
    }
    setZone(provided || guessZone || "UTC");
    renderChips();
    renderList("");

    // Events
    btn.addEventListener("click", () => {
        modal.show();
        setTimeout(() => search.focus(), 200);
    });

    search.addEventListener("input", () => renderList(search.value));

    // Quick “Use my time zone” button (outside modal)
    if (guess) {
        guess.addEventListener("click", () => {
            let z = "";
            try {
                z = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
            } catch {
            }
            setZone(z || "UTC");
        });
    }

    // Clear search when modal closes
    modalEl.addEventListener("hidden.bs.modal", () => {
        search.value = "";
        renderList("");
    });
}