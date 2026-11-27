import { Controller } from "@hotwired/stimulus"
import { db, IsSlugFavourited, GetFavouritesListId } from "../db"
import * as Turbo from "@hotwired/turbo"
import PlayerController from "./player_controller";
import { loadBoardLayouts, saveBoardLayouts, groupKey, reconcileBoard, updateGroupPosition, canPlace, planBoardInsertion, planBoardMove } from "../favourites_board";
import type { InsertionPiece, Board, BoardColumns, BoardLayouts, BoardPiece, BoardPosition } from "../favourites_board";

const GROUPS_STORAGE_KEY = "gizz-tapes:favourite-pairs"; // Keep existing saved pairs compatible.
const GROUP_NAMES_STORAGE_KEY = "gizz-tapes:favourite-group-names";
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
interface GroupDragState {
    boardPieces: BoardPiece[];
    element: HTMLElement;
    key: string;
    columns: BoardColumns;
    position: BoardPosition;
    width: number;
    offsetX: number;
    offsetY: number;
    preview: HTMLElement | null;
}
interface BundlePiece {
    element: HTMLElement;
    key: string;
    position: BoardPosition;
    width: number;
    dr: number;
    dc: number;
}

interface MagneticInsertion {
    row: number;
    columns: BoardColumns;
    board: Board;
    left: number;
    top: number;
    width: number;
}

interface BundleDropTarget extends BoardDropTarget {
    nextBoard: Board | null;
    swapping: boolean;
}

interface BundleDragState {
    boardPieces: BoardPiece[];
    pieces: BundlePiece[];
    columns: BoardColumns;
    position: BoardPosition;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    preview: HTMLElement;
}

interface GroupMarqueeState {
    button: number;
    moved: boolean;
    startX: number;
    startY: number;
    rectangle: HTMLElement;
    initialKeys: Set<string>;
}

interface BoardDropTarget {
    position: BoardPosition;
    left: number;
    top: number;
    width: number;
    height: number;
    valid: boolean;
    swapKey?: string;
}
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
    private boardLayouts!: BoardLayouts;
    private groupDrag: GroupDragState | null = null;
    private selectedGroupKeys = new Set<string>();
    private bundleHandle: HTMLButtonElement | null = null;
    private bundleOutline: SVGSVGElement | null = null;
    private insertionIndicator: HTMLElement | null = null;
    private insertionTarget: MagneticInsertion | null = null;
    private insertionArmed = false;
    private bundleDrag: BundleDragState | null = null;
    private groupMarquee: GroupMarqueeState | null = null;
    private suppressMarqueeClick = false;
    private groupDropIndicator: HTMLElement | null = null;
    private groupSwapIndicator: HTMLElement | null = null;
    private boardResizeFrame: number | null = null;
    private clearInsertionIndicator() {
        this.insertionIndicator?.remove();
        this.insertionIndicator = null;
        this.insertionTarget = null;
    }

    private resetInsertion() {
        this.clearInsertionIndicator();
        this.insertionArmed = false;
    }

    private findMagneticInsertion(
        event: DragEvent
    ): MagneticInsertion | null {
        const drag = this.bundleDrag ?? this.groupDrag;

        if (!drag || drag.columns !== this.boardColumns()) {
            return null;
        }

        const geometry = this.getBoardGeometry();
        if (!geometry) return null;

        const {
            columnStarts,
            columnWidths,
            columnGap,
            rowStarts,
            rowHeights
        } = geometry;

        const columns = drag.columns;
        const board = this.boardLayouts[columns];

        const moving: InsertionPiece[] = this.bundleDrag
            ? this.bundleDrag.pieces.map(piece => ({
                key: piece.key,
                width: piece.width,
                position: piece.position,
                dr: piece.dr,
                dc: piece.dc
            }))
            : [{
                key: this.groupDrag!.key,
                width: this.groupDrag!.width,
                position: this.groupDrag!.position,
                dr: 0,
                dc: 0
            }];

        const width = Math.max(
            ...moving.map(piece => piece.dc + piece.width)
        );

        const pieces = drag.boardPieces;

        const lastRow = Math.max(
            0,
            ...Object.values(board).map(value => value.r)
        );

        const rect = this.gridTarget.getBoundingClientRect();

        if (
            event.clientX < rect.left ||
            event.clientX > rect.right
        ) return null;

        const boundaries: { row: number; y: number }[] = [];

        for (
            let index = 0;
            index <= lastRow && index < rowStarts.length;
            index++
        ) {
            const y = index === 0
                ? rowStarts[0] - geometry.rowGap / 2
                : (
                    rowStarts[index] +
                    rowStarts[index - 1] +
                    rowHeights[index - 1]
                ) / 2;

            boundaries.push({ row: index + 1, y });
        }

        const candidates = boundaries.filter(boundary => {
            const retained =
                this.insertionTarget?.row === boundary.row;

            const activationRadius = Math.max(
                21.5,
                geometry.rowGap / 2 + 9
            );

            const radius =
                activationRadius + (retained ? 9 : 0);

            return Math.abs(
                event.clientY - boundary.y
            ) <= radius;
        });

        // Prevent immediate insertion when picking up a handle
        // that already lies inside an insertion zone.
        if (!this.insertionArmed) {
            if (candidates.length === 0) {
                this.insertionArmed = true;
            }

            return null;
        }

        if (candidates.length === 0) return null;

        candidates.sort((a, b) => {
            if (a.row === this.insertionTarget?.row) return -1;
            if (b.row === this.insertionTarget?.row) return 1;

            return Math.abs(event.clientY - a.y) -
                Math.abs(event.clientY - b.y);
        });

        const boundary = candidates[0];

        const c = this.nearestGridTrack(
            columnStarts.slice(0, columns - width + 1),
            event.clientX - drag.offsetX
        );

        const next = planBoardInsertion(
            board,
            pieces,
            moving,
            { r: boundary.row, c: c + 1 },
            columns
        );

        if (!next) return null;

        const changed = Object.entries(next).some(
            ([key, position]) =>
                board[key]?.r !== position.r ||
                board[key]?.c !== position.c
        );

        if (!changed) return null;

        const pixelWidth = columnWidths
            .slice(c, c + width)
            .reduce((sum, value) => sum + value, 0) +
            columnGap * (width - 1);

        return {
            row: boundary.row,
            columns,
            board: next,
            left: columnStarts[c],
            top: boundary.y,
            width: pixelWidth
        };
    }

    private showInsertionIndicator(target: MagneticInsertion) {
        this.clearGroupDropIndicator();

        if (!this.insertionIndicator) {
            const indicator = document.createElement("div");
            indicator.className = "group-insertion-indicator";
            indicator.setAttribute("aria-hidden", "true");

            document.body.appendChild(indicator);
            this.insertionIndicator = indicator;
        }

        this.insertionTarget = target;

        const indicator = this.insertionIndicator;

        indicator.style.left = `${target.left}px`;
        indicator.style.top = `${target.top}px`;
        indicator.style.width = `${target.width}px`;
    }

    private handleInsertionOver(event: DragEvent): boolean {
        const target = this.findMagneticInsertion(event);

        if (!target) {
            this.clearInsertionIndicator();
            return false;
        }

        event.preventDefault();

        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
        }

        this.showInsertionIndicator(target);
        return true;
    }

    private handleInsertionDrop(event: DragEvent): boolean {
        const target = this.findMagneticInsertion(event);
        if (!target) return false;

        event.preventDefault();

        this.cancelBundleDrag();
        this.cancelGroupDrag();
        this.resetInsertion();

        const nextLayouts: BoardLayouts = {
            ...this.boardLayouts,
            [target.columns]: target.board
        };

        if (saveBoardLayouts(nextLayouts)) {
            this.boardLayouts = nextLayouts;
            this.clearGroupSelection();
            this.renderBoardLayout();
        }

        return true;
    }

    private boardPieces(columns: BoardColumns): BoardPiece[] {
        return this.sortableItems()
            .filter(item => item.hasAttribute("data-linked-group"))
            .map(item => ({
                key: item.dataset.boardKey!,
                width: Math.min(
                    columns,
                    item.querySelectorAll(".featured-item").length
                )
            }));
    }

    private planBundleMove(
        drag: BundleDragState,
        position: BoardPosition
    ) {
        return planBoardMove(
            this.boardLayouts[drag.columns],
            drag.boardPieces,
            drag.pieces,
            drag.position,
            position,
            drag.columns
        );
    }

    private findBundleDropTarget(
        event: DragEvent
    ): BundleDropTarget | null {
        const drag = this.bundleDrag;

        if (!drag || drag.columns !== this.boardColumns()) {
            return null;
        }

        const geometry = this.getBoardGeometry();
        if (!geometry) return null;

        const {
            columnWidths,
            columnStarts,
            columnGap,
            rowStarts,
            rowHeights,
            rowGap
        } = geometry;

        const board = this.boardLayouts[drag.columns];

        const lastRow = Math.max(
            0,
            ...Object.values(board).map(position => position.r)
        );

        const workingRows = rowStarts.slice(0, lastRow + 1);
        if (workingRows.length === 0) return null;

        const last = workingRows.length - 1;
        const bottom = workingRows[last] + rowHeights[last];
        const rect = this.gridTarget.getBoundingClientRect();

        if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < workingRows[0] ||
            event.clientY > bottom
        ) return null;

        const c = this.nearestGridTrack(
            columnStarts,
            event.clientX - drag.offsetX
        );

        const r = this.nearestGridTrack(
            workingRows,
            event.clientY - drag.offsetY
        );

        const position = { r: r + 1, c: c + 1 };

        const withinBounds =
            c + drag.width <= drag.columns &&
            r + drag.height <= workingRows.length;

        const plan = withinBounds
            ? this.planBundleMove(drag, position)
            : null;

        const visibleColumns = Math.min(
            drag.width,
            drag.columns - c
        );

        const visibleRows = Math.min(
            drag.height,
            workingRows.length - r
        );

        const width = columnWidths
            .slice(c, c + visibleColumns)
            .reduce((sum, value) => sum + value, 0) +
            columnGap * (visibleColumns - 1);

        const height = rowHeights
            .slice(r, r + visibleRows)
            .reduce((sum, value) => sum + value, 0) +
            rowGap * (visibleRows - 1);

        return {
            position,
            left: columnStarts[c],
            top: rowStarts[r],
            width,
            height,
            valid: plan !== null,
            nextBoard: plan?.board ?? null,
            swapping: plan?.swapping ?? false
        };
    }

    private showBundleDropIndicator(target: BundleDropTarget) {
        this.showGroupDropIndicator({
            ...target,
            swapKey: target.swapping ? "bundle" : undefined
        });

        if (!target.swapping || !this.bundleDrag) return;

        const bounds = this.selectionBounds(
            this.bundleDrag.pieces.map(piece => piece.element)
        );

        if (!this.groupSwapIndicator) {
            const source = document.createElement("div");
            source.className = "group-drop-indicator swap";
            source.setAttribute("aria-hidden", "true");
            source.textContent = "⇄";

            document.body.appendChild(source);
            this.groupSwapIndicator = source;
        }

        const source = this.groupSwapIndicator;

        source.style.left = `${bounds.left}px`;
        source.style.top = `${bounds.top}px`;
        source.style.width = `${bounds.right - bounds.left}px`;
        source.style.height = `${bounds.bottom - bounds.top}px`;
    }

    private bundleDragOver(event: DragEvent) {
        const target = this.findBundleDropTarget(event);

        if (!target) {
            this.clearGroupDropIndicator();
            return;
        }

        event.preventDefault();

        if (event.dataTransfer) {
            event.dataTransfer.dropEffect =
                target.valid ? "move" : "none";
        }

        this.showBundleDropIndicator(target);
    }

    private bundleDrop(event: DragEvent) {
        const drag = this.bundleDrag;
        if (!drag) return;

        event.preventDefault();

        const target = this.findBundleDropTarget(event);

        this.cancelBundleDrag();

        if (!target?.valid || !target.nextBoard) return;

        if (
            target.position.r === drag.position.r &&
            target.position.c === drag.position.c
        ) return;

        const nextLayouts: BoardLayouts = {
            ...this.boardLayouts,
            [drag.columns]: target.nextBoard
        };

        if (!saveBoardLayouts(nextLayouts)) return;

        this.boardLayouts = nextLayouts;

        this.clearGroupSelection();
        this.renderBoardLayout();
    }

    private findGroupDropTarget(
        event: DragEvent
    ): BoardDropTarget | null {
        const drag = this.groupDrag;

        if (!drag || drag.columns !== this.boardColumns()) {
            return null;
        }

        const geometry = this.getBoardGeometry();
        if (!geometry) return null;

        const {
            columnWidths,
            rowHeights,
            columnGap,
            columnStarts,
            rowStarts
        } = geometry;

        const board = this.boardLayouts[drag.columns];

        const lastRow = Math.max(
            0,
            ...Object.values(board).map(position => position.r)
        );

        const workingRows = rowStarts.slice(0, lastRow + 1);

        if (workingRows.length === 0) return null;
        const lastWorkingRow = workingRows.length - 1;
        const boardBottom =
            workingRows[lastWorkingRow] +
            rowHeights[lastWorkingRow];

        const rect = this.gridTarget.getBoundingClientRect();

        if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < workingRows[0] ||
            event.clientY > boardBottom
        ) return null;
        const c = this.nearestGridTrack(
            columnStarts,
            event.clientX - drag.offsetX
        );

        const r = this.nearestGridTrack(
            workingRows,
            event.clientY - drag.offsetY
        );

        const pieces = drag.boardPieces;

        const fits = canPlace(
            board,
            { key: drag.key, width: drag.width },
            { r: r + 1, c: c + 1 },
            drag.columns,
            pieces
        );
        const posterCount =
            drag.element.querySelectorAll(".featured-item").length;

        const swapPartner = !fits
            ? pieces.find(piece => {
                if (piece.key === drag.key) return false;

                const position = board[piece.key];

                if (
                    !position ||
                    position.r !== r + 1 ||
                    position.c !== c + 1 ||
                    piece.width !== drag.width
                ) return false;

                const group = this.sortableItems().find(
                    item => item.dataset.boardKey === piece.key
                );

                return group?.querySelectorAll(
                    ".featured-item"
                ).length === posterCount;
            })
            : undefined;
        const width = columnWidths
            .slice(c, c + drag.width)
            .reduce((sum, value) => sum + value, 0) +
            columnGap * (Math.min(drag.width, drag.columns - c) - 1);

        return {
            position: { r: r + 1, c: c + 1 },
            left: columnStarts[c],
            top: rowStarts[r],
            width,
            height: rowHeights[r],
            valid: fits || Boolean(swapPartner),
            swapKey: swapPartner?.key
        };
    }
    private getBoardGeometry() {
        const grid = this.gridTarget;
        const style = window.getComputedStyle(grid);
        const rect = grid.getBoundingClientRect();

        const columnWidths = style.gridTemplateColumns
            .split(/\s+/)
            .map(value => parseFloat(value));

        const rowHeights = style.gridTemplateRows
            .split(/\s+/)
            .map(value => parseFloat(value));

        if (
            columnWidths.length !== this.boardColumns() ||
            columnWidths.some(value => !Number.isFinite(value)) ||
            rowHeights.some(value => !Number.isFinite(value))
        ) return null;

        const columnGap = parseFloat(style.columnGap) || 0;
        const rowGap = parseFloat(style.rowGap) || 0;

        const left = rect.left +
            (parseFloat(style.borderLeftWidth) || 0) +
            (parseFloat(style.paddingLeft) || 0);

        const top = rect.top +
            (parseFloat(style.borderTopWidth) || 0) +
            (parseFloat(style.paddingTop) || 0);

        return {
            columnWidths,
            rowHeights,
            columnGap,
            rowGap,
            columnStarts: this.gridTrackStarts(
                columnWidths, left, columnGap
            ),
            rowStarts: this.gridTrackStarts(
                rowHeights, top, rowGap
            )
        };
    }
    private gridTrackStarts(
        sizes: number[],
        start: number,
        gap: number
    ): number[] {
        let offset = start;

        return sizes.map(size => {
            const position = offset;
            offset += size + gap;
            return position;
        });
    }

    private nearestGridTrack(
        starts: number[],
        coordinate: number
    ): number {
        let nearest = 0;

        for (let i = 1; i < starts.length; i++) {
            if (
                Math.abs(starts[i] - coordinate) <
                Math.abs(starts[nearest] - coordinate)
            ) {
                nearest = i;
            }
        }

        return nearest;
    }
    private createGroupDragPreview(
        group: HTMLElement,
        attach = true
    ): HTMLElement {
        const rect = group.getBoundingClientRect();
        const preview = document.createElement("div");

        preview.className = "linked-show-group group-drag-preview";

        preview.style.setProperty(
            "--group-colour",
            group.style.getPropertyValue("--group-colour")
        );

        preview.style.setProperty(
            "--group-size",
            group.style.getPropertyValue("--group-size")
        );

        preview.style.width = `${rect.width}px`;
        preview.style.height = "auto";

        for (const card of group.querySelectorAll(".featured-item")) {
            const original = card.querySelector("img");
            if (!original) continue;

            const bounds = original.getBoundingClientRect();
            const wrapper = document.createElement("div");

            wrapper.className = "featured-item";
            wrapper.style.background = "transparent";

            const artwork = document.createElement("canvas");

            artwork.width = Math.max(
                1,
                Math.round(bounds.width * window.devicePixelRatio)
            );

            artwork.height = Math.max(
                1,
                Math.round(bounds.height * window.devicePixelRatio)
            );

            artwork.style.display = "block";
            artwork.style.width = `${bounds.width}px`;
            artwork.style.height = `${bounds.height}px`;
            artwork.style.maxWidth = "100%";
            artwork.style.borderRadius = "0.75rem";

            const context = artwork.getContext("2d");

            if (
                context &&
                original.complete &&
                original.naturalWidth > 0
            ) {
                context.drawImage(
                    original, 0, 0,
                    artwork.width, artwork.height
                );

                wrapper.appendChild(artwork);
            } else {
                const image = original.cloneNode(true) as HTMLImageElement;

                image.style.width = `${bounds.width}px`;
                image.style.height = `${bounds.height}px`;
                image.loading = "eager";
                image.draggable = false;

                wrapper.appendChild(image);
            }

            preview.appendChild(wrapper);
        }

        preview.setAttribute("aria-hidden", "true");
        preview.inert = true;

        if (attach) document.body.appendChild(preview);

        return preview;
    }
    startGroupDrag(event: DragEvent) {
        if (
            this.groupMarquee ||
            this.bundleDrag ||
            this.gridTarget.querySelector(".contextual-group-editing")
        ) {
            event.preventDefault();
            return;
        }

        if (
            !this.hasGridTarget ||
            !this.isIntertwined() ||
            this.linking ||
            this.gridTarget.hasAttribute("busy") ||
            !event.dataTransfer
        ) {
            event.preventDefault();
            return;
        }

        const group = (event.currentTarget as HTMLElement)
            .closest<HTMLElement>("[data-linked-group]");

        const key = group?.dataset.boardKey;
        const columns = this.boardColumns();
        const position = key
            ? this.boardLayouts[columns][key]
            : undefined;

        if (!group || !key || !position) {
            event.preventDefault();
            return;
        }

        this.cancelGroupDrag();
        this.clearGroupSelection();

        const rect = group.getBoundingClientRect();

        this.resetInsertion();

        this.groupDrag = {
            boardPieces: this.boardPieces(columns),
            element: group,
            key,
            columns,
            position: { ...position },
            width: Math.min(
                columns,
                group.querySelectorAll(".featured-item").length
            ),
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            preview: null
        };

        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", key);
        const preview = this.createGroupDragPreview(group);

        this.groupDrag.preview = preview;

        event.dataTransfer.setDragImage(
            preview,
            Math.round(this.groupDrag.offsetX),
            Math.max(0, Math.round(this.groupDrag.offsetY))
        );

        requestAnimationFrame(() => {
            preview.remove();
        });
        group.classList.add("group-dragging");
    }

    endGroupDrag() {
        this.cancelGroupDrag();
    }
    private dropHoverOrigin: { x: number; y: number } | null = null;
    private dropHoverGrid: HTMLElement | null = null;

    private clearDropHover = () => {
        this.dropHoverGrid?.classList.remove(
            "group-post-drop"
        );

        this.dropHoverOrigin = null;
        this.dropHoverGrid = null;

        window.removeEventListener(
            "pointermove", this.releaseDropHover, true
        );

        window.removeEventListener(
            "keydown", this.releaseDropHoverOnKey, true
        );
    };

    private releaseDropHover = (event: PointerEvent) => {
        const origin = this.dropHoverOrigin;
        if (!origin) return;

        if (
            event.clientX !== origin.x ||
            event.clientY !== origin.y
        ) {
            this.clearDropHover();
        }
    };

    private releaseDropHoverOnKey = (event: KeyboardEvent) => {
        if (event.key === "Tab") {
            this.clearDropHover();
        }
    };

    private suppressDropHover(event: DragEvent) {
        this.clearDropHover();

        const focused = document.activeElement;

        if (
            focused instanceof HTMLElement &&
            focused.matches(".group-drag-handle, .group-bundle-handle")
        ) {
            focused.blur();
        }

        if (!this.hasGridTarget) return;

        this.dropHoverGrid = this.gridTarget;

        this.dropHoverOrigin = {
            x: event.clientX,
            y: event.clientY
        };

        this.dropHoverGrid.classList.add("group-post-drop");

        window.addEventListener(
            "pointermove", this.releaseDropHover, true
        );

        window.addEventListener(
            "keydown", this.releaseDropHoverOnKey, true
        );
    }

    groupDrop(event: DragEvent) {
        if (this.groupDrag || this.bundleDrag) {
            this.suppressDropHover(event);
        }

        if (
            (this.groupDrag || this.bundleDrag) &&
            this.handleInsertionDrop(event)
        ) return;

        if (this.bundleDrag) {
            this.bundleDrop(event);
            return;
        }

        const drag = this.groupDrag;
        if (!drag) return;

        event.preventDefault();

        const target = this.findGroupDropTarget(event);

        this.cancelGroupDrag();

        if (!target?.valid) return;

        const board = this.boardLayouts[drag.columns];
        const current = board[drag.key];

        if (
            !current ||
            current.r !== drag.position.r ||
            current.c !== drag.position.c
        ) return;

        if (
            current.r === target.position.r &&
            current.c === target.position.c
        ) return;

                const nextBoard = {
            ...board,
            [drag.key]: { ...target.position }
        };

        if (target.swapKey) {
            const partnerPosition = board[target.swapKey];

            if (
                !partnerPosition ||
                partnerPosition.r !== target.position.r ||
                partnerPosition.c !== target.position.c
            ) return;

            nextBoard[target.swapKey] = { ...current };
        }

        const nextLayouts: BoardLayouts = {
            ...this.boardLayouts,
            [drag.columns]: nextBoard
        };

        if (!saveBoardLayouts(nextLayouts)) return;

        this.boardLayouts = nextLayouts;
        this.renderBoardLayout();
    }
    groupDragLeave(event: DragEvent) {
        if (!this.groupDrag && !this.bundleDrag) return;

        const related = event.relatedTarget;

        if (
            related instanceof Node &&
            this.gridTarget.contains(related)
        ) return;

        this.clearInsertionIndicator();
        this.clearGroupDropIndicator();
    }
    groupDragOver(event: DragEvent) {
        if (
            (this.groupDrag || this.bundleDrag) &&
            this.handleInsertionOver(event)
        ) return;

        if (this.bundleDrag) {
            this.bundleDragOver(event);
            return;
        }

        if (!this.groupDrag) return;

        const target = this.findGroupDropTarget(event);

        if (!target) {
            this.clearGroupDropIndicator();
            return;
        }

        event.preventDefault();

        if (event.dataTransfer) {
            event.dataTransfer.dropEffect =
                target.valid ? "move" : "none";
        }

        this.showGroupDropIndicator(target);
    }
    private clearGroupDropIndicator() {
        this.groupDropIndicator?.remove();
        this.groupDropIndicator = null;

        this.groupSwapIndicator?.remove();
        this.groupSwapIndicator = null;
    }

    private showGroupDropIndicator(target: BoardDropTarget) {
        if (!this.groupDropIndicator) {
            const indicator = document.createElement("div");
            indicator.className = "group-drop-indicator";
            indicator.setAttribute("aria-hidden", "true");

            document.body.appendChild(indicator);
            this.groupDropIndicator = indicator;
        }

        const indicator = this.groupDropIndicator;
        const swapping = Boolean(target.swapKey);

        indicator.classList.toggle("valid", target.valid && !swapping);
        indicator.classList.toggle("invalid", !target.valid);
        indicator.classList.toggle("swap", swapping);

        indicator.textContent = swapping ? "⇄" : "";

        indicator.style.left = `${target.left}px`;
        indicator.style.top = `${target.top}px`;
        indicator.style.width = `${target.width}px`;
        indicator.style.height = `${target.height}px`;

        if (swapping && this.groupDrag) {
            if (!this.groupSwapIndicator) {
                const source = document.createElement("div");
                source.className = "group-drop-indicator swap";
                source.setAttribute("aria-hidden", "true");
                source.textContent = "⇄";

                document.body.appendChild(source);
                this.groupSwapIndicator = source;
            }

            const rect = this.groupDrag.element.getBoundingClientRect();
            const source = this.groupSwapIndicator;

            source.style.left = `${rect.left}px`;
            source.style.top = `${rect.top}px`;
            source.style.width = `${rect.width}px`;
            source.style.height = `${rect.height}px`;
        } else {
            this.groupSwapIndicator?.remove();
            this.groupSwapIndicator = null;
        }
    }

    private cancelGroupDrag() {
        this.resetInsertion();
        this.clearGroupDropIndicator();

        if (!this.groupDrag) return;

        this.groupDrag.element.classList.remove("group-dragging");
        this.groupDrag.preview?.remove();
        this.groupDrag = null;
    }
    private handleBoardResize = () => {
        if (this.boardResizeFrame !== null) return;

        this.boardResizeFrame = requestAnimationFrame(() => {
            this.boardResizeFrame = null;

            if (!this.hasGridTarget || !this.isIntertwined()) return;
            if (this.gridTarget.hasAttribute("busy")) return;
        this.cancelGroupDrag();
            this.cancelGroupMarquee();
            this.clearGroupSelection();
            this.renderBoardLayout();
        });
    };
    disconnect() {
        this.clearDropHover();
        this.cancelGroupMarquee();
        this.clearGroupSelection();
        window.removeEventListener("resize", this.handleBoardResize);
        window.removeEventListener(
            "scroll", this.positionBundleHandle, true
        );
        this.removeBundleHandle();
        this.cancelGroupDrag();
        if (this.boardResizeFrame !== null) {
            cancelAnimationFrame(this.boardResizeFrame);
            this.boardResizeFrame = null;
        }
    }
    private boardColumns(): BoardColumns {
        if (window.matchMedia("(min-width: 1024px)").matches) {
            return 6;
        }

        if (window.matchMedia("(min-width: 768px)").matches) {
            return 3;
        }

        return 2;
    }
    connect() {
        if (this.hasSortSelectTarget) {
            const savedSort = localStorage.getItem(SORT_STORAGE_KEY);
            this.sortSelectTarget.value = savedSort !== null && SORT_OPTIONS.includes(savedSort) ? savedSort : DEFAULT_SORT;
        }

                if (this.hasGridTarget) {
            this.boardLayouts = loadBoardLayouts();
            window.addEventListener("resize", this.handleBoardResize);
            window.addEventListener(
                "scroll", this.positionBundleHandle, true
            );
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
        this.cancelGroupMarquee();
        this.clearGroupSelection();
        this.cancelGroupDrag();
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
                if (remaining.length !== group.length) {
                    this.updateBoardGroup(
                        group,
                        remaining.length >= 2 ? remaining : null
                    );
                }
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

            const renderedSlugs = new Set(
                this.sortableItems().map(show => this.showSlug(show))
            );

            if (
                renderedSlugs.size !== favouriteSet.size ||
                favouritesSlugs.some(slug => !renderedSlugs.has(slug))
            ) {
                throw new Error("Incomplete favourites rendering");
            }

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
    private savedGroupNames(): Record<string, string> {
        try {
            const stored = JSON.parse(
                localStorage.getItem(GROUP_NAMES_STORAGE_KEY) || "{}"
            );

            if (!stored || typeof stored !== "object" ||
                Array.isArray(stored)) return {};

            return Object.fromEntries(
                Object.entries(stored).filter(
                    ([, value]) => typeof value === "string"
                )
            ) as Record<string, string>;
        } catch {
            return {};
        }
    }

    private groupName(slugs: string[]): string {
        return this.savedGroupNames()[groupKey(slugs)] || "";
    }

    private saveGroupName(key: string, value: string): boolean {
        const names = this.savedGroupNames();
        const name = value.trim();

        if (name) {
            names[key] = name;
        } else {
            delete names[key];
        }

        try {
            localStorage.setItem(
                GROUP_NAMES_STORAGE_KEY,
                JSON.stringify(names)
            );
            return true;
        } catch (error) {
            console.warn("Unable to save group name", error);
            return false;
        }
    }

    private transferGroupName(
        previousSlugs: string[] | null,
        nextSlugs: string[] | null
    ) {
        if (!previousSlugs) return;

        const names = this.savedGroupNames();
        const previousKey = groupKey(previousSlugs);
        const name = names[previousKey];

        if (!name) return;

        delete names[previousKey];

        if (nextSlugs) {
            names[groupKey(nextSlugs)] = name;
        }

        try {
            localStorage.setItem(
                GROUP_NAMES_STORAGE_KEY,
                JSON.stringify(names)
            );
        } catch (error) {
            console.warn("Unable to update group names", error);
        }
    }

    private createGroupNameLabel(slugs: string[]): HTMLButtonElement {
        const label = document.createElement("button");

        label.type = "button";
        label.className = "group-name-label";

        const update = () => {
            const name = this.groupName(slugs);

            label.textContent = name || "Name";
            label.classList.toggle("unnamed", !name);

            label.title = name
                ? `${name} — Rename group`
                : "Name this group";

            label.setAttribute(
                "aria-label",
                name ? `Rename group: ${name}` : "Name this group"
            );
        };

        update();

        label.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();

            if (!this.canSelectGroups()) return;

            const activeGroup = this.gridTarget.querySelector(
                ".contextual-group-editing"
            );

            if (activeGroup && !activeGroup.contains(label)) return;

            this.clearGroupSelection();
            this.editGroupName(label, slugs, update);
        });

        return label;
    }

    private editGroupName(
        label: HTMLButtonElement,
        slugs: string[],
        update: () => void
    ) {
        const input = document.createElement("input");

        input.type = "text";
        input.className = "group-name-input";
        input.maxLength = 100;
        input.value = this.groupName(slugs);
        input.placeholder = "Group name";
        input.setAttribute("aria-label", "Group name");

        let finished = false;

        const finish = (save: boolean) => {
            if (finished) return;

            if (save && !this.saveGroupName(
                groupKey(slugs), input.value
            )) {
                input.setCustomValidity("Unable to save group name");
                input.reportValidity();
                return;
            }

            finished = true;

            input.replaceWith(label);
            update();
        };

        input.addEventListener("input", () => {
            input.setCustomValidity("");
        });

        input.addEventListener("click", event => {
            event.stopPropagation();
        });

        input.addEventListener("keydown", event => {
            event.stopPropagation();

            if (event.isComposing) return;

            if (event.key === "Enter" || event.key === "Escape") {
                event.preventDefault();
                finish(event.key === "Enter");
                if (finished) {
                    label.focus({ preventScroll: true });
                }
            }
        });

        input.addEventListener("blur", () => finish(false));

        label.replaceWith(input);
        input.focus({ preventScroll: true });
        input.select();
    }

    private updateBoardGroup(
        previousSlugs: string[] | null,
        nextSlugs: string[] | null
    ) {
        this.transferGroupName(previousSlugs, nextSlugs);

        const nextLayouts = updateGroupPosition(
            this.boardLayouts,
            previousSlugs,
            nextSlugs
        );

        if (saveBoardLayouts(nextLayouts)) {
            this.boardLayouts = nextLayouts;
        }
    }
private renderBoardLayout() {
        this.resetBoardLayout();

        const columns = this.boardColumns();
        const items = this.sortableItems();

        const groups = items.filter(item =>
            item.hasAttribute("data-linked-group")
        );

        if (groups.length === 0) return;

        const pieces: BoardPiece[] = groups.map(group => ({
            key: group.dataset.boardKey!,
            width: Math.min(
                columns,
                group.querySelectorAll(".featured-item").length
            )
        }));

        const board = reconcileBoard(
            this.boardLayouts[columns],
            pieces,
            columns
        );

                if (!board) return;

        const nextLayouts: BoardLayouts = {
            ...this.boardLayouts,
            [columns]: board
        };

                const positionsChanged =
            JSON.stringify(this.boardLayouts[columns]) !==
            JSON.stringify(board);

        if (positionsChanged && saveBoardLayouts(nextLayouts)) {
            this.boardLayouts = nextLayouts;
        }

        let lastRow = 0;

        groups.forEach((group, index) => {
            const piece = pieces[index];
            const position = board[piece.key];

            group.style.gridRow = String(position.r);
            group.style.gridColumn =
                `${position.c} / span ${piece.width}`;

            lastRow = Math.max(lastRow, position.r);
        });

        const rowHeight = Math.max(
            80,
            this.gridTarget.clientWidth / columns * 0.8
        );

        this.gridTarget.style.gridTemplateRows =
            `repeat(${lastRow + 1}, minmax(${rowHeight}px, auto))`;

        this.gridTarget.style.rowGap = "36px";


        const unfused = items.filter(item =>
            !item.hasAttribute("data-linked-group")
        );

        unfused.forEach((item, index) => {
            item.style.gridRow =
                String(lastRow + 2 + Math.floor(index / columns));

            item.style.gridColumn =
                String(index % columns + 1);
        });

        const orderedGroups = [...groups].sort((a, b) => {
            const first = board[a.dataset.boardKey!];
            const second = board[b.dataset.boardKey!];

            return first.r - second.r || first.c - second.c;
        });

        this.syncBoardDOMOrder([
            ...orderedGroups,
            ...unfused
        ]);
    }
    private syncBoardDOMOrder(items: HTMLElement[]) {
        const focused = document.activeElement;

        const isSortable = (element: Element): boolean =>
            element instanceof HTMLElement &&
            (
                element.matches(".featured-item") ||
                element.hasAttribute("data-linked-group")
            );

        let current = this.gridTarget.firstElementChild;

        for (const expected of items) {
            while (current && !isSortable(current)) {
                current = current.nextElementSibling;
            }

            if (!current) break;

            if (current === expected) {
                current = current.nextElementSibling;
            } else {
                this.gridTarget.insertBefore(expected, current);
            }
        }

        if (
            focused instanceof HTMLElement &&
            focused.isConnected &&
            this.gridTarget.contains(focused) &&
            document.activeElement !== focused
        ) {
            focused.focus({ preventScroll: true });
        }
    }

    private resetBoardLayout() {
        this.gridTarget.style.removeProperty("padding-top");
        this.gridTarget.style.removeProperty("margin-top");
        this.gridTarget.style.removeProperty("grid-template-rows");
        this.gridTarget.style.removeProperty("row-gap");

        for (const item of this.sortableItems()) {
            item.style.removeProperty("grid-row");
            item.style.removeProperty("grid-column");
        }
    }

    private unwrapLinkedGroups() {
        this.cancelGroupMarquee();
        this.clearGroupSelection();
        this.cancelGroupDrag();
        this.resetBoardLayout();

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

        .enhanced-sort-select::picker(select) {
            width: 140px;
            min-width: 140px;
            max-width: 140px;
            box-sizing: border-box;
            border-radius: 0.5rem;
            overflow: hidden;
            transition: none;
        }

        .enhanced-sort-select option {
            white-space: nowrap;
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
        this.closeContextualGroupEditing();
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
            group.dataset.boardKey = groupKey(slugs);

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
            edit.setAttribute("aria-expanded", "false");
            edit.setAttribute('aria-label', 'Edit this group');
            edit.dataset.action = "click->favourites#editGroup";

            const editShows = document.createElement("button");
            editShows.type = "button";
            editShows.className = "group-select-button";
            editShows.textContent = "Select";
            editShows.setAttribute("aria-label", "Change group membership");
            editShows.dataset.action = "click->favourites#editGroup";


                        const handle = document.createElement("button");
            handle.type = "button";
            handle.className = "group-drag-handle";
            handle.draggable = true;
            handle.dataset.action =
                "dragstart->favourites#startGroupDrag dragend->favourites#endGroupDrag";
            handle.setAttribute("aria-label", "Move this group");
            handle.title = "Move group";

            handle.innerHTML = `
                <svg width="20" height="10" viewBox="0 0 20 10"
                     fill="currentColor" aria-hidden="true">
                    <circle cx="3" cy="3" r="1.3"/>
                    <circle cx="8" cy="3" r="1.3"/>
                    <circle cx="12" cy="3" r="1.3"/>
                    <circle cx="17" cy="3" r="1.3"/>
                    <circle cx="3" cy="7" r="1.3"/>
                    <circle cx="8" cy="7" r="1.3"/>
                    <circle cx="12" cy="7" r="1.3"/>
                    <circle cx="17" cy="7" r="1.3"/>
                </svg>
            `;

            const name = this.createGroupNameLabel(slugs);

            group.append(name, handle, edit, ...shows, unlink, editShows);
            this.gridTarget.appendChild(group);
        }
    }
    handleFusionKey(event: KeyboardEvent) {
        if (event.key === "Escape") {
            const activeGroup = this.hasGridTarget
                ? this.gridTarget.querySelector<HTMLElement>(
                    ".contextual-group-editing"
                )
                : null;

            if (activeGroup) {
                event.preventDefault();
                this.closeContextualGroupEditing();

                activeGroup.querySelector<HTMLButtonElement>(
                    ".edit-group-button"
                )?.focus({ preventScroll: true });

                return;
            }

            if (this.groupDrag) {
                event.preventDefault();
                this.cancelGroupDrag();
                return;
            }

            if (this.bundleDrag) {
                event.preventDefault();
                this.cancelBundleDrag();
                return;
            }

            if (this.groupMarquee) {
                event.preventDefault();
                this.cancelGroupMarquee();
                return;
            }

            if (this.selectedGroupKeys.size > 0) {
                event.preventDefault();
                this.clearGroupSelection();
                return;
            }
        }

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

        this.cancelGroupMarquee();
        this.clearGroupSelection();

        this.linking = !this.linking;
        this.selectedSlugs = [];
        this.editingGroup = null;
        this.updateLinkControls();

        if (restoreFocus) {
            this.linkButtonTarget.focus({ preventScroll: true });
        }
    }

    private toggleGroupSelection(event: MouseEvent): boolean {
        if (this.gridTarget.querySelector(".contextual-group-editing")) {
            return false;
        }

        if (!event.shiftKey || !this.canSelectGroups()) {
            return false;
        }

        const target = event.target;
        if (!(target instanceof Element)) return false;

        const group = target.closest<HTMLElement>("[data-linked-group]");
        const key = group?.dataset.boardKey;

        if (!key) return false;

        event.preventDefault();
        event.stopPropagation();

        if (this.selectedGroupKeys.has(key)) {
            this.selectedGroupKeys.delete(key);
        } else {
            this.selectedGroupKeys.add(key);
        }

        this.renderGroupSelection();
        return true;
    }

    selectShow(event: MouseEvent) {
        if (this.toggleGroupSelection(event)) return;

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

        const fusionKey = this.editingGroup === null
            ? groupKey(this.selectedSlugs)
            : null;

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
        this.updateBoardGroup(
            this.editingGroup,
            this.selectedSlugs
        );
        this.selectedSlugs = [];
        this.editingGroup = null;
        this.linking = false;

        this.renderLinkedGroups();
        this.applyFavouriteSort();
        this.updateLinkControls();

        if (fusionKey !== null) {
            this.animateFusion(fusionKey);
        }

        if (restoreFocus) {
            this.linkButtonTarget.focus({ preventScroll: true });
        }
    }


    private animateFusion(key: string) {
        if (window.matchMedia(
            "(prefers-reduced-motion: reduce)"
        ).matches) return;

        const group = Array.from(
            this.gridTarget.querySelectorAll<HTMLElement>(
                "[data-linked-group]"
            )
        ).find(element => element.dataset.boardKey === key);

        if (!group) return;

        const svgNS = "http://www.w3.org/2000/svg";

        const rect = group.getBoundingClientRect();

        if (rect.width < 8 || rect.height < 8) return;

        const svg = document.createElementNS(svgNS, "svg");

        svg.setAttribute("class", "fusion-energy");
        svg.setAttribute("aria-hidden", "true");

        svg.setAttribute(
            "viewBox",
            `0 0 ${rect.width + 12} ${rect.height + 12}`
        );

        const createRing = (className: string) => {
            const ring = document.createElementNS(svgNS, "rect");

            ring.setAttribute("x", "6");
            ring.setAttribute("y", "6");
            ring.setAttribute("width", String(rect.width));
            ring.setAttribute("height", String(rect.height));
            ring.setAttribute("rx", "12");
            ring.setAttribute("pathLength", "100");
            ring.setAttribute("class", className);

            svg.appendChild(ring);

            return ring;
        };

        createRing("fusion-energy-halo");
        createRing("fusion-energy-trail");
        const impulse = createRing("fusion-energy-impulse");

        group.appendChild(svg);

        const cleanup = () => svg.remove();

        impulse.addEventListener(
            "animationend",
            cleanup,
            { once: true }
        );

        window.setTimeout(cleanup, 1100);
    }

    private closeContextualGroupEditing() {
        if (!this.hasGridTarget) return;

        this.gridTarget
            .querySelectorAll<HTMLButtonElement>(".group-name-label")
            .forEach(label => {
                label.disabled = false;
            });

        this.gridTarget
            .querySelectorAll<HTMLElement>(".contextual-group-editing")
            .forEach(group => {
                group.classList.remove("contextual-group-editing");

                const button = group.querySelector<HTMLButtonElement>(
                    ".edit-group-button"
                );

                if (button) {
                    button.textContent = "Change";
                    button.setAttribute("aria-label", "Edit this group");
                    button.setAttribute("aria-expanded", "false");
                }
            });
    }

    private toggleContextualGroupEditing(group: HTMLElement) {
        const wasOpen = group.classList.contains(
            "contextual-group-editing"
        );

        this.closeContextualGroupEditing();

        if (wasOpen) return;

        this.cancelGroupMarquee();
        this.clearGroupSelection();

        group.classList.add("contextual-group-editing");

        this.gridTarget
            .querySelectorAll<HTMLButtonElement>(".group-name-label")
            .forEach(label => {
                label.disabled = !group.contains(label);
            });

        const button = group.querySelector<HTMLButtonElement>(
            ".edit-group-button"
        );

        if (button) {
            button.textContent = "Done";
            button.setAttribute("aria-label", "Close group editing");
            button.setAttribute("aria-expanded", "true");
        }
    }

    editGroup(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        const group = (event.target as HTMLElement)
            .closest<HTMLElement>('[data-linked-group]');

        if (!group || this.linking) return;

        const button = event.currentTarget;

        if (
            button instanceof HTMLElement &&
            button.classList.contains("edit-group-button")
        ) {
            this.toggleContextualGroupEditing(group);
            return;
        }

        this.closeContextualGroupEditing();

        const slugs = Array.from(
            group.querySelectorAll<HTMLElement>('.featured-item')
        ).map(card => this.showSlug(card));

        this.cancelGroupMarquee();
        this.clearGroupSelection();

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

        const fissionRect = group.getBoundingClientRect();
        const fissionColour = getComputedStyle(group)
            .getPropertyValue("--group-colour").trim()
            || "#18b182";
        const slugs = Array.from(group.querySelectorAll<HTMLElement>('.featured-item')).map(card => this.showSlug(card));
        const colours = this.savedGroupColours();

        delete colours[this.groupColourKey(slugs)];

        localStorage.setItem(
            GROUP_COLOURS_STORAGE_KEY,
            JSON.stringify(colours)
        );
        this.saveGroups(this.savedGroups().filter(saved => !saved.every(slug => slugs.includes(slug))));
        this.updateBoardGroup(slugs, null);
        const redistribute = () => {
            this.renderLinkedGroups();
            this.applyFavouriteSort();
            this.updateLinkControls();
        };

        if (window.matchMedia(
            "(prefers-reduced-motion: reduce)"
        ).matches) {
            redistribute();
            return;
        }

        this.closeContextualGroupEditing();

        group.style.outlineColor = "transparent";
        group.style.boxShadow = "none";

        const wasInert = this.element.hasAttribute("inert");

        this.element.setAttribute("inert", "");
        this.gridTarget.setAttribute("busy", "");

        this.animateFission(fissionRect, fissionColour);

        window.setTimeout(() => {
            try {
                if (this.gridTarget.isConnected) {
                    redistribute();
                    this.animateReleasedShows(slugs, fissionColour);
                }
            } finally {
                this.gridTarget.removeAttribute("busy");

                if (!wasInert) {
                    this.element.removeAttribute("inert");
                }
            }
        }, 350);
    }



    private animateReleasedShows(
        slugs: string[],
        colour: string
    ) {
        if (window.matchMedia(
            "(prefers-reduced-motion: reduce)"
        ).matches) return;

        const released = new Set(slugs);

        const cards = Array.from(
            this.gridTarget.querySelectorAll<HTMLElement>(
                ".featured-item"
            )
        );

        for (const card of cards) {
            if (!released.has(this.showSlug(card))) continue;

            const rect = card.getBoundingClientRect();

            if (
                rect.bottom < 0 ||
                rect.top > window.innerHeight
            ) continue;

            const poster = card.querySelector("img");

            if (!poster) continue;

            poster.animate([
                {
                    boxShadow: `0 0 0 2px ${colour}, 0 0 12px ${colour}`
                },
                {
                    boxShadow: `0 0 0 1px ${colour}`
                },
                {
                    boxShadow: "0 0 0 0 transparent"
                }
            ], {
                duration: 450,
                easing: "ease-out"
            });
        }
    }

    private animateFission(rect: DOMRect, colour: string) {
        if (window.matchMedia(
            "(prefers-reduced-motion: reduce)"
        ).matches) return;

        if (rect.width < 8 || rect.height < 8) return;

        const ns = "http://www.w3.org/2000/svg";
        const padding = 32;
        const width = rect.width + padding * 2;
        const height = rect.height + padding * 2;

        const svg = document.createElementNS(ns, "svg");

        svg.setAttribute("class", "fission-energy");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

        Object.assign(svg.style, {
            left: `${rect.left - padding}px`,
            top: `${rect.top - padding}px`,
            width: `${width}px`,
            height: `${height}px`,
            color: colour
        });

        const createRing = (className: string) => {
            const ring = document.createElementNS(ns, "rect");

            ring.setAttribute("x", String(padding));
            ring.setAttribute("y", String(padding));
            ring.setAttribute("width", String(rect.width));
            ring.setAttribute("height", String(rect.height));
            ring.setAttribute("rx", "12");
            ring.setAttribute("pathLength", "100");
            ring.setAttribute("class", className);

            svg.appendChild(ring);

            return ring;
        };

        const flash = createRing("fission-flash");

        document.body.appendChild(svg);

        const length = flash.getTotalLength();
        const fragments = 8;

        for (let i = 0; i < fragments; i++) {
            const segment = createRing("fission-fragment");

            const fraction = i / fragments;
            const point = flash.getPointAtLength(
                length * (fraction + 0.0625)
            );

            const dx = point.x - width / 2;
            const dy = point.y - height / 2;
            const magnitude = Math.hypot(dx, dy) || 1;
            const distance = 18 + (i % 3) * 4;

            segment.setAttribute(
                "stroke-dasharray", "11.5 88.5"
            );

            segment.setAttribute(
                "stroke-dashoffset", String(-fraction * 100)
            );

            segment.style.setProperty(
                "--fission-x",
                `${dx / magnitude * distance}px`
            );

            segment.style.setProperty(
                "--fission-y",
                `${dy / magnitude * distance}px`
            );
        }

        const cleanup = () => {
            svg.remove();

            window.removeEventListener("scroll", cleanup, true);
            window.removeEventListener("resize", cleanup);
        };

        window.addEventListener("scroll", cleanup, {
            capture: true,
            passive: true
        });

        window.addEventListener("resize", cleanup);

        window.setTimeout(cleanup, 350);
    }

    private updateLinkControls() {
        if (this.linking) {
            this.closeContextualGroupEditing();
        }

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
    private selectionBounds(groups: HTMLElement[]) {
        const rects = groups.map(group =>
            group.getBoundingClientRect()
        );

        return {
            left: Math.min(...rects.map(rect => rect.left)),
            top: Math.min(...rects.map(rect => rect.top)),
            right: Math.max(...rects.map(rect => rect.right)),
            bottom: Math.max(...rects.map(rect => rect.bottom))
        };
    }

    private removeBundleOutline() {
        this.bundleOutline?.remove();
        this.bundleOutline = null;
    }

    private selectionContour(groups: HTMLElement[]) {
        const padding = 5;

        const rects = groups.map(group => {
            const rect = group.getBoundingClientRect();

            return {
                left: rect.left - padding,
                top: rect.top - padding,
                right: rect.right + padding,
                bottom: rect.bottom + padding
            };
        });

        const bounds = {
            left: Math.min(...rects.map(rect => rect.left)),
            top: Math.min(...rects.map(rect => rect.top)),
            right: Math.max(...rects.map(rect => rect.right)),
            bottom: Math.max(...rects.map(rect => rect.bottom))
        };

        const selected = new Set(groups);

        const intersectsUnselected = this.sortableItems().some(item => {
            if (selected.has(item)) return false;
            if (!item.hasAttribute("data-linked-group")) return false;

            const rect = item.getBoundingClientRect();

            return rect.left < bounds.right &&
                rect.right > bounds.left &&
                rect.top < bounds.bottom &&
                rect.bottom > bounds.top;
        });

        // Use a common frame when it cannot imply false membership.
        const frames = intersectsUnselected ? rects : [bounds];

        const paths = frames.map(rect => {
            const x = rect.left;
            const y = rect.top;
            const w = rect.right - rect.left;
            const h = rect.bottom - rect.top;
            const r = Math.min(12, w / 2, h / 2);

            return [
                `M ${x + r} ${y}`,
                `H ${x + w - r}`,
                `Q ${x + w} ${y} ${x + w} ${y + r}`,
                `V ${y + h - r}`,
                `Q ${x + w} ${y + h} ${x + w - r} ${y + h}`,
                `H ${x + r}`,
                `Q ${x} ${y + h} ${x} ${y + h - r}`,
                `V ${y + r}`,
                `Q ${x} ${y} ${x + r} ${y}`,
                "Z"
            ].join(" ");
        });

        const topFrame = [...frames].sort((a, b) =>
            a.top - b.top ||
            (b.right - b.left) - (a.right - a.left)
        )[0];

        return {
            path: paths.join(" "),
            handleX: (topFrame.left + topFrame.right) / 2,
            handleY: topFrame.top
        };
    }

    private renderBundleOutline(path: string) {
        const ns = "http://www.w3.org/2000/svg";

        if (!this.bundleOutline) {
            const svg = document.createElementNS(ns, "svg");

            svg.setAttribute("class", "group-bundle-outline");
            svg.setAttribute("aria-hidden", "true");

            for (const name of [
                "bundle-outline-base",
                "bundle-outline-ants"
            ]) {
                const line = document.createElementNS(ns, "path");
                line.setAttribute("class", name);
                svg.appendChild(line);
            }

            document.body.appendChild(svg);
            this.bundleOutline = svg;
        }

        const viewport = this.bundleOutline.getBoundingClientRect();

        this.bundleOutline.setAttribute(
            "viewBox",
            `0 0 ${viewport.width} ${viewport.height}`
        );

        for (const line of Array.from(this.bundleOutline.children)) {
            line.setAttribute("d", path);
        }
    }

    private removeBundleHandle() {
        this.removeBundleOutline();
        this.bundleHandle?.remove();
        this.bundleHandle = null;
    }

    private positionBundleHandle = () => {
        if (this.bundleDrag || this.groupDrag) {
            this.clearInsertionIndicator();
            this.clearGroupDropIndicator();
        }

        if (!this.hasGridTarget || this.selectedGroupKeys.size === 0) return;

        const groups = this.selectedGroups();

        if (groups.length === 0) {
            this.removeBundleHandle();
            return;
        }

        const contour = this.selectionContour(groups);

        this.renderBundleOutline(contour.path);

        if (!this.bundleHandle) return;

        this.bundleHandle.style.left = `${contour.handleX}px`;
        this.bundleHandle.style.top = `${contour.handleY}px`;
    };

    private renderBundleHandle() {
        const groups = this.selectedGroups();

        if (groups.length === 0) {
            this.removeBundleHandle();
            return;
        }

        if (this.groupMarquee) {
            this.removeBundleHandle();
            this.renderBundleOutline(
                this.selectionContour(groups).path
            );
            return;
        }

        if (this.bundleDrag) return;

        if (!this.bundleHandle) {
            const handle = document.createElement("button");
            handle.type = "button";
            handle.className = "group-bundle-handle";
            handle.draggable = true;

            handle.setAttribute(
                "aria-label",
                "Move selected groups"
            );

            handle.title = "Move selected groups";

            const original = groups[0].querySelector(
                ".group-drag-handle"
            );

            handle.innerHTML = original?.innerHTML || "⋮⋮";

            handle.addEventListener(
                "dragstart",
                this.startBundleDrag
            );

            handle.addEventListener(
                "dragend",
                this.endBundleDrag
            );

            document.body.appendChild(handle);
            this.bundleHandle = handle;
        }

        this.positionBundleHandle();
    }

    private startBundleDrag = (event: DragEvent) => {
        if (
            !this.canSelectGroups() ||
            this.groupMarquee ||
            !event.dataTransfer
        ) {
            event.preventDefault();
            return;
        }

        const groups = this.selectedGroups();
        if (groups.length === 0) {
            event.preventDefault();
            return;
        }

        const columns = this.boardColumns();
        const board = this.boardLayouts[columns];

        const entries = groups.map(element => ({
            element,
            key: element.dataset.boardKey!,
            position: board[element.dataset.boardKey!],
            width: Math.min(
                columns,
                element.querySelectorAll(".featured-item").length
            )
        }));

        if (entries.some(entry => !entry.position)) {
            event.preventDefault();
            return;
        }

        const r = Math.min(...entries.map(entry => entry.position.r));
        const c = Math.min(...entries.map(entry => entry.position.c));

        const pieces: BundlePiece[] = entries.map(entry => ({
            ...entry,
            position: { ...entry.position },
            dr: entry.position.r - r,
            dc: entry.position.c - c
        }));

        const bounds = this.selectionBounds(groups);

        const preview = document.createElement("div");
        preview.className = "group-bundle-preview";
        preview.setAttribute("aria-hidden", "true");
        preview.inert = true;
        preview.style.width = `${bounds.right - bounds.left}px`;

        let previewHeight = 0;

        for (const piece of pieces) {
            const rect = piece.element.getBoundingClientRect();

            const clone = this.createGroupDragPreview(
                piece.element,
                false
            );

            clone.style.position = "absolute";
            clone.style.left = `${rect.left - bounds.left}px`;
            clone.style.top = `${rect.top - bounds.top}px`;

            preview.appendChild(clone);
        }

        document.body.appendChild(preview);

        for (const child of Array.from(preview.children)) {
            const clone = child as HTMLElement;

            previewHeight = Math.max(
                previewHeight,
                clone.offsetTop + clone.offsetHeight
            );
        }

        preview.style.height = `${previewHeight}px`;

        this.resetInsertion();

        this.bundleDrag = {
            boardPieces: this.boardPieces(columns),
            pieces,
            columns,
            position: { r, c },
            width: Math.max(...pieces.map(piece => piece.dc + piece.width)),
            height: Math.max(...pieces.map(piece => piece.dr + 1)),
            offsetX: event.clientX - bounds.left,
            offsetY: event.clientY - bounds.top,
            preview
        };

        event.dataTransfer.effectAllowed = "move";

        event.dataTransfer.setData(
            "text/plain",
            JSON.stringify(pieces.map(piece => piece.key))
        );

        event.dataTransfer.setDragImage(
            preview,
            Math.max(0, Math.round(this.bundleDrag.offsetX)),
            Math.max(0, Math.round(this.bundleDrag.offsetY))
        );

        for (const piece of pieces) {
            piece.element.classList.add("group-dragging");
        }

        requestAnimationFrame(() => {
            preview.remove();

            if (this.bundleDrag && this.bundleHandle) {
                this.bundleHandle.style.opacity = "0";
            }
        });
    };

    private endBundleDrag = () => {
        this.cancelBundleDrag();
    };

    private cancelBundleDrag() {
        const drag = this.bundleDrag;
        if (!drag) return;

        this.resetInsertion();

        this.clearGroupDropIndicator();

        for (const piece of drag.pieces) {
            piece.element.classList.remove("group-dragging");
        }

        drag.preview.remove();
        this.bundleDrag = null;

        if (this.bundleHandle) {
            this.bundleHandle.style.opacity = "";
        }

        this.renderBundleHandle();
    }

    private renderGroupSelection() {
        if (!this.hasGridTarget) return;

        const selected = new Set(this.selectedGroups());

        for (const item of this.sortableItems()) {
            item.classList.toggle(
                "group-bundle-selected",
                selected.has(item)
            );
        }

        this.gridTarget.classList.toggle(
            "group-bundle-active",
            selected.size > 0
        );

        this.renderBundleHandle();
    }

    private clearGroupSelection() {
        this.cancelBundleDrag();
        this.selectedGroupKeys.clear();
        this.renderGroupSelection();
    }

    suppressGroupContextMenu(event: MouseEvent) {
        if (this.groupMarquee || this.canSelectGroups()) {
            event.preventDefault();
        }
    }

    startGroupMarquee(event: MouseEvent) {
        this.suppressMarqueeClick = false;

        const rightButton = event.button === 2;
        const shiftDrag = event.button === 0 && event.shiftKey;

        if (
            (!rightButton && !shiftDrag) ||
            !this.canSelectGroups() ||
            this.groupMarquee
        ) return;

        const target = event.target;

        if (
            target instanceof Element &&
            target.closest("button, input, select, textarea")
        ) return;

        event.preventDefault();

        const rectangle = document.createElement("div");
        rectangle.className = "group-selection-marquee";
        rectangle.setAttribute("aria-hidden", "true");
        rectangle.style.left = `${event.clientX}px`;
        rectangle.style.top = `${event.clientY}px`;
        rectangle.style.width = "0px";
        rectangle.style.height = "0px";
        rectangle.style.visibility = "hidden";

        document.body.appendChild(rectangle);

        this.removeBundleHandle();

        this.groupMarquee = {
            button: event.button,
            moved: false,
            startX: event.clientX,
            startY: event.clientY,
            rectangle,
            initialKeys: new Set(this.selectedGroupKeys)
        };
    }

    moveGroupMarquee(event: MouseEvent) {
        const marquee = this.groupMarquee;
        if (!marquee) return;

        const buttonMask = marquee.button === 2 ? 2 : 1;

        if (!(event.buttons & buttonMask)) {
            this.cancelGroupMarquee();
            return;
        }

        event.preventDefault();
        this.updateGroupMarquee(event);
    }

    private updateGroupMarquee(event: MouseEvent) {
        const marquee = this.groupMarquee;
        if (!marquee) return;

        const left = Math.min(marquee.startX, event.clientX);
        const top = Math.min(marquee.startY, event.clientY);
        const right = Math.max(marquee.startX, event.clientX);
        const bottom = Math.max(marquee.startY, event.clientY);

        if (!marquee.moved) {
            if (right - left < 4 && bottom - top < 4) return;
            marquee.moved = true;
        }

        marquee.rectangle.style.visibility = "visible";
        marquee.rectangle.style.left = `${left}px`;
        marquee.rectangle.style.top = `${top}px`;
        marquee.rectangle.style.width = `${right - left}px`;
        marquee.rectangle.style.height = `${bottom - top}px`;

        const nextKeys = new Set<string>();

        for (const item of this.sortableItems()) {
            const key = item.dataset.boardKey;

            if (!item.hasAttribute("data-linked-group") || !key) {
                continue;
            }

            const rect = item.getBoundingClientRect();

            if (
                rect.left < right &&
                rect.right > left &&
                rect.top < bottom &&
                rect.bottom > top
            ) {
                nextKeys.add(key);
            }
        }

        this.selectedGroupKeys = nextKeys;
        this.renderGroupSelection();
    }

    endGroupMarquee(event: MouseEvent) {
        const marquee = this.groupMarquee;

        if (!marquee || event.button !== marquee.button) return;

        event.preventDefault();
        this.updateGroupMarquee(event);

        this.suppressMarqueeClick =
            marquee.button === 0 && marquee.moved;

        marquee.rectangle.remove();
        this.groupMarquee = null;
        this.renderGroupSelection();
    }

    private cancelGroupMarquee() {
        const marquee = this.groupMarquee;
        if (!marquee) return;

        marquee.rectangle.remove();
        this.selectedGroupKeys = new Set(marquee.initialKeys);
        this.suppressMarqueeClick = marquee.button === 0;
        this.groupMarquee = null;

        this.renderGroupSelection();
    }

    handleGroupSelectionBlur() {
        this.cancelGroupMarquee();
        this.cancelBundleDrag();
        this.cancelGroupDrag();
    }

    handleGroupSelectionMouseDown(event: MouseEvent) {
        if (event.button !== 0) return;

        this.suppressMarqueeClick = false;

        if (
            !this.canSelectGroups() ||
            event.shiftKey ||
            this.groupMarquee
        ) return;

        const target = event.target;

        if (
            target instanceof Element &&
            target.closest(
                "#favourites-grid [data-linked-group], .group-bundle-handle"
            )
        ) return;

        this.clearGroupSelection();
    }

    guardMarqueeClick(event: MouseEvent) {
        if (!this.suppressMarqueeClick) return;

        this.suppressMarqueeClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    guardMarqueeDrag(event: DragEvent) {
        if (this.groupMarquee) event.preventDefault();
    }

    private canSelectGroups(): boolean {
        return this.hasGridTarget &&
            this.isIntertwined() &&
            !this.linking &&
            !this.groupDrag &&
            !this.bundleDrag &&
            !this.gridTarget.hasAttribute("busy");
    }

    private selectedGroups(): HTMLElement[] {
        return this.sortableItems().filter(item => {
            const key = item.dataset.boardKey;

            return item.hasAttribute("data-linked-group") &&
                key !== undefined &&
                this.selectedGroupKeys.has(key);
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

            this.renderBoardLayout();
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
