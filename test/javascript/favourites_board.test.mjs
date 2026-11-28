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
    isValidBoard,
    anchorKey,
    planAnchorPlacement,
    planAnchorRelease,
    synchronizeSpatialOrder,
    planGroupFission
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


test("splitting removes a vacated internal row", () => {
    for (const columns of [2, 3, 6]) {
        const layouts = createEmptyLayouts();

        layouts[columns] = {
            [A]: pos(1, 1),
            [B]: pos(2, 1),
            [C]: pos(3, 1)
        };

        const next = updateGroupPosition(
            layouts, ["b1", "b2"], null
        );

        assert.deepEqual(next[columns], {
            [A]: pos(1, 1),
            [C]: pos(2, 1)
        });
    }
});

test("splitting preserves partially occupied rows", () => {
    const layouts = createEmptyLayouts();

    layouts[6] = {
        [A]: pos(1, 1),
        [B]: pos(2, 1),
        [C]: pos(2, 3),
        [D]: pos(3, 1)
    };

    const next = updateGroupPosition(
        layouts, ["b1", "b2"], null
    );

    assert.deepEqual(next[6], {
        [A]: pos(1, 1),
        [C]: pos(2, 3),
        [D]: pos(3, 1)
    });
});

test("splitting preserves unrelated intentional gaps", () => {
    const layouts = createEmptyLayouts();

    layouts[6] = {
        [A]: pos(1, 1),
        [B]: pos(4, 1),
        [C]: pos(7, 1)
    };

    const next = updateGroupPosition(
        layouts, ["b1", "b2"], null
    );

    assert.deepEqual(next[6], {
        [A]: pos(1, 1),
        [C]: pos(6, 1)
    });
});

test("splitting the last group preserves earlier positions", () => {
    const layouts = createEmptyLayouts();

    layouts[6] = {
        [A]: pos(1, 1),
        [B]: pos(3, 1),
        [C]: pos(5, 1)
    };

    const next = updateGroupPosition(
        layouts, ["c1", "c2"], null
    );

    assert.deepEqual(next[6], {
        [A]: pos(1, 1),
        [B]: pos(3, 1)
    });
});

test("splitting does not mutate the original layouts", () => {
    const layouts = createEmptyLayouts();

    layouts[6] = {
        [A]: pos(1, 1),
        [B]: pos(2, 1),
        [C]: pos(3, 1)
    };

    const original = structuredClone(layouts);

    updateGroupPosition(layouts, ["b1", "b2"], null);

    assert.deepEqual(layouts, original);
});


test("anchor identity is distinct from group identity", () => {
    assert.notEqual(anchorKey("a1"), A);
    assert.equal(anchorKey("a1"), anchorKey("a1"));
});

test("anchoring fills an intentional one-column opening", () => {
    const layouts = createEmptyLayouts();
    const three = groupKey(["x1", "x2", "x3"]);

    layouts[6] = {
        [A]: pos(1, 1),
        [three]: pos(1, 3)
    };

    const next = planAnchorPlacement(
        layouts, "solo", 6, pos(1, 6)
    );

    assert.ok(next);
    assert.deepEqual(next[6], {
        ...layouts[6],
        [anchorKey("solo")]: pos(1, 6)
    });
});

test("anchoring rejects occupied destinations", () => {
    const layouts = createEmptyLayouts();
    layouts[6][A] = pos(1, 1);

    assert.equal(planAnchorPlacement(
        layouts, "solo", 6, pos(1, 2)
    ), null);
});

test("anchoring rejects concerts already in a group", () => {
    const layouts = createEmptyLayouts();
    layouts[6][A] = pos(1, 1);

    assert.equal(planAnchorPlacement(
        layouts, "a1", 6, pos(2, 1)
    ), null);
});

test("anchoring creates independent responsive positions", () => {
    const layouts = createEmptyLayouts();
    layouts[2][A] = pos(3, 1);
    layouts[3][A] = pos(2, 1);

    const next = planAnchorPlacement(
        layouts, "solo", 6, pos(4, 5)
    );

    assert.ok(next);
    assert.deepEqual(next[2][anchorKey("solo")], pos(4, 1));
    assert.deepEqual(next[3][anchorKey("solo")], pos(3, 1));
    assert.deepEqual(next[6][anchorKey("solo")], pos(4, 5));
});

test("anchoring rejects duplicate independent positions", () => {
    const layouts = createEmptyLayouts();
    layouts[6][anchorKey("solo")] = pos(1, 1);

    assert.equal(planAnchorPlacement(
        layouts, "solo", 6, pos(2, 1)
    ), null);
});

test("anchoring does not mutate existing layouts", () => {
    const layouts = createEmptyLayouts();
    layouts[6][A] = pos(1, 1);
    const original = structuredClone(layouts);

    planAnchorPlacement(layouts, "solo", 6, pos(1, 3));

    assert.deepEqual(layouts, original);
});

test("unanchoring preserves neighbouring groups", () => {
    const layouts = createEmptyLayouts();

    layouts[6] = {
        [A]: pos(1, 1),
        [anchorKey("solo")]: pos(1, 3),
        [B]: pos(4, 1)
    };

    const next = planAnchorRelease(layouts, "solo");

    assert.ok(next);
    assert.deepEqual(next[6], {
        [A]: pos(1, 1),
        [B]: pos(4, 1)
    });
});

test("unanchoring removes positions across all layouts", () => {
    const layouts = planAnchorPlacement(
        createEmptyLayouts(), "solo", 6, pos(2, 3)
    );

    assert.ok(layouts);

    const next = planAnchorRelease(layouts, "solo");

    assert.deepEqual(next, createEmptyLayouts());
});

test("unanchoring an unknown concert changes nothing", () => {
    assert.equal(planAnchorRelease(
        createEmptyLayouts(), "unknown"
    ), null);
});

test("anchored concerts participate in mixed spatial movement", () => {
    const solo = anchorKey("solo");
    const board = {
        [A]: pos(1, 1),
        [solo]: pos(1, 3)
    };

    const result = planBoardMove(
        board,
        [piece(A), piece(solo, 1)],
        [moving(solo, 1, 3, 0, 0, 1)],
        pos(1, 3),
        pos(1, 5),
        6
    );

    assert.ok(result);
    assert.deepEqual(result.board[solo], pos(1, 5));
    assert.deepEqual(result.board[A], pos(1, 1));
});


test("fusion consumes anchors and inherits their earliest position", () => {
    const layouts = createEmptyLayouts();

    layouts[6] = {
        [A]: pos(1, 1),
        [anchorKey("solo1")]: pos(2, 2),
        [anchorKey("solo2")]: pos(4, 1)
    };

    const next = updateGroupPosition(
        layouts, null, ["solo1", "solo2"]
    );

    assert.deepEqual(next[6], {
        [A]: pos(1, 1),
        [groupKey(["solo1", "solo2"])]: pos(2, 2)
    });
});

test("fusion preserves existing groups when inherited position cannot fit", () => {
    const layouts = createEmptyLayouts();

    layouts[6] = {
        [A]: pos(1, 4),
        [anchorKey("solo1")]: pos(1, 3)
    };

    const next = updateGroupPosition(
        layouts, null, ["solo1", "solo2"]
    );

    assert.deepEqual(next[6], {
        [A]: pos(1, 4),
        [groupKey(["solo1", "solo2"])]: pos(2, 1)
    });
});

test("membership editing consumes an anchor without losing group position", () => {
    const layouts = createEmptyLayouts();

    layouts[6] = {
        [A]: pos(2, 1),
        [anchorKey("solo")]: pos(4, 1)
    };

    const next = updateGroupPosition(
        layouts, ["a1", "a2"], ["a1", "a2", "solo"]
    );

    assert.deepEqual(next[6], {
        [groupKey(["a1", "a2", "solo"])]: pos(2, 1)
    });
});


test("new anchors share rows in narrower responsive layouts", () => {
    const first = planAnchorPlacement(
        createEmptyLayouts(), "solo1", 6, pos(1, 5)
    );

    const second = planAnchorPlacement(
        first, "solo2", 6, pos(1, 6)
    );

    for (const columns of [2, 3]) {
        assert.deepEqual(
            second[columns][anchorKey("solo1")], pos(1, 1)
        );

        assert.deepEqual(
            second[columns][anchorKey("solo2")], pos(1, 2)
        );
    }
});

test("responsive anchor placement wraps when a row is full", () => {
    let layouts = createEmptyLayouts();

    for (let i = 1; i <= 3; i++) {
        layouts = planAnchorPlacement(
            layouts, `solo${i}`, 6, pos(1, i)
        );
    }

    assert.deepEqual(
        layouts[2][anchorKey("solo3")], pos(2, 1)
    );

    assert.deepEqual(
        layouts[3][anchorKey("solo3")], pos(1, 3)
    );
});

test("responsive anchor placement preserves intentional group gaps", () => {
    const layouts = createEmptyLayouts();
    layouts[3][A] = pos(1, 1);

    const next = planAnchorPlacement(
        layouts, "solo", 6, pos(1, 6)
    );

    assert.deepEqual(next[3][A], pos(1, 1));
    assert.deepEqual(
        next[3][anchorKey("solo")], pos(2, 1)
    );
});


test("responsive reflow preserves anchors before a large group", () => {
    const layouts = createEmptyLayouts();

    const group = groupKey(["g1", "g2", "g3", "g4"]);
    const anchors = [1, 2, 3, 4].map(
        i => anchorKey(`solo${i}`)
    );

    layouts[6] = {
        ...Object.fromEntries(
            anchors.map((key, i) => [key, pos(1, i + 1)])
        ),
        [group]: pos(2, 1)
    };

    layouts[2] = {
        [group]: pos(1, 1),
        ...Object.fromEntries(
            anchors.map((key, i) => [key, pos(i + 2, 1)])
        )
    };

    const next = synchronizeSpatialOrder(layouts, 6);

    assert.deepEqual(next[2], {
        [anchors[0]]: pos(1, 1),
        [anchors[1]]: pos(1, 2),
        [anchors[2]]: pos(2, 1),
        [anchors[3]]: pos(2, 2),
        [group]: pos(3, 1)
    });

    assert.deepEqual(next[6], layouts[6]);
});

test("compatible responsive arrangements remain unchanged", () => {
    const layouts = createEmptyLayouts();
    const solo = anchorKey("solo");

    layouts[6] = {
        [A]: pos(1, 1),
        [solo]: pos(1, 6)
    };

    layouts[2] = {
        [A]: pos(2, 1),
        [solo]: pos(5, 2)
    };

    const next = synchronizeSpatialOrder(layouts, 6);

    assert.deepEqual(next[2], layouts[2]);
});

test("responsive order synchronisation does not mutate layouts", () => {
    const layouts = createEmptyLayouts();

    layouts[6] = {
        [A]: pos(1, 1),
        [B]: pos(2, 1)
    };

    layouts[2] = {
        [B]: pos(1, 1),
        [A]: pos(2, 1)
    };

    const original = structuredClone(layouts);

    synchronizeSpatialOrder(layouts, 6);

    assert.deepEqual(layouts, original);
});

test("responsive synchronisation retains unmatched pieces", () => {
    const layouts = createEmptyLayouts();

    layouts[6] = {
        [A]: pos(1, 1)
    };

    layouts[2] = {
        [A]: pos(1, 1),
        [B]: pos(2, 1)
    };

    const next = synchronizeSpatialOrder(layouts, 6);

    assert.deepEqual(next[2], layouts[2]);
});


test("Fission preserves individual positions within a row", () => {
    const layouts = createEmptyLayouts();

    const slugs = ["s1", "s2", "s3", "s4"];
    const group = groupKey(slugs);

    layouts[6] = {
        [group]: pos(2, 2),
        [anchorKey("neighbour")]: pos(2, 6)
    };

    const next = planGroupFission(layouts, slugs);

    assert.ok(next);

    assert.deepEqual(next[6], {
        [anchorKey("neighbour")]: pos(2, 6),
        [anchorKey("s1")]: pos(2, 2),
        [anchorKey("s2")]: pos(2, 3),
        [anchorKey("s3")]: pos(2, 4),
        [anchorKey("s4")]: pos(2, 5)
    });
});

test("Fission wraps anchors on narrower screens", () => {
    const layouts = createEmptyLayouts();

    const slugs = ["s1", "s2", "s3", "s4"];

    layouts[2] = {
        [groupKey(slugs)]: pos(1, 1),
        [A]: pos(3, 1)
    };

    const next = planGroupFission(layouts, slugs);

    assert.ok(next);

    assert.deepEqual(next[2], {
        [A]: pos(4, 1),
        [anchorKey("s1")]: pos(1, 1),
        [anchorKey("s2")]: pos(1, 2),
        [anchorKey("s3")]: pos(2, 1),
        [anchorKey("s4")]: pos(2, 2)
    });
});

test("Fission preserves concert order and does not mutate layouts", () => {
    const layouts = createEmptyLayouts();

    const slugs = ["s3", "s1", "s2"];

    layouts[6][groupKey(slugs)] = pos(2, 1);

    const original = structuredClone(layouts);
    const next = planGroupFission(layouts, slugs);

    assert.ok(next);
    assert.deepEqual(next[6][anchorKey("s3")], pos(2, 1));
    assert.deepEqual(next[6][anchorKey("s1")], pos(2, 2));
    assert.deepEqual(next[6][anchorKey("s2")], pos(2, 3));
    assert.deepEqual(layouts, original);
});

test("Fission rejects duplicate concert membership", () => {
    assert.equal(planGroupFission(
        createEmptyLayouts(), ["solo", "solo"]
    ), null);
});
