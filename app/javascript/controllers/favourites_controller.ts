import { Controller } from "@hotwired/stimulus"
import { db, IsSlugFavourited, GetFavouritesListId } from "../db"
import * as Turbo from "@hotwired/turbo"
import PlayerController from "./player_controller";

const SORT_STORAGE_KEY = "gizz-tapes:favourites-sort";
const DEFAULT_SORT = "date-desc";
const SORT_OPTIONS = ["date-desc", "date-asc", "venue-asc", "city-asc"];

export default class extends Controller {
    static targets = ['grid', 'showFavouriteButton', 'featuredShow', 'sortSelect'];

    declare readonly gridTarget: HTMLElement;
    declare readonly hasGridTarget: boolean;

    declare readonly showFavouriteButtonTarget: HTMLElement;
    declare readonly hasShowFavouriteButtonTarget: boolean;

    declare readonly sortSelectTarget: HTMLSelectElement;
    declare readonly hasSortSelectTarget: boolean;

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

    shuffleFavourites() {
        const shows = Array.from(this.gridTarget.querySelectorAll<HTMLElement>('.featured-item'));

        // Fisher–Yates shuffle.
        for (let i = shows.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shows[i], shows[j]] = [shows[j], shows[i]];
        }

        shows.forEach(show => this.gridTarget.appendChild(show));
    }

    applyFavouriteSort() {
        const sort = this.hasSortSelectTarget ? this.sortSelectTarget.value : DEFAULT_SORT;
        const shows = Array.from(this.gridTarget.querySelectorAll<HTMLElement>('.featured-item'));
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