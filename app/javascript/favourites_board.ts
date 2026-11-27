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
const STORAGE_KEY = "gizz-tapes:favourite-board-positions-v1";
function isValidGroupKey(key: string): boolean {
    try {
        const slugs = JSON.parse(key);

        return Array.isArray(slugs) &&
            slugs.length >= 2 &&
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
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return layouts;

        const saved = JSON.parse(raw);

        for (const columns of [2, 3, 6] as const) {
            const board = saved?.[columns];

            if (!board || typeof board !== "object"
                || Array.isArray(board)) continue;

            for (const [key, value] of Object.entries(board)) {
                if (!isValidGroupKey(key)) continue;
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

        const previousPosition = previousKey
            ? board[previousKey]
            : undefined;

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

            if (positions.length > 0) {
                const firstRow = Math.min(
                    ...positions.map(position => position.r)
                );

                if (previousPosition.r < firstRow) {
                    for (const [key, position] of Object.entries(board)) {
                        board[key] = {
                            ...position,
                            r: position.r - firstRow + 1
                        };
                    }
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
