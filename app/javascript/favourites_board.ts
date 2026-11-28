export type BoardColumns = 2 | 3 | 6;

export interface BoardPosition {
    r: number;
    c: number;
}

export type Board = Record<string, BoardPosition>;

export type BoardLayouts = Record<BoardColumns, Board>;

export interface BoardPiece {
    key: string;
    width: number;
}

export function createEmptyLayouts(): BoardLayouts {
    return {
        2: {},
        3: {},
        6: {}
    };
}

export function fitsBoard(
    position: BoardPosition,
    width: number,
    columns: BoardColumns
): boolean {
    return Number.isInteger(position.r)
        && Number.isInteger(position.c)
        && Number.isInteger(width)
        && position.r >= 1
        && position.r <= 10000
        && position.c >= 1
        && width >= 1
        && position.c + width - 1 <= columns;
}

export function occupiedCells(
    position: BoardPosition,
    width: number
): string[] {
    return Array.from(
        { length: width },
        (_, i) => `${position.r}:${position.c + i}`
    );
}

export function groupKey(slugs: string[]): string {
    return JSON.stringify([...slugs].sort());
}
export function canPlace(
    board: Board,
    piece: BoardPiece,
    position: BoardPosition,
    columns: BoardColumns,
    pieces: BoardPiece[]
): boolean {
    if (!fitsBoard(position, piece.width, columns)) {
        return false;
    }

    const cells = new Set(
        occupiedCells(position, piece.width)
    );

    for (const other of pieces) {
        if (other.key === piece.key) continue;

        const existing = board[other.key];
        if (!existing) continue;

        if (occupiedCells(existing, other.width)
            .some(cell => cells.has(cell))) {
            return false;
        }
    }

    return true;
}

export function isValidBoard(
    board: Board,
    pieces: BoardPiece[],
    columns: BoardColumns
): boolean {
    const cells = new Set<string>();
    const keys = new Set<string>();
    for (const piece of pieces) {
        const position = board[piece.key];
        if (keys.has(piece.key) || !position ||
            !fitsBoard(position, piece.width, columns)) return false;
        keys.add(piece.key);
        for (const cell of occupiedCells(position, piece.width)) {
            if (cells.has(cell)) return false;
            cells.add(cell);
        }
    }
    return true;
}

export function findFirstAvailable(
    board: Board,
    piece: BoardPiece,
    columns: BoardColumns,
    pieces: BoardPiece[]
): BoardPosition | null {
    if (!fitsBoard({ r: 1, c: 1 }, piece.width, columns)) {
        return null;
    }

    for (let r = 1; r <= 10000; r++) {
        for (let c = 1; c <= columns - piece.width + 1; c++) {
            const position = { r, c };

            if (canPlace(board, piece, position, columns, pieces)) {
                return position;
            }
        }
    }

    return null;
}
export function reconcileBoard(
    saved: Board,
    pieces: BoardPiece[],
    columns: BoardColumns
): Board | null {
    const next: Board = {};
    const pending: BoardPiece[] = [];

    for (const piece of pieces) {
        const position = saved[piece.key];

        if (position && canPlace(
            next, piece, position, columns, pieces
        )) {
            next[piece.key] = { ...position };
        } else {
            pending.push(piece);
        }
    }

    for (const piece of pending) {
        const position = findFirstAvailable(
            next, piece, columns, pieces
        );

        if (!position) return null;

        next[piece.key] = position;
    }

    return next;
}
const LEGACY_STORAGE_KEY =
    "gizz-tapes:favourite-board-positions-v1";

const STORAGE_KEY =
    "gizz-tapes:favourite-board-positions-v2";
function isValidSpatialKey(key: string): boolean {
    try {
        const slugs = JSON.parse(key);

        return Array.isArray(slugs) &&
            slugs.length >= 1 &&
            slugs.every(slug =>
                typeof slug === "string" && slug.length > 0
            ) &&
            new Set(slugs).size === slugs.length &&
            groupKey(slugs) === key;
    } catch {
        return false;
    }
}
export function loadBoardLayouts(): BoardLayouts {
    const layouts = createEmptyLayouts();

    try {
        const raw = localStorage.getItem(STORAGE_KEY)
            ?? localStorage.getItem(LEGACY_STORAGE_KEY);
        if (!raw) return layouts;

        const saved = JSON.parse(raw);

        for (const columns of [2, 3, 6] as const) {
            const board = saved?.[columns];

            if (!board || typeof board !== "object"
                || Array.isArray(board)) continue;

            for (const [key, value] of Object.entries(board)) {
                if (!isValidSpatialKey(key)) continue;
                if (!value || typeof value !== "object") continue;

                const position = value as BoardPosition;

                if (fitsBoard(position, 1, columns)) {
                    layouts[columns][key] = {
                        r: position.r,
                        c: position.c
                    };
                }
            }
        }
    } catch (error) {
        console.warn("Unable to load favourite board positions", error);
    }

    return layouts;
}

export function saveBoardLayouts(layouts: BoardLayouts): boolean {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
        return true;
    } catch (error) {
        console.warn("Unable to save favourite board positions", error);
        return false;
    }
}
export function updateGroupPosition(
    layouts: BoardLayouts,
    previousSlugs: string[] | null,
    nextSlugs: string[] | null
): BoardLayouts {
    const nextLayouts = createEmptyLayouts();

    for (const columns of [2, 3, 6] as const) {
        const board = { ...layouts[columns] };

        const previousKey = previousSlugs
            ? groupKey(previousSlugs)
            : null;

        const consumedAnchors = (nextSlugs ?? [])
            .map(slug => anchorKey(slug))
            .filter(key => board[key]);

        const inheritedPosition = consumedAnchors
            .map(key => board[key])
            .sort((a, b) => a.r - b.r || a.c - b.c)[0];

        const previousPosition = (
            previousKey ? board[previousKey] : undefined
        ) ?? inheritedPosition;

        for (const key of consumedAnchors) {
            delete board[key];
        }

        if (previousKey) {
            delete board[previousKey];
        }

        if (nextSlugs) {
            const nextKey = groupKey(nextSlugs);

            const lastRow = Math.max(
                0,
                ...Object.values(board).map(position => position.r)
            );

                        const piece: BoardPiece = {
                key: nextKey,
                width: Math.min(columns, nextSlugs.length)
            };

            const pieces: BoardPiece[] = Object.keys(board).map(key => ({
                key,
                width: Math.min(
                    columns,
                    (JSON.parse(key) as string[]).length
                )
            }));

            board[nextKey] =
                previousPosition &&
                canPlace(board, piece, previousPosition, columns, pieces)
                    ? { ...previousPosition }
                    : { r: lastRow + 1, c: 1 };
        }
        if (previousPosition && !nextSlugs) {
            const positions = Object.values(board);
            const vacatedRow = previousPosition.r;

            if (
                positions.length > 0 &&
                !positions.some(position => position.r === vacatedRow)
            ) {
                const firstRow = Math.min(
                    ...positions.map(position => position.r)
                );

                for (const [key, position] of Object.entries(board)) {
                    board[key] = {
                        ...position,
                        r: vacatedRow < firstRow
                            ? position.r - firstRow + 1
                            : position.r - (position.r > vacatedRow ? 1 : 0)
                    };
                }
            }
        }

        nextLayouts[columns] = board;
    }

    return nextLayouts;
}

export interface InsertionPiece extends BoardPiece {
    position: BoardPosition;
    dr: number;
    dc: number;
}

export function planBoardInsertion(
    board: Board,
    pieces: BoardPiece[],
    moving: InsertionPiece[],
    position: BoardPosition,
    columns: BoardColumns
): Board | null {
    if (
        moving.length === 0 ||
        !Number.isInteger(position.r) ||
        position.r < 1
    ) return null;

    const keys = new Set(moving.map(piece => piece.key));

    const height = Math.max(
        ...moving.map(piece => piece.dr + 1)
    );

    const next: Board = {};
    const vacated = new Set<number>();

    for (const piece of moving) {
        const current = board[piece.key];

        if (
            !current ||
            current.r !== piece.position.r ||
            current.c !== piece.position.c
        ) return null;

        if (!fitsBoard({
            r: position.r + piece.dr,
            c: position.c + piece.dc
        }, piece.width, columns)) return null;
    }

    for (const [key, current] of Object.entries(board)) {
        const row = current.r +
            (current.r >= position.r ? height : 0);

        if (keys.has(key)) {
            vacated.add(row);
        } else {
            next[key] = { r: row, c: current.c };
        }
    }

    for (const piece of moving) {
        next[piece.key] = {
            r: position.r + piece.dr,
            c: position.c + piece.dc
        };
    }

    // Remove only empty rows vacated by the moving pieces.
    const occupied = new Set(
        Object.values(next).map(value => value.r)
    );

    const empty = Array.from(vacated)
        .filter(row => !occupied.has(row));

    for (const value of Object.values(next)) {
        value.r -= empty.filter(row => row < value.r).length;
    }

    if (!isValidBoard(next, pieces, columns)) return null;

    return next;
}

/** Plan a translated bundle or exact-footprint swap without mutating the board. */
export function planBoardMove(
    board: Board,
    pieces: BoardPiece[],
    moving: InsertionPiece[],
    origin: BoardPosition,
    position: BoardPosition,
    columns: BoardColumns
): { board: Board; swapping: boolean } | null {
    if (moving.length === 0) return null;
    const selectedKeys = new Set(
        moving.map(piece => piece.key)
    );

    const sourceCells = new Set<string>();
    const destinationCells = new Set<string>();

    for (const piece of moving) {
        const current = board[piece.key];

        if (
            !current ||
            current.r !== piece.position.r ||
            current.c !== piece.position.c
        ) return null;

        const next = {
            r: position.r + piece.dr,
            c: position.c + piece.dc
        };

        if (!fitsBoard(next, piece.width, columns)) {
            return null;
        }

        for (const cell of occupiedCells(current, piece.width)) {
            sourceCells.add(cell);
        }

        for (const cell of occupiedCells(next, piece.width)) {
            if (destinationCells.has(cell)) return null;
            destinationCells.add(cell);
        }
    }

    const others = pieces
        .filter(piece => !selectedKeys.has(piece.key))
        .map(piece => ({ ...piece, position: board[piece.key] }));

    if (others.some(piece => !piece.position)) return null;

    const targets = others.filter(piece =>
        occupiedCells(piece.position, piece.width)
            .some(cell => destinationCells.has(cell))
    );

    const nextBoard: Board = { ...board };

    if (targets.length > 0) {
        // Swaps require disjoint source and destination footprints.
        if (
            Array.from(sourceCells).some(cell =>
                destinationCells.has(cell)
            )
        ) return null;

        const targetCells = new Set(
            targets.flatMap(piece =>
                occupiedCells(piece.position, piece.width)
            )
        );

        // Every occupied destination cell must match exactly.
        if (
            targetCells.size !== destinationCells.size ||
            Array.from(targetCells).some(cell =>
                !destinationCells.has(cell)
            )
        ) return null;

        const dr = origin.r - position.r;
        const dc = origin.c - position.c;

        for (const piece of targets) {
            const next = {
                r: piece.position.r + dr,
                c: piece.position.c + dc
            };

            if (!fitsBoard(next, piece.width, columns)) {
                return null;
            }

            nextBoard[piece.key] = next;
        }
    }

    for (const piece of moving) {
        nextBoard[piece.key] = {
            r: position.r + piece.dr,
            c: position.c + piece.dc
        };
    }

    // Validate the complete resulting board before saving anything.
    if (!isValidBoard(nextBoard, pieces, columns)) return null;

    return {
        board: nextBoard,
        swapping: targets.length > 0
    };
}


/** A deliberately positioned independent concert. */
export function anchorKey(slug: string): string {
    return groupKey([slug]);
}

/** Derive spatial footprints from canonical piece identities. */
function spatialPieces(
    board: Board,
    columns: BoardColumns
): BoardPiece[] | null {
    const pieces: BoardPiece[] = [];
    const used = new Set<string>();

    for (const key of Object.keys(board)) {
        let slugs: unknown;

        try {
            slugs = JSON.parse(key);
        } catch {
            return null;
        }

        if (
            !Array.isArray(slugs) ||
            slugs.length === 0 ||
            slugs.some(slug =>
                typeof slug !== "string" ||
                !slug ||
                used.has(slug)
            ) ||
            new Set(slugs).size !== slugs.length ||
            groupKey(slugs) !== key
        ) return null;

        slugs.forEach(slug => used.add(slug));

        pieces.push({
            key,
            width: Math.min(columns, slugs.length)
        });
    }

    return pieces;
}

/** Plan an initial anchor without displacing existing pieces. */
export function planAnchorPlacement(
    layouts: BoardLayouts,
    slug: string,
    columns: BoardColumns,
    position: BoardPosition
): BoardLayouts | null {
    if (!slug || !fitsBoard(position, 1, columns)) {
        return null;
    }

    const key = anchorKey(slug);
    const next = createEmptyLayouts();

    for (const width of [2, 3, 6] as const) {
        const current = layouts[width];
        const pieces = spatialPieces(current, width);

        if (
            !pieces ||
            !isValidBoard(current, pieces, width)
        ) return null;

        // A concert cannot belong to two spatial pieces.
        if (pieces.some(piece =>
            (JSON.parse(piece.key) as string[]).includes(slug)
        )) return null;

        const lastRow = Math.max(
            0,
            ...Object.values(current).map(value => value.r)
        );

        const trailingPieces = pieces.filter(piece =>
            current[piece.key].r === lastRow
        );

        const nextColumn = Math.max(
            0,
            ...trailingPieces.map(piece =>
                current[piece.key].c + piece.width - 1
            )
        ) + 1;

        const canExtendAnchorRow =
            trailingPieces.length > 0 &&
            trailingPieces.every(piece => piece.width === 1) &&
            nextColumn <= width;

        const destination = width === columns
            ? position
            : canExtendAnchorRow
                ? { r: lastRow, c: nextColumn }
                : { r: lastRow + 1, c: 1 };

        const anchor = { key, width: 1 };

        if (!canPlace(
            current, anchor, destination, width, pieces
        )) return null;

        next[width] = Object.fromEntries(
            Object.entries(current).map(
                ([id, value]) => [id, { ...value }]
            )
        );

        next[width][key] = { ...destination };

        if (!isValidBoard(
            next[width], [...pieces, anchor], width
        )) return null;
    }

    return next;
}

/** Release an anchor and restore automatic positioning. */
export function planAnchorRelease(
    layouts: BoardLayouts,
    slug: string
): BoardLayouts | null {
    if (!slug) return null;

    const key = anchorKey(slug);

    if (![2, 3, 6].some(columns =>
        layouts[columns as BoardColumns][key]
    )) return null;

    return updateGroupPosition(layouts, [slug], null);
}


export function synchronizeSpatialOrder(
    layouts: BoardLayouts,
    sourceColumns: BoardColumns
): BoardLayouts {
    const source = layouts[sourceColumns];

    const orderedKeys = (board: Board) =>
        Object.keys(board).sort((a, b) =>
            board[a].r - board[b].r ||
            board[a].c - board[b].c
        );

    const order = orderedKeys(source);
    const sourcePieces = spatialPieces(source, sourceColumns);

    if (
        !sourcePieces ||
        !isValidBoard(source, sourcePieces, sourceColumns)
    ) return layouts;

    const next = { ...layouts };

    for (const columns of [2, 3, 6] as const) {
        if (columns === sourceColumns) continue;

        const current = layouts[columns];
        const currentOrder = orderedKeys(current);

        // Do not discard pieces when layouts contain
        // different collections of spatial identities.
        if (
            currentOrder.length !== order.length ||
            order.some(key => !current[key])
        ) continue;

        // Preserve compatible responsive positions.
        if (order.every(
            (key, index) => key === currentOrder[index]
        )) continue;

        const projected: Board = {};

        let row = 1;
        let column = 1;
        let previousSourceRow: number | null = null;

        for (const key of order) {
            const sourceRow = source[key].r;
            const width = Math.min(
                columns,
                (JSON.parse(key) as string[]).length
            );

            // Distinct source rows remain distinct.
            if (
                previousSourceRow !== null &&
                sourceRow !== previousSourceRow
            ) {
                row += sourceRow - previousSourceRow;
                column = 1;
            }

            // Wrap pieces that cannot fit horizontally.
            if (column + width - 1 > columns) {
                row++;
                column = 1;
            }

            projected[key] = { r: row, c: column };

            column += width;
            previousSourceRow = sourceRow;
        }

        const pieces = spatialPieces(projected, columns);

        if (
            pieces &&
            isValidBoard(projected, pieces, columns)
        ) {
            next[columns] = projected;
        }
    }

    return next;
}


export function planGroupFission(
    layouts: BoardLayouts,
    slugs: string[]
): BoardLayouts | null {
    if (
        slugs.length < 2 ||
        slugs.some(slug => !slug) ||
        new Set(slugs).size !== slugs.length
    ) return null;

    const key = groupKey(slugs);
    const next = createEmptyLayouts();

    for (const columns of [2, 3, 6] as const) {
        const current = layouts[columns];
        const pieces = spatialPieces(current, columns);

        if (
            !pieces ||
            !isValidBoard(current, pieces, columns)
        ) return null;

        const lastRow = Math.max(
            0,
            ...Object.values(current).map(position => position.r)
        );

        const origin = current[key] ??
            { r: lastRow + 1, c: 1 };

        const extraRows =
            Math.ceil(slugs.length / columns) - 1;

        const result: Board = {};

        for (const [id, position] of Object.entries(current)) {
            if (id === key) continue;

            result[id] = {
                r: position.r +
                    (position.r > origin.r ? extraRows : 0),
                c: position.c
            };
        }

        for (const [index, slug] of slugs.entries()) {
            const id = anchorKey(slug);

            if (result[id]) return null;

            result[id] = {
                r: origin.r + Math.floor(index / columns),
                c: origin.c + index % columns
            };
        }

        const resultPieces = spatialPieces(result, columns);

        if (
            !resultPieces ||
            !isValidBoard(result, resultPieces, columns)
        ) return null;

        next[columns] = result;
    }

    return next;
}
