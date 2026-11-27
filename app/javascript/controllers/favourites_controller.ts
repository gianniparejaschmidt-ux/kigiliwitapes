import { Controller } from "@hotwired/stimulus"
import { db, IsSlugFavourited, GetFavouritesListId } from "../db"
import * as Turbo from "@hotwired/turbo"
import PlayerController from "./player_controller";

const GROUPS_STORAGE_KEY = "gizz-tapes:favourite-pairs"; // Keep existing saved pairs compatible.
const SORT_STORAGE_KEY = "gizz-tapes:favourites-sort";
const GROUP_COLOURS = [
    "#18b182", // Green
    "#a855f7", // Purple
    "#3b82f6", // Blue
    "#e59b32", // Amber
    "#e05252", // Red
    "#06b6d4", // Cyan
    "#ec4899", // Pink
    "#84cc16", // Lime
    "#f97316", // Orange
];
const GROUP_COLOURS_STORAGE_KEY = "gizz-tapes:favourite-group-colours";
const GROUP_COLOUR_INDEX_STORAGE_KEY = "gizz-tapes:favourite-group-colour-index";
const DEFAULT_SORT = "date-desc";
const SORT_OPTIONS = [
    "date-desc",
    "date-asc",
    "favourite-desc",
    "favourite-asc",
    "city-asc",
    "venue-asc",
    "fusion"
];

export default class extends Controller {
    static targets = ['grid', 'showFavouriteButton', 'featuredShow', 'sortSelect', 'linkButton', 'linkStatus', 'linkFinish', 'shuffleButton', "floatingControls", "floatingCount", "floatingFinish",];

    declare readonly gridTarget: HTMLElement;
    declare readonly hasGridTarget: boolean;

    declare readonly showFavouriteButtonTarget: HTMLElement;
    declare readonly hasShowFavouriteButtonTarget: boolean;

    declare readonly sortSelectTarget: HTMLSelectElement;
    declare readonly hasSortSelectTarget: boolean;

    declare readonly linkButtonTarget: HTMLButtonElement;
    declare readonly linkStatusTarget: HTMLElement;
    declare readonly linkFinishTarget: HTMLButtonElement;
    declare readonly shuffleButtonTarget: HTMLButtonElement;
    declare readonly floatingControlsTarget: HTMLElement;
    declare readonly hasFloatingControlsTarget: boolean;
    declare readonly floatingCountTarget: HTMLElement;
    declare readonly floatingFinishTarget: HTMLButtonElement;
    declare readonly hasShuffleButtonTarget: boolean;

    private favouriteOrder = new Map<string, number>();
    private linking = false;
    private selectedSlugs: string[] = [];
    private editingGroup: string[] | null = null;

    connect() {
        if (this.hasSortSelectTarget) {
            const savedSort = localStorage.getItem(SORT_STORAGE_KEY);
            this.sortSelectTarget.value = savedSort !== null && SORT_OPTIONS.includes(savedSort) ? savedSort : DEFAULT_SORT;
        }

        if (this.hasGridTarget) {
            this.enhanceSortSelect();
            this.updateLinkControls();
            this.renderFavourites();
        }

        if (this.hasShowFavouriteButtonTarget)
            this.updateShowFavoriteButton(this.showFavouriteButtonTarget);
    }

    async togglePlayerFavourite({ detail: { slug } }) {
        const isFavourite = await IsSlugFavourited(slug);
        const listId = await GetFavouritesListId();

        if (isFavourite)
            await db.listShows.where({ listId, slug }).delete();
        else
            await db.listShows.add({ listId, slug });

        const playerElement = document.querySelector('#player') as HTMLElement;
        const playerController = this.application.getControllerForElementAndIdentifier(playerElement, 'player') as PlayerController;

        await playerController.updateFavouriteIcon();

        if (this.hasShowFavouriteButtonTarget)
            await this.updateShowFavoriteButton(this.showFavouriteButtonTarget);
    }

    async toggleShowFavourite(event) {
        const button = event.currentTarget;
        const showElement = button.closest('[data-controller="show"]');
        const slug = showElement.dataset.slug;

        const isFavourite = await IsSlugFavourited(slug);
        const listId = await GetFavouritesListId();

        if (isFavourite)
            await db.listShows.where({ listId, slug }).delete();
        else
            await db.listShows.add({ listId, slug });

        this.updateShowFavoriteButton(button);

        const playerElement = document.querySelector('#player') as HTMLElement;
        const playerController = this.application.getControllerForElementAndIdentifier(playerElement, 'player') as PlayerController;

        playerController.updateFavouriteIcon();
    }

    async updateShowFavoriteButton(button) {
        const showElement = button.closest('[data-controller="show"]');
        const slug = showElement.dataset.slug;

        const isFavourite = await IsSlugFavourited(slug);

        const icon = button.querySelector('.favourite-icon');
        const text = button.querySelector('span');

        if (isFavourite) {
            icon.classList.add('active');
            button.classList.add('active');
            text.innerText = 'Remove from favourites';
        }
        else {
            icon.classList.remove('active');
            button.classList.remove('active');
            text.innerText = 'Add to favourites';
        }

        button.classList.remove('hidden');
    }

    async featuredShowTargetConnected(showEl) {
        const slug = showEl.getAttribute('href').split('/').pop();
        const isFavourite = await IsSlugFavourited(slug);

        const favouriteIcon = showEl.querySelector('.favourite-icon');

        if (isFavourite)
            favouriteIcon.classList.remove('hidden');
        else
            favouriteIcon.classList.add('hidden');
    }

    async renderFavourites() {
        this.gridTarget.setAttribute('busy', '');
        this.gridTarget.innerHTML = '';

        try {
            const favouritesSlugs = await this.getFavouritesSlugs();
            const favouriteSet = new Set(favouritesSlugs);
            const originalGroups = this.savedGroups();
            const validGroups: string[][] = [];

            const colours = this.savedGroupColours();
            for (const group of originalGroups) {
                const remaining = group.filter(slug => favouriteSet.has(slug));
                const originalKey = this.groupColourKey(group);
                const colour = colours[originalKey];

                delete colours[originalKey];

                if (remaining.length >= 2) {
                    validGroups.push(remaining);

                    if (GROUP_COLOURS.includes(colour)) {
                        colours[this.groupColourKey(remaining)] = colour;
                    }
                }
            }

            localStorage.setItem(
                GROUP_COLOURS_STORAGE_KEY,
                JSON.stringify(colours)
            );

            this.saveGroups(validGroups);

            if (favouritesSlugs.length === 0) {
                this.gridTarget.innerHTML = `<p class="mb-5">No favourites yet!</p>`;
                this.gridTarget.classList.remove('responsive-grid');

                return;
            }

            // Fetch every show first, then render in list order. Rendering each response
            // as it arrives makes the card order depend on network timing.
            const responses = await Promise.all(favouritesSlugs.map(async (slug) => {
                const response = await fetch(`/${slug}/partials/featured`, {
                    method: "GET",
                    headers: {
                        Accept: "text/vnd.turbo-stream.html"
                    }
                });

                if (!response.ok) throw new Error('Fetch failed');

                return response.text();
            }));


            for (const responseText of responses)
                await Turbo.renderStreamMessage(responseText);

            // Allow Turbo to finish inserting the concert cards
            // before sorting and grouping them.
            await new Promise<void>(resolve => {
                requestAnimationFrame(() => resolve());
            });

            this.renderLinkedGroups();
            this.applyFavouriteSort();
            this.updateLinkControls();

        }
        catch (error) {
            this.gridTarget.innerHTML = `<p class="mb-5">Failed to load favourites.</p>`;
            this.gridTarget.classList.remove('responsive-grid');
        } finally {
            this.gridTarget.removeAttribute('busy');
        }
    }

    sortFavourites() {
        const sort = this.sortSelectTarget.value;

        localStorage.setItem(
            SORT_STORAGE_KEY,
            SORT_OPTIONS.includes(sort) ? sort : DEFAULT_SORT
        );

        if (this.gridTarget.hasAttribute("busy")) return;

        this.linking = false;
        this.selectedSlugs = [];
        this.editingGroup = null;

        this.renderLinkedGroups();
        this.applyFavouriteSort();
        this.updateLinkControls();
    }

    private showSlug(show: HTMLElement): string {
        return new URL(show.getAttribute('href') || '', window.location.origin).pathname.replace(/^\//, '');
    }

    private savedGroups(): string[][] {
        try {
            const stored = JSON.parse(localStorage.getItem(GROUPS_STORAGE_KEY) || "[]");
            if (!Array.isArray(stored)) return [];
            const used = new Set<string>();
            return stored.filter((group): group is string[] => {
                if (!Array.isArray(group) || group.length < 2 ||
                    group.some(slug => typeof slug !== "string" || !slug || used.has(slug)) ||
                    new Set(group).size !== group.length) return false;
                group.forEach(slug => used.add(slug));
                return true;
            });
        } catch {
            return [];
        }
    }

    private saveGroups(groups: string[][]) {
        localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(groups));
    }
    private savedGroupColours(): Record<string, string> {
        try {
            const stored = JSON.parse(
                localStorage.getItem(GROUP_COLOURS_STORAGE_KEY) || "{}"
            );

            if (!stored || typeof stored !== "object" || Array.isArray(stored))
                return {};

            return Object.fromEntries(
                Object.entries(stored).filter(
                    ([, colour]) =>
                        typeof colour === "string" &&
                        GROUP_COLOURS.includes(colour)
                )
            ) as Record<string, string>;
        } catch {
            return {};
        }
    }
    private groupColourKey(slugs: string[]): string {
        return JSON.stringify([...slugs].sort());
    }

    private groupColour(slugs: string[]): string {
        const colours = this.savedGroupColours();

        const key = this.groupColourKey(slugs);

        if (!GROUP_COLOURS.includes(colours[key])) {
            const storedIndex = Number(
                localStorage.getItem(GROUP_COLOUR_INDEX_STORAGE_KEY) || "0"
            );

            const index = Number.isSafeInteger(storedIndex) && storedIndex >= 0
                ? storedIndex % GROUP_COLOURS.length
                : 0;

            colours[key] = GROUP_COLOURS[index % GROUP_COLOURS.length];

            localStorage.setItem(
                GROUP_COLOURS_STORAGE_KEY,
                JSON.stringify(colours)
            );

            localStorage.setItem(
                GROUP_COLOUR_INDEX_STORAGE_KEY,
                String(index + 1)
            );
        }

        return colours[key];
    }

    private unwrapLinkedGroups() {
        this.gridTarget.querySelectorAll<HTMLElement>('[data-linked-group]').forEach(group => {
            const cards = Array.from(group.querySelectorAll<HTMLElement>('.featured-item'));
            group.replaceWith(...cards);
        });
    }

    private installSortSelectStyles() {
        if (document.getElementById("favourites-sort-styles")) return;

        const style = document.createElement("style");
        style.id = "favourites-sort-styles";

        style.textContent = `
        .enhanced-sort-select,
        .enhanced-sort-select::picker(select) {
            appearance: base-select;
        }

        .enhanced-sort-select {
            display: inline-flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }

        .enhanced-sort-select::picker-icon {
            display: none;
        }

        .enhanced-sort-select > button {
            display: flex;
            align-items: center;
            flex: 1;
        }

        .enhanced-sort-select option,
        .enhanced-sort-select selectedcontent {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .enhanced-sort-select .favourite-icon {
            width: 18px;
            height: 18px;
            flex-shrink: 0;
        }
    `;

        document.head.appendChild(style);
    }
    private enhanceSortSelect() {
        if (!this.hasSortSelectTarget) return;

        if (
            !CSS.supports("appearance", "base-select") ||
            !CSS.supports("selector(::picker(select))")
        ) return;

        const select = this.sortSelectTarget;

        if (select.classList.contains("enhanced-sort-select")) return;

        const savedValue = select.value;
        const computed = window.getComputedStyle(select);

        const originalStyles = [
            "background-image",
            "background-size",
            "background-position",
            "background-repeat",
            "padding-right",
            "padding-left"
        ].map(property => ({
            property,
            value: computed.getPropertyValue(property)
        }));

        this.installSortSelectStyles();

        const button = document.createElement("button");
        button.type = "button";

        const selectedContent = document.createElement("selectedcontent");
        button.appendChild(selectedContent);
        select.prepend(button);

        const labels = [
            ["favourite-desc", "Newest", "Recently favourited"],
            ["favourite-asc", "Oldest", "Earliest favourited"]
        ];

        for (const [value, label, description] of labels) {
            const option = select.querySelector<HTMLOptionElement>(
                `option[value="${value}"]`
            );

            if (!option) continue;

            option.replaceChildren(
                document.createTextNode(label),
                this.createSortHeart()
            );

            option.setAttribute("aria-label", description);
            option.title = description;
        }

        select.classList.add("enhanced-sort-select");
        for (const { property, value } of originalStyles) {
            select.style.setProperty(property, value, "important");
        }

        select.value = "date-desc";
        select.value = savedValue;
    }
    private createSortHeart(): SVGSVGElement {
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");

        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("width", "18");
        svg.setAttribute("height", "18");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "1.5");
        svg.setAttribute("class", "favourite-icon active");
        svg.setAttribute("aria-hidden", "true");

        const path = document.createElementNS(ns, "path");

        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("d", "M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z");

        svg.appendChild(path);
        return svg;
    }
    private isIntertwined(): boolean {
        return this.hasSortSelectTarget &&
            this.sortSelectTarget.value === "fusion";
    }

    private renderLinkedGroups() {
        this.unwrapLinkedGroups();

        if (!this.isIntertwined()) return;

        const cards = Array.from(this.gridTarget.querySelectorAll<HTMLElement>('.featured-item'));
        const bySlug = new Map(cards.map(card => [this.showSlug(card), card]));
        const groups = this.savedGroups().filter(group => group.every(slug => bySlug.has(slug)));

        for (const slugs of groups) {
            const shows = slugs
                .map(slug => bySlug.get(slug)!)
                .sort((a, b) =>
                    (a.dataset.sortDate || "").localeCompare(b.dataset.sortDate || "")
                );
            const group = document.createElement('div');
            group.dataset.linkedGroup = "true";

            group.className = "linked-show-group";
            group.style.setProperty("--group-colour", this.groupColour(slugs));
            group.style.setProperty("--group-size", String(shows.length));

            group.dataset.sortDate = shows.map(show => show.dataset.sortDate || "").sort().reverse()[0];
            group.dataset.sortVenue = shows[0].dataset.sortVenue || "";
            group.dataset.sortCity = shows[0].dataset.sortCity || "";

            const unlink = document.createElement('button');
            unlink.type = "button";
            unlink.className = "unlink-group-button";
            unlink.textContent = "Split";
            unlink.setAttribute('aria-label', 'Unlink these shows');
            unlink.dataset.action = "click->favourites#unlinkShows";

            const edit = document.createElement('button');
            edit.type = "button";
            edit.className = "edit-group-button";
            edit.textContent = "Change";
            edit.setAttribute('aria-label', 'Edit this group');
            edit.dataset.action = "click->favourites#editGroup";

            group.append(...shows, edit, unlink);
            this.gridTarget.appendChild(group);
        }
    }
    handleFusionKey(event: KeyboardEvent) {
        if (!this.hasGridTarget || !this.isIntertwined()) return;
        if (this.gridTarget.hasAttribute("busy")) return;

        if (
            event.defaultPrevented ||
            event.repeat ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.shiftKey
        ) return;

        const target = event.target;
        if (
            event.key.toLowerCase() === "f" &&
            !this.linking &&
            target instanceof Element &&
            target.closest("select") === this.sortSelectTarget
        ) {
            event.preventDefault();
            this.linkButtonTarget.focus();
            this.toggleLinkMode();
            return;
        }

        if (
            target instanceof Element &&
            target.closest("input, textarea, select, [contenteditable]")
        ) return;

        if (event.key.toLowerCase() === "f" && !this.linking) {
            if (
                !(target instanceof Element) ||
                (
                    !this.gridTarget.contains(target) &&
                    !this.linkButtonTarget.contains(target) &&
                    target !== document.body
                )
            ) return;

            event.preventDefault();
            this.toggleLinkMode();
            return;
        }

        if (!this.linking) return;

        if (event.key === "Escape") {
            event.preventDefault();
            this.toggleLinkMode();
            return;
        }

        if (event.key === "Enter") {
            if (
                target instanceof Element &&
                target.closest("a, button, [role='button']") &&
                !target.closest("#favourites-grid .featured-item")
            ) return;

            event.preventDefault();

            if (this.selectedSlugs.length >= 2) {
                this.finishLinking();
            }
        }
    }

    toggleLinkMode() {
        if (!this.hasGridTarget || !this.isIntertwined()) return;
        if (this.gridTarget.hasAttribute("busy")) return;

        const restoreFocus = this.linking && (
            document.activeElement === this.linkFinishTarget ||
            (
                this.hasFloatingControlsTarget &&
                this.floatingControlsTarget.contains(document.activeElement)
            )
        );

        this.linking = !this.linking;
        this.selectedSlugs = [];
        this.editingGroup = null;
        this.updateLinkControls();

        if (restoreFocus) {
            this.linkButtonTarget.focus({ preventScroll: true });
        }
    }

    selectShow(event: MouseEvent) {
        if (!this.linking) return;

        const card = (event.target as HTMLElement).closest<HTMLElement>('.featured-item');
        if (!card || !this.gridTarget.contains(card)) return;

        event.preventDefault();
        event.stopPropagation();

        const slug = this.showSlug(card);
        if (!slug) return;

        const belongsToGroup = this.savedGroups().some(
            group => group.includes(slug)
        );

        const belongsToEditedGroup =
            this.editingGroup?.includes(slug) ?? false;

        if (belongsToGroup && !belongsToEditedGroup) {
            this.linkStatusTarget.textContent =
                "This show belongs to another group.";
            return;
        }

        if (this.selectedSlugs.includes(slug))
            this.selectedSlugs = this.selectedSlugs.filter(selected => selected !== slug);
        else
            this.selectedSlugs.push(slug);

        this.updateLinkControls();
    }

    finishLinking() {
        if (!this.hasGridTarget || !this.isIntertwined()) return;
        if (this.gridTarget.hasAttribute("busy") || !this.linking) return;
        if (this.selectedSlugs.length < 2) return;

        const restoreFocus =
            document.activeElement === this.linkFinishTarget ||
            this.gridTarget.contains(document.activeElement) ||
            (
                this.hasFloatingControlsTarget &&
                this.floatingControlsTarget.contains(document.activeElement)
            );

        let groups = this.savedGroups();

        if (this.editingGroup) {
            const originalGroup = this.editingGroup;
            const colour = this.groupColour(originalGroup);
            const colours = this.savedGroupColours();

            delete colours[this.groupColourKey(originalGroup)];
            colours[this.groupColourKey(this.selectedSlugs)] = colour;

            localStorage.setItem(
                GROUP_COLOURS_STORAGE_KEY,
                JSON.stringify(colours)
            );

            groups = groups.map(group =>
                group.some(slug => originalGroup.includes(slug))
                    ? [...this.selectedSlugs]
                    : group
            );
        } else {
            groups.push([...this.selectedSlugs]);
        }

        this.saveGroups(groups);

        this.selectedSlugs = [];
        this.editingGroup = null;
        this.linking = false;

        this.renderLinkedGroups();
        this.applyFavouriteSort();
        this.updateLinkControls();

        if (restoreFocus) {
            this.linkButtonTarget.focus({ preventScroll: true });
        }
    }

    editGroup(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        const group = (event.target as HTMLElement)
            .closest<HTMLElement>('[data-linked-group]');

        if (!group || this.linking) return;

        const slugs = Array.from(
            group.querySelectorAll<HTMLElement>('.featured-item')
        ).map(card => this.showSlug(card));

        this.editingGroup = [...slugs];
        this.selectedSlugs = [...slugs];
        this.linking = true;

        this.updateLinkControls();
    }
    unlinkShows(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        if (this.linking) return;
        const group = (event.target as HTMLElement).closest<HTMLElement>('[data-linked-group]');
        if (!group) return;
        const slugs = Array.from(group.querySelectorAll<HTMLElement>('.featured-item')).map(card => this.showSlug(card));
        const colours = this.savedGroupColours();

        delete colours[this.groupColourKey(slugs)];

        localStorage.setItem(
            GROUP_COLOURS_STORAGE_KEY,
            JSON.stringify(colours)
        );
        this.saveGroups(this.savedGroups().filter(saved => !saved.every(slug => slugs.includes(slug))));
        this.renderLinkedGroups();
        this.applyFavouriteSort();
        this.updateLinkControls();
    }

    private updateLinkControls() {
        this.linkButtonTarget.classList.toggle(
            'hidden', !this.isIntertwined()
        );

        if (this.hasShuffleButtonTarget) {
            this.shuffleButtonTarget.classList.toggle(
                'hidden', this.isIntertwined()
            );
        }

        this.linkButtonTarget.textContent = this.linking
            ? "Cancel"
            : "Fuse shows";

        this.linkFinishTarget.textContent = this.editingGroup
            ? "Save"
            : "Fuse";

        this.linkFinishTarget.classList.toggle('hidden', !this.linking);
        this.linkFinishTarget.disabled = this.selectedSlugs.length < 2;
        if (this.hasFloatingControlsTarget) {
            this.floatingControlsTarget.classList.toggle(
                "hidden",
                !this.linking || !this.isIntertwined()
            );

            this.floatingCountTarget.textContent =
                `${this.selectedSlugs.length} selected`;

            this.floatingFinishTarget.textContent =
                this.editingGroup ? "Save" : "Fuse";

            this.floatingFinishTarget.disabled =
                this.selectedSlugs.length < 2;
        }

        this.gridTarget.classList.toggle('group-selection-active', this.linking);

        this.linkStatusTarget.textContent = this.linking
            ? this.editingGroup
                ? `Click shows to add or remove them (${this.selectedSlugs.length} selected), then click Save.`
                : `Select 2 or more shows (${this.selectedSlugs.length} selected), then click Fuse.`
            : "";

        this.gridTarget.querySelectorAll<HTMLElement>('.featured-item').forEach(card => {
            const selected = this.selectedSlugs.includes(this.showSlug(card));

            card.classList.toggle('selected-for-group', selected);
            card.classList.toggle('cursor-crosshair', this.linking);
        });
    }
    private sortableItems(): HTMLElement[] {
        return Array.from(this.gridTarget.children).filter((element): element is HTMLElement =>
            element instanceof HTMLElement &&
            (element.matches('.featured-item') || element.hasAttribute('data-linked-group'))
        );
    }

    shuffleFavourites() {
        if (!this.hasGridTarget || this.isIntertwined()) return;
        if (this.gridTarget.hasAttribute("busy")) return;
        const shows = this.sortableItems();

        // Shuffle individual favourite shows using Fisher-Yates.
        for (let i = shows.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shows[i], shows[j]] = [shows[j], shows[i]];
        }

        shows.forEach(show => this.gridTarget.appendChild(show));
    }

    applyFavouriteSort() {
        const sort = this.hasSortSelectTarget ? this.sortSelectTarget.value : DEFAULT_SORT;
        const shows = this.sortableItems();
        const originalOrder = [...shows];

        if (this.isIntertwined()) {
            const groups = shows.filter(show =>
                show.hasAttribute("data-linked-group")
            );

            const unfused = shows.filter(show =>
                !show.hasAttribute("data-linked-group")
            );

            unfused.sort((a, b) =>
                (b.dataset.sortDate || "").localeCompare(
                    a.dataset.sortDate || ""
                )
            );

            const ordered = [...groups, ...unfused];

            if (ordered.some((show, index) => show !== shows[index])) {
                ordered.forEach(show => this.gridTarget.appendChild(show));
            }

            return;
        }
        const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

        const valueFor = (show: HTMLElement, key: string) => show.dataset[key] || "";
        const favouriteIds = new Map<HTMLElement, number | undefined>();

        if (sort === "favourite-desc" || sort === "favourite-asc") {
            shows.forEach(show => {
                favouriteIds.set(show, this.favouriteOrder.get(this.showSlug(show)));
            });
        }

        shows.sort((a, b) => {
            switch (sort) {
                case "favourite-desc":
                case "favourite-asc": {
                    const aId = favouriteIds.get(a);
                    const bId = favouriteIds.get(b);

                    if (aId === undefined && bId === undefined)
                        return valueFor(b, "sortDate").localeCompare(valueFor(a, "sortDate"));

                    if (aId === undefined) return 1;
                    if (bId === undefined) return -1;

                    return sort === "favourite-desc"
                        ? bId - aId
                        : aId - bId;
                }

                case "date-asc":
                    return valueFor(a, "sortDate").localeCompare(valueFor(b, "sortDate"));
                case "venue-asc":
                    return collator.compare(valueFor(a, "sortVenue"), valueFor(b, "sortVenue"))
                        || valueFor(b, "sortDate").localeCompare(valueFor(a, "sortDate"))
                        || this.showSlug(a).localeCompare(this.showSlug(b));
                case "city-asc":
                    return collator.compare(valueFor(a, "sortCity"), valueFor(b, "sortCity"))
                        || valueFor(b, "sortDate").localeCompare(valueFor(a, "sortDate"))
                        || this.showSlug(a).localeCompare(this.showSlug(b));
                case "date-desc":
                default:
                    return valueFor(b, "sortDate").localeCompare(valueFor(a, "sortDate"));
            }
        });

        if (shows.some((show, index) => show !== originalOrder[index])) {
            shows.forEach(show => this.gridTarget.appendChild(show));
        }
    }

    async getFavouritesSlugs() {
        const listId = await GetFavouritesListId();
        const entries = await db.listShows.where({ listId }).toArray();

        this.favouriteOrder = new Map(
            entries.map(entry => [entry.slug, entry.id])
        );

        return entries.map(entry => entry.slug);
    }
}
