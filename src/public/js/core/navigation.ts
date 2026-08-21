/**
 * Core navigation utilities
 * Handles navigation state and highlighting
 */

/**
 * Set current navigation location in navbar as active
 * Highlights the current page in the navigation menu
 */
export function setCurrentNavLocation(): void {
    const path = window.location.pathname;

    // Remove any existing active classes from all navigation elements
    //document.querySelectorAll('.nav-link, .dropdown-item').forEach(link => link.classList.remove('active'));

    // Set corresponding nav items active based on current path
    if (path.includes("/survey")) {
        const link = document.querySelector('a.nav-link[href*="/survey"]');
        if (link) link.classList.add('active');
    } else if (path.includes("/packing")) {
        const link = document.querySelector('a.nav-link[href*="/packing"]');
        if (link) link.classList.add('active');
    } else if (path.includes("/activity")) {
        const link = document.querySelector('a.nav-link[href*="/activity"]');
        if (link) link.classList.add('active');
    } else if (path.includes("/drivers")) {
        const link = document.querySelector('a.nav-link[href*="/drivers"]');
        if (link) link.classList.add('active');
    } else if (path.includes("/users/dashboard")) {
        const link = document.querySelector('a.dropdown-item[href="/users/dashboard"]');
        if (link) link.classList.add('active');
    } else if (path.includes("/users/manage-dashboard")) {
        const link = document.querySelector('a.dropdown-item[href="/users/manage-dashboard"]');
        if (link) link.classList.add('active');
    } else if (path.includes("/users/login")) {
        const link = document.querySelector('a.nav-link[href="/users/login"]');
        if (link) link.classList.add('active');
    } else if (path.includes("/users/register")) {
        const link = document.querySelector('a.nav-link[href="/users/register"]');
        if (link) link.classList.add('active');
    }
}

/**
 * Initialize entity list filtering
 * Adds search functionality to entity lists
 * @param container Optional container element to search within (defaults to document)
 * @param options Optional configuration for selectors
 */
export function initEntityLists(
    container: HTMLElement | Document = document,
    options: {
        sectionSelector?: string;
        inputSelector?: string;
        listSelector?: string;
        countSelector?: string;
        itemSelector?: string;
    } = {}
): void {
    const {
        sectionSelector = '[data-filter="section"]',
        inputSelector = 'input[type="search"]',
        listSelector = '.js-list',
        countSelector = '.js-count',
        itemSelector = '.list-group-item'
    } = options;

    container.querySelectorAll(sectionSelector).forEach(sec => {
        const input = sec.querySelector(inputSelector) as HTMLInputElement;
        const list = sec.querySelector(listSelector);
        const count = sec.querySelector(countSelector);
        if (!input || !list || !count) return;

        const items = Array.from(list.querySelectorAll(itemSelector));
        const total = items.length;

        const update = () => {
            const q = (input.value || '').trim().toLowerCase();
            let visible = 0;
            items.forEach(li => {
                const txt = (li.getAttribute('data-search') || li.textContent || '').toLowerCase();
                const show = !q || txt.includes(q);
                li.classList.toggle('d-none', !show);
                if (show) visible++;
            });
            count.textContent = `${visible}/${total}`;
        };

        // mark section for script
        sec.setAttribute('data-filter', 'section');
        input.addEventListener('input', update);
        update();
    });
}
