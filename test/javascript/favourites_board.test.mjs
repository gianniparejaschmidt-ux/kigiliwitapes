import test from "node:test";
import assert from "node:assert/strict";

import {
    createEmptyLayouts,
    groupKey,
    fitsBoard,
    occupiedCells,
    canPlace,
    reconcileBoard,
    updateGroupPosition,
    planBoardInsertion,
    planBoardMove,
    isValidBoard
} from "../../app/javascript/favourites_board.ts";

const A = groupKey(["a1", "a2"]);
const B = groupKey(["b1", "b2"]);
const C = groupKey(["c1", "c2"]);
const D = groupKey(["d1", "d2"]);

const pos = (r, c) => ({ r, c });
const piece = (key, width = 2) => ({ key, width });

const moving = (key, r, c, dr = 0, dc = 0, width = 2) => ({
    key,
    width,
    position: pos(r, c),
    dr,
    dc
});

test("group identity is independent of concert order", () => {
    assert.equal(
        groupKey(["a1", "a2"]),
        groupKey(["a2", "a1"])
    );
});

test("responsive layouts are independent", () => {
    const layouts = createEmptyLayouts();

    layouts[2][A] = pos(1, 1);

    assert.deepEqual(layouts[3], {});
    assert.deepEqual(layouts[6], {});
});

test("groups fit within supported column boundaries", () => {
    for (const columns of [2, 3, 6]) {
        assert.equal(
            fitsBoard(pos(1, 1), columns, columns),
            true
        );

        assert.equal(
            fitsBoard(pos(1, 2), columns, columns),
            false
        );
    }
});

test("invalid rows, columns and widths are rejected", () => {
    assert.equal(fitsBoard(pos(0, 1), 2, 6), false);
    assert.equal(fitsBoard(pos(1, 0), 2, 6), false);
    assert.equal(fitsBoard(pos(1.5, 1), 2, 6), false);
    assert.equal(fitsBoard(pos(10001, 1), 2, 6), false);
    assert.equal(fitsBoard(pos(1, 1), 0, 6), false);
});

test("occupied cells match the group footprint", () => {
    assert.deepEqual(
        occupiedCells(pos(2, 3), 3),
        ["2:3", "2:4", "2:5"]
    );
});

test("a group does not collide with itself", () => {
    const board = { [A]: pos(1, 1) };

    assert.equal(
        canPlace(board, piece(A), pos(1, 2), 6, [piece(A)]),
        true
    );
});

test("partial collisions are rejected", () => {
    const board = { [B]: pos(1, 3) };

    assert.equal(
        canPlace(
            board, piece(A), pos(1, 2), 6,
            [piece(A), piece(B)]
        ),
        false
    );
});

test("adjacent groups do not collide", () => {
    const board = { [B]: pos(1, 3) };

    assert.equal(
        canPlace(
            board, piece(A), pos(1, 1), 6,
            [piece(A), piece(B)]
        ),
        true
    );
});

test("reconciliation preserves valid intentional gaps", () => {
    const board = {
        [A]: pos(1, 1),
        [B]: pos(4, 5)
    };

    assert.deepEqual(
        reconcileBoard(board, [piece(A), piece(B)], 6),
        board
    );
});

test("reconciliation repairs overlapping positions", () => {
    const board = {
        [A]: pos(1, 1),
        [B]: pos(1, 1)
    };

    assert.deepEqual(
        reconcileBoard(board, [piece(A), piece(B)], 6),
        {
            [A]: pos(1, 1),
            [B]: pos(1, 3)
        }
    );
});

test("reconciliation removes obsolete group positions", () => {
    const board = {
        [A]: pos(1, 1),
        [B]: pos(2, 1)
    };

    assert.deepEqual(
        reconcileBoard(board, [piece(A)], 6),
        { [A]: pos(1, 1) }
    );
});

test("reconciliation does not mutate the original board", () => {
    const board = {
        [A]: pos(1, 1),
        [B]: pos(1, 1)
    };

    const original = structuredClone(board);

    reconcileBoard(board, [piece(A), piece(B)], 6);

    assert.deepEqual(board, original);
});

test("new groups are placed below existing groups", () => {
    const layouts = createEmptyLayouts();

    layouts[6][A] = pos(3, 1);

    const next = updateGroupPosition(
        layouts, null, ["b1", "b2"]
    );

    assert.deepEqual(next[6][B], pos(4, 1));
});

test("editing a group preserves its position when possible", () => {
    const layouts = createEmptyLayouts();

    layouts[6][A] = pos(2, 3);

    const slugs = ["a1", "a2", "a3"];

    const next = updateGroupPosition(
        layouts, ["a1", "a2"], slugs
    );

    assert.deepEqual(
        next[6][groupKey(slugs)],
        pos(2, 3)
    );

    assert.equal(next[6][A], undefined);
});

test("removing the first group removes leading empty rows", () => {
    const layouts = createEmptyLayouts();

    layouts[6] = {
        [A]: pos(1, 1),
        [B]: pos(4, 1),
        [C]: pos(6, 1)
    };

    const next = updateGroupPosition(
        layouts, ["a1", "a2"], null
    );

    assert.deepEqual(next[6], {
        [B]: pos(1, 1),
        [C]: pos(3, 1)
    });
});

test("individual insertion above the first row", () => {
    const board = {
        [A]: pos(1, 1),
        [B]: pos(2, 1)
    };

    const next = planBoardInsertion(
        board,
        [piece(A), piece(B)],
        [moving(B, 2, 1)],
        pos(1, 1),
        2
    );

    assert.deepEqual(next, {
        [A]: pos(2, 1),
        [B]: pos(1, 1)
    });
});

test("individual insertion below the last row", () => {
    const board = {
        [A]: pos(1, 1),
        [B]: pos(2, 1)
    };

    const next = planBoardInsertion(
        board,
        [piece(A), piece(B)],
        [moving(A, 1, 1)],
        pos(3, 1),
        2
    );

    assert.deepEqual(next, {
        [A]: pos(2, 1),
        [B]: pos(1, 1)
    });
});

test("insertion preserves unrelated intentional gaps", () => {
    const board = {
        [A]: pos(1, 1),
        [B]: pos(4, 1),
        [C]: pos(6, 1)
    };

    const next = planBoardInsertion(
        board,
        [piece(A), piece(B), piece(C)],
        [moving(C, 6, 1)],
        pos(1, 1),
        2
    );

    assert.deepEqual(next, {
        [A]: pos(2, 1),
        [B]: pos(5, 1),
        [C]: pos(1, 1)
    });
});

test("bundle insertion preserves internal row gaps", () => {
    const board = {
        [A]: pos(1, 1),
        [B]: pos(3, 1),
        [C]: pos(4, 1)
    };

    const next = planBoardInsertion(
        board,
        [piece(A), piece(B), piece(C)],
        [
            moving(A, 1, 1),
            moving(B, 3, 1, 2)
        ],
        pos(5, 1),
        2
    );

    assert.ok(next);
    assert.equal(next[B].r - next[A].r, 2);
});

test("bundle insertion preserves horizontal offsets", () => {
    const board = {
        [A]: pos(1, 1),
        [B]: pos(1, 5),
        [C]: pos(2, 1)
    };

    const next = planBoardInsertion(
        board,
        [piece(A), piece(B), piece(C)],
        [
            moving(A, 1, 1),
            moving(B, 1, 5, 0, 4)
        ],
        pos(3, 1),
        6
    );

    assert.ok(next);
    assert.equal(next[A].r, next[B].r);
    assert.equal(next[B].c - next[A].c, 4);
});

test("insertion preserves source rows that remain occupied", () => {
    const board = {
        [A]: pos(1, 1),
        [B]: pos(1, 3),
        [C]: pos(2, 1)
    };

    const next = planBoardInsertion(
        board,
        [piece(A), piece(B), piece(C)],
        [moving(A, 1, 1)],
        pos(3, 1),
        6
    );

    assert.deepEqual(next, {
        [A]: pos(3, 1),
        [B]: pos(1, 3),
        [C]: pos(2, 1)
    });
});

test("out-of-bounds insertion is rejected", () => {
    const board = { [A]: pos(1, 1) };

    assert.equal(
        planBoardInsertion(
            board,
            [piece(A)],
            [moving(A, 1, 1)],
            pos(2, 2),
            2
        ),
        null
    );
});

test("stale drag positions are rejected", () => {
    const board = { [A]: pos(2, 1) };

    assert.equal(
        planBoardInsertion(
            board,
            [piece(A)],
            [moving(A, 1, 1)],
            pos(3, 1),
            2
        ),
        null
    );
});

test("insertion planning does not mutate the original board", () => {
    const board = {
        [A]: pos(1, 1),
        [B]: pos(2, 1)
    };

    const original = structuredClone(board);

    planBoardInsertion(
        board,
        [piece(A), piece(B)],
        [moving(A, 1, 1)],
        pos(3, 1),
        2
    );

    assert.deepEqual(board, original);
});

test("empty bundle insertion is rejected", () => {
    assert.equal(
        planBoardInsertion({}, [], [], pos(1, 1), 6),
        null
    );
});


test("bundle move preserves gaps and leaves original board unchanged", () => {
    const board = { [A]: pos(1, 1), [B]: pos(1, 5), [C]: pos(2, 3) };
    const original = structuredClone(board);
    const result = planBoardMove(board, [piece(A), piece(B), piece(C)],
        [moving(A, 1, 1), moving(B, 1, 5, 0, 4)], pos(1, 1), pos(2, 1), 6);
    assert.deepEqual(result, { board: { [A]: pos(2, 1), [B]: pos(2, 5), [C]: pos(2, 3) }, swapping: false });
    assert.deepEqual(board, original);
});

test("bundle move may overlap its own source", () => {
    const board = { [A]: pos(1, 1) };
    assert.deepEqual(planBoardMove(board, [piece(A)], [moving(A, 1, 1)],
        pos(1, 1), pos(1, 2), 6), { board: { [A]: pos(1, 2) }, swapping: false });
});

test("exact footprint swap allows different group compositions", () => {
    const board = { [A]: pos(1, 1), [B]: pos(1, 3), [C]: pos(2, 1) };
    const result = planBoardMove(board, [piece(A), piece(B), piece(C, 4)],
        [moving(A, 1, 1), moving(B, 1, 3, 0, 2)], pos(1, 1), pos(2, 1), 6);
    assert.deepEqual(result, { board: { [A]: pos(2, 1), [B]: pos(2, 3), [C]: pos(1, 1) }, swapping: true });
});

test("partial destination collisions are rejected", () => {
    const board = { [A]: pos(1, 1), [B]: pos(2, 2) };
    assert.equal(planBoardMove(board, [piece(A), piece(B)], [moving(A, 1, 1)],
        pos(1, 1), pos(2, 1), 6), null);
});

test("swap cannot overlap its own source", () => {
    const board = { [A]: pos(1, 1), [B]: pos(1, 3), [C]: pos(1, 5) };
    assert.equal(planBoardMove(board, [piece(A), piece(B), piece(C)],
        [moving(A, 1, 1), moving(B, 1, 3, 0, 2)], pos(1, 1), pos(1, 3), 6), null);
});

test("bundle movement rejects out-of-bounds and stale positions", () => {
    const board = { [A]: pos(1, 1) };
    assert.equal(planBoardMove(board, [piece(A)], [moving(A, 1, 1)], pos(1, 1), pos(1, 6), 6), null);
    assert.equal(planBoardMove(board, [piece(A)], [moving(A, 2, 1)], pos(2, 1), pos(3, 1), 6), null);
});

test("empty bundle movement is rejected", () => {
    assert.equal(planBoardMove({}, [], [], pos(1, 1), pos(2, 1), 6), null);
});

test("unchanged bundle position produces an unchanged board", () => {
    const board = { [A]: pos(1, 1) };
    assert.deepEqual(planBoardMove(board, [piece(A)], [moving(A, 1, 1)],
        pos(1, 1), pos(1, 1), 6), { board, swapping: false });
});


test("board validation rejects missing, overlapping and duplicate pieces", () => {
    assert.equal(isValidBoard({}, [piece(A)], 6), false);
    assert.equal(isValidBoard({ [A]: pos(1, 1), [B]: pos(1, 2) }, [piece(A), piece(B)], 6), false);
    assert.equal(isValidBoard({ [A]: pos(1, 1) }, [piece(A), piece(A)], 6), false);
    assert.equal(isValidBoard({ [A]: pos(1, 6) }, [piece(A)], 6), false);
});

test("large board validation and insertion preserve all 250 groups", () => {
    const board = {};
    const pieces = [];
    for (let i = 0; i < 250; i++) {
        const key = String(i);
        board[key] = pos(i + 1, 1);
        pieces.push(piece(key));
    }
    assert.equal(isValidBoard(board, pieces, 2), true);
    const result = planBoardInsertion(board, pieces, [moving("249", 250, 1)], pos(1, 1), 2);
    assert.ok(result);
    assert.equal(Object.keys(result).length, 250);
    assert.deepEqual(result["249"], pos(1, 1));
    assert.equal(isValidBoard(result, pieces, 2), true);
});
