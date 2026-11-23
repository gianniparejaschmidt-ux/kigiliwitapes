import { Controller } from "@hotwired/stimulus"
import { db, IsSlugFavourited, GetFavouritesListId } from "../db"
import * as Turbo from "@hotwired/turbo"
import PlayerController from "./player_controller";

const GROUPS_STORAGE_KEY = "gizz-tapes:favourite-pairs"; // Keep existing saved pairs compatible.
const SORT_STORAGE_KEY = "gizz-tapes:favourites-sort";
const DEFAULT_SORT = "date-desc";
const SORT_OPTIONS = ["date-desc", "date-asc", "venue-asc", "city-asc"];

export default class extends Controller {
    static targets = ['grid', 'showFavouriteButton', 'featuredShow', 'sortSelect', 'linkButton', 'linkStatus', 'linkFinish'];

    declare readonly gridTarget: HTMLElement;
    declare readonly hasGridTarget: boolean;

    declare readonly showFavouriteButtonTarget: HTMLElement;
    declare readonly hasShowFavouriteButtonTarget: boolean;

    declare readonly sortSelectTarget: HTMLSelectElement;
    declare readonly hasSortSelectTarget: boolean;

    declare readonly linkButtonTarget: HTMLButtonElement;
    declare readonly linkStatusTarget: HTMLElement;
    declare readonly linkFinishTarget: HTMLButtonElement;

    private linking = false;
    private selectedSlugs: string[] = [];

    connect() {
        if (this.hasSortSelectTarget) {
            const savedSort = localStorage.getItem(SORT_STORAGE_KEY);
            this.sortSelectTarget.value = savedSort !== null && SORT_OPTIONS.includes(savedSort) ? savedSort : DEFAULT_SORT;
        }

        if (this.hasGridTarget)
            this.renderFavourites();
        
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

        const favouritesSlugs = await this.getFavouritesSlugs();
        
        if (favouritesSlugs.length === 0) {
            this.gridTarget.innerHTML = `<p class="mb-5">No favourites yet!</p>`;
            this.gridTarget.classList.remove('responsive-grid');
            this.gridTarget.removeAttribute('busy');

            return;
        }

        try {
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

            this.renderLinkedGroups();
            this.applyFavouriteSort();
        } 
        catch (error) {
            this.gridTarget.innerHTML = `<p class="mb-5">Failed to load favourites.</p>`;
            this.gridTarget.classList.remove('responsive-grid');
        }

        this.gridTarget.removeAttribute('busy');
    }

    sortFavourites() {
        const sort = this.sortSelectTarget.value;
        localStorage.setItem(SORT_STORAGE_KEY, SORT_OPTIONS.includes(sort) ? sort : DEFAULT_SORT);
        this.applyFavouriteSort();
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

    private renderLinkedGroups() {
        this.gridTarget.querySelectorAll<HTMLElement>('[data-linked-group]').forEach(group => {
            const cards = Array.from(group.querySelectorAll<HTMLElement>('.featured-item'));
            group.replaceWith(...cards);
        });

        const cards = Array.from(this.gridTarget.querySelectorAll<HTMLElement>('.featured-item'));
        const bySlug = new Map(cards.map(card => [this.showSlug(card), card]));
        const groups = this.savedGroups().filter(group => group.every(slug => bySlug.has(slug)));

        for (const slugs of groups) {
            const shows = slugs.map(slug => bySlug.get(slug)!);
            const group = document.createElement('div');
            group.dataset.linkedGroup = "true";
            group.className = "relative grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 p-3 pt-10 border border-primary rounded-xl";
            group.style.gridColumn = "1 / -1";
            group.dataset.sortDate = shows.map(show => show.dataset.sortDate || "").sort().reverse()[0];
            group.dataset.sortVenue = shows[0].dataset.sortVenue || "";
            group.dataset.sortCity = shows[0].dataset.sortCity || "";

            const unlink = document.createElement('button');
            unlink.type = "button";
            unlink.className = "btn btn-xs btn-outline absolute right-2 top-2 z-10";
            unlink.textContent = "Unlink group";
            unlink.setAttribute('aria-label', 'Unlink these shows');
            unlink.dataset.action = "click->favourites#unlinkShows";

            group.append(...shows, unlink);
            this.gridTarget.appendChild(group);
        }
    }

    toggleLinkMode() {
        this.linking = !this.linking;
        this.selectedSlugs = [];
        this.updateLinkControls();
    }

    selectShow(event: MouseEvent) {
        if (!this.linking) return;
        const card = (event.target as HTMLElement).closest<HTMLElement>('.featured-item');
        if (!card || !this.gridTarget.contains(card)) return;
        event.preventDefault();
        event.stopPropagation();

        const slug = this.showSlug(card);
        if (!slug) return;
        if (this.savedGroups().some(group => group.includes(slug))) {
            this.linkStatusTarget.textContent = "This show is already linked. Unlink its group first.";
            return;
        }

        if (this.selectedSlugs.includes(slug))
            this.selectedSlugs = this.selectedSlugs.filter(selected => selected !== slug);
        else
            this.selectedSlugs.push(slug);

        this.updateLinkControls();
    }

    finishLinking() {
        if (this.selectedSlugs.length < 2) return;
        this.saveGroups([...this.savedGroups(), [...this.selectedSlugs]]);
        this.selectedSlugs = [];
        this.linking = false;
        this.renderLinkedGroups();
        this.applyFavouriteSort();
        this.updateLinkControls();
    }

    unlinkShows(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        const group = (event.target as HTMLElement).closest<HTMLElement>('[data-linked-group]');
        if (!group) return;
        const slugs = Array.from(group.querySelectorAll<HTMLElement>('.featured-item')).map(card => this.showSlug(card));
        this.saveGroups(this.savedGroups().filter(saved => !saved.every(slug => slugs.includes(slug))));
        this.renderLinkedGroups();
        this.applyFavouriteSort();
        this.updateLinkControls();
    }

    private updateLinkControls() {
        this.linkButtonTarget.textContent = this.linking ? "Cancel linking" : "Link shows";
        this.linkFinishTarget.classList.toggle('hidden', !this.linking);
        this.linkFinishTarget.disabled = this.selectedSlugs.length < 2;
        this.linkStatusTarget.textContent = this.linking
            ? `Select 2 or more shows (${this.selectedSlugs.length} selected), then click Create group.`
            : "";
        this.gridTarget.querySelectorAll<HTMLElement>('.featured-item').forEach(card => {
            const selected = this.selectedSlugs.includes(this.showSlug(card));
            card.classList.toggle('ring-4', selected);
            card.classList.toggle('ring-primary', selected);
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
        const shows = this.sortableItems();

        // Shuffle linked groups as units, keeping all their posters together.
        for (let i = shows.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shows[i], shows[j]] = [shows[j], shows[i]];
        }

        shows.forEach(show => this.gridTarget.appendChild(show));
    }

    applyFavouriteSort() {
        const sort = this.hasSortSelectTarget ? this.sortSelectTarget.value : DEFAULT_SORT;
        const shows = this.sortableItems();
        const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

        const valueFor = (show: HTMLElement, key: string) => show.dataset[key] || "";

        shows.sort((a, b) => {
            switch (sort) {
                case "date-asc":
                    return valueFor(a, "sortDate").localeCompare(valueFor(b, "sortDate"));
                case "venue-asc":
                    return collator.compare(valueFor(a, "sortVenue"), valueFor(b, "sortVenue"));
                case "city-asc":
                    return collator.compare(valueFor(a, "sortCity"), valueFor(b, "sortCity"));
                case "date-desc":
                default:
                    return valueFor(b, "sortDate").localeCompare(valueFor(a, "sortDate"));
            }
        });

        shows.forEach(show => this.gridTarget.appendChild(show));
    }

    async getFavouritesSlugs() {
        const listId = await GetFavouritesListId();
        return (await db.listShows.where({ listId }).toArray()).map(ls => ls.slug);
    }
}