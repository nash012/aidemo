# Laser Game Setup and Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3D tactical setup screen, lock setup choices during a match, separately strengthen easy and normal AI, clarify every computer action with animation, and refine the laser into a thin layered beam.

**Architecture:** Keep the feature inside the existing `games/laser/laser-game.js` module and reuse its rules, `LAYOUTS`, camera projection, board renderer, piece renderer, AI pipeline, and laser simulation. Add one small screen/modal state machine, one visual-only AI animation state advanced by `update(dt)`, and a refined renderer that consumes the existing laser path. Extend the dependency-free Node regression test through the module's existing underscored debug surface; do not introduce a second game model or rendering path.

**Tech Stack:** ES5-compatible JavaScript, Canvas 2D, WeChat Mini Game runtime, existing browser debug harness, Node.js built-in `assert`.

## Global Constraints

- Default setup is layout `0` (`幺点`) and difficulty `normal` (`普通`).
- `setup` owns editable selections; `playing` owns locked selections. No in-match code path may change layout or difficulty.
- Setup preview uses `makeInitialPieces`, `drawBoard3D`, `drawPieces3D`, and the same 3D piece functions as the match. Do not create preview coordinates, icons, images, or another Canvas.
- Preserve all current rules, especially cross-owner double-mirror swaps, blue exclusion from red reserved cells, red exclusion from white/blue reserved cells, and legality of both destinations after a swap.
- Keep exactly three difficulty levels. Strengthen easy and normal separately; leave hard parameters unchanged.
- Computer animation is visual state only. The existing legal action is committed once, after animation, before firing.
- Beam rendering consumes `simulateLaser(...).path`; it must not calculate collisions or reflections.
- Use tracked timers only for existing turn/fire scheduling. New movement animation runs from `update(dt)` and is cleared on return and exit.
- Add no third-party dependency and preserve the user's unrelated `project.config.json`, `project.private.config.json`, and `.idea/` changes.

---

### Task 1: Add the Setup/Playing State Machine and Locked Match Settings

**Files:**
- Modify: `games/laser/laser-game.js:397-448,1528-1608,1860-2013`
- Modify: `tests/laser-ai.test.js`

**Interfaces:**
- Add real module functions used by both UI and tests: `selectLayout(index)`, `selectDifficulty(level)`, `beginMatch()`, `openRules()`, `closeModal()`, `requestReturnToSetup()`, and `confirmReturnToSetup()`.
- Add `G.screen`, `G.lockedLayoutIdx`, `G.lockedDifficulty`, and `G.rulesScroll`.
- Add `_debugGame.snapshot()` plus wrappers around the real transition functions. `snapshot()` returns copied scalar state, copied pieces, and a copied/null AI-animation summary; it never returns mutable `G`.

- [ ] **Step 1: Write failing state-transition tests**

Extend `tests/laser-ai.test.js` immediately after game creation:

```js
assert.ok(game._debugGame, "game-state debug surface must exist");

var initial = game._debugGame.snapshot();
assert.equal(initial.screen, "setup");
assert.equal(initial.layoutIdx, 0);
assert.equal(initial.difficulty, "normal");
assert.deepEqual(initial.pieces, game._debugAI.initialPieces(0));

for(var previewLayout = 0; previewLayout < 5; previewLayout++){
  game._debugGame.selectLayout(previewLayout);
  assert.deepEqual(
    game._debugGame.snapshot().pieces,
    game._debugAI.initialPieces(previewLayout),
    "setup preview must use the real layout " + previewLayout
  );
}

game._debugGame.selectLayout(2);
game._debugGame.selectDifficulty("easy");
game._debugGame.openRules();
game._debugGame.closeModal();
assert.equal(game._debugGame.snapshot().layoutIdx, 2);
assert.equal(game._debugGame.snapshot().difficulty, "easy");

game._debugGame.beginMatch();
var startedMatch = game._debugGame.snapshot();
assert.equal(startedMatch.screen, "playing");
assert.equal(startedMatch.lockedLayoutIdx, 2);
assert.equal(startedMatch.lockedDifficulty, "easy");

game._debugGame.selectLayout(4);
game._debugGame.selectDifficulty("hard");
var stillLocked = game._debugGame.snapshot();
assert.equal(stillLocked.layoutIdx, 2, "layout is immutable during play");
assert.equal(stillLocked.difficulty, "easy", "difficulty is immutable during play");

game._debugGame.requestReturn();
assert.equal(game._debugGame.snapshot().modal, "confirmReturn");
game._debugGame.closeModal();
assert.equal(game._debugGame.snapshot().screen, "playing");
assert.deepEqual(game._debugGame.snapshot().pieces, startedMatch.pieces,
  "cancelling return preserves match progress");

game._debugGame.requestReturn();
game._debugGame.confirmReturn();
var returned = game._debugGame.snapshot();
assert.equal(returned.screen, "setup");
assert.equal(returned.modal, null);
assert.equal(returned.layoutIdx, 2);
assert.equal(returned.difficulty, "easy");
assert.deepEqual(returned.pieces, game._debugAI.initialPieces(2));
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/laser-ai.test.js`

Expected: FAIL at `game-state debug surface must exist`.

- [ ] **Step 3: Implement the two-screen state model**

In `G`, add:

```js
screen:"setup", lockedLayoutIdx:null, lockedDifficulty:null,
rulesScroll:0, aiAnim:null, actionNotice:null
```

Replace the creation-time `startGame()` call with `enterSetup()`. Implement transitions with these invariants:

```js
function enterSetup(){
  clearMatchVisualState();
  G.screen = "setup";
  G.lockedLayoutIdx = null;
  G.lockedDifficulty = null;
  G.pieces = makeInitialPieces(G.layoutIdx);
  G.modal = null;
  G.busy = false;
  setSetupCamera();
  render();
}

function beginMatch(){
  if(G.screen !== "setup") return;
  G.lockedLayoutIdx = G.layoutIdx;
  G.lockedDifficulty = G.difficulty;
  G.screen = "playing";
  resetMatchState(makeInitialPieces(G.lockedLayoutIdx));
  setMatchCamera();
  render();
}
```

`clearMatchVisualState()` clears path, particles, flash state, selection, undo state, camera animation, AI animation, and action notice. `resetMatchState(pieces)` performs the rest of the current `startGame()` reset without changing layout/difficulty/screen locks.

`selectLayout` and `selectDifficulty` return immediately unless `G.screen === "setup"`; validate layout range and difficulty membership. Layout selection immediately assigns `G.pieces = makeInitialPieces(index)`. `openRules` is setup-only. `requestReturnToSetup` is playing-only and sets `G.modal = "confirmReturn"`. `confirmReturnToSetup` only acts from that modal, copies locked choices back to editable choices, and calls `enterSetup()`.

Use `G.lockedDifficulty` in `aiTurn`. Restart after win calls `resetMatchState(makeInitialPieces(G.lockedLayoutIdx))`, not setup. Remove `cycleDifficulty`, `layoutPanel`, and their obsolete debug methods only after their callers are replaced in Task 2.

- [ ] **Step 4: Run state and existing rule regressions**

Run: `node tests/laser-ai.test.js`

Expected: PASS, including cross-owner swap and both reserved-zone assertions.

- [ ] **Step 5: Commit the state model**

```bash
git add games/laser/laser-game.js tests/laser-ai.test.js
git commit -m "feat: add locked laser match setup state"
```

---

### Task 2: Build the Tactical Setup Screen, True 3D Preview, and Complete Rules Modal

**Files:**
- Modify: `games/laser/laser-game.js:30-70,573-1219,1466-1608,1772-1966`
- Modify: `tests/laser-ai.test.js`
- Verify: `laser-3d-debug.html`

**Interfaces:**
- Add `setSetupCamera()`, `setMatchCamera()`, `renderSetup()`, `buildSetupButtons()`, `drawRulesModal()`, and `drawConfirmReturnModal()`.
- `render()` dispatches on `G.screen`; both branches call the existing `drawBoard3D()` and `drawPieces3D()`.
- The existing button hit testing remains the only button interaction system.

- [ ] **Step 1: Add failing UI contract tests**

Make `fakeContext()` record `fillText` strings in a `texts` array, retain that array on the context as `_texts`, and create a fresh `uiGame` for these assertions:

```js
var uiCtx = fakeContext();
var uiGame = LaserGame.create(uiCtx, 375, 667, function(){});
uiGame.render();
assert.ok(uiCtx._texts.indexOf("选择阵型") >= 0);
assert.ok(uiCtx._texts.indexOf("选择难度") >= 0);
assert.ok(uiCtx._texts.indexOf("规则介绍") >= 0);
assert.ok(uiCtx._texts.indexOf("开始游戏") >= 0);
assert.equal(uiGame._debugGame.snapshot().screen, "setup");

uiGame._debugGame.openRules();
uiCtx._texts.length = 0;
uiGame.render();
assert.ok(uiCtx._texts.indexOf("双面镜互换") >= 0);
assert.ok(uiCtx._texts.some(function(text){
  return text.indexOf("包括对方棋子") >= 0;
}));
assert.ok(uiCtx._texts.some(function(text){
  return text.indexOf("蓝方不能进入红色区域") >= 0;
}));

uiGame._debugGame.closeModal();
uiGame._debugGame.beginMatch();
uiCtx._texts.length = 0;
uiGame.render();
assert.equal(uiCtx._texts.indexOf("选择难度"), -1);
assert.equal(uiCtx._texts.indexOf("阵型选择"), -1);
assert.ok(uiCtx._texts.indexOf("返回设置") >= 0);

uiGame._debugGame.requestReturn();
uiCtx._texts.length = 0;
uiGame.render();
assert.ok(uiCtx._texts.some(function(text){
  return text.indexOf("当前对局进度将丢失") >= 0;
}));
uiGame.exit();
```

Delete the old regression block that calls `_debugAI.cycleDifficulty()` and `_debugAI.restart()`. Its in-match cycling behavior is intentionally replaced by the setup-only selection and locking assertions from Task 1.

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/laser-ai.test.js`

Expected: FAIL because setup labels and the new modal renderers do not exist.

- [ ] **Step 3: Implement the B tactical-preview composition**

Add `SETUP_PITCH = 1.08` and camera setters. `setSetupCamera()` sets `yaw = 0`, `pitch = SETUP_PITCH`, centers the board in the upper preview region, and computes focal length so all four board corners fit between `SAFE_TOP + 70` and roughly 55% of screen height. `setMatchCamera()` restores the current `DEFAULT_YAW`, `DEFAULT_PITCH`, match center, and match focal formula.

`renderSetup()` draws, in this order:

1. the existing dark background plus restrained red glow on the left and blue glow on the right;
2. title `激光镭射象棋` and subtitle `战术部署`;
3. `drawBoard3D()` and `drawPieces3D()` using `G.pieces` from `makeInitialPieces(G.layoutIdx)`;
4. selected layout name and description;
5. five compact layout buttons in a `3 + 2` wrap;
6. three difficulty buttons in one row;
7. `规则介绍` and primary `开始游戏` buttons.

The preview renderer must not call `buildOnBoardButtons3D`, `drawOnBoardButtons3D`, `drawStatus`, or match action controls. Delete the obsolete layout selection panel after all five layouts are present on setup.

- [ ] **Step 4: Implement the complete single-page rules modal and return confirmation**

Render rules as a nearly full-screen panel with a clipped scroll body. Include all six approved sections: victory, turn flow, five piece types, cross-owner double-mirror swap, reserved zones including both swap destinations, and threefold repetition. Use the exact test-visible phrases `双面镜互换`, `包括对方棋子`, and `蓝方不能进入红色区域`.

While `G.modal === "rules"`, route vertical drag distance to `G.rulesScroll`, clamp it to content height, and prevent camera movement. Provide a fixed `关闭` button. `drawConfirmReturnModal()` provides `继续对局` and `确认返回`, with the warning `返回后当前对局进度将丢失。`.

In the playing action area, remove layout and difficulty controls and add `返回设置`. Route every internal match-to-setup action through `requestReturnToSetup()`; no button calls `enterSetup()` directly.

- [ ] **Step 5: Run automated checks**

Run:

```bash
node tests/laser-ai.test.js
node --check games/laser/laser-game.js
```

Expected: both pass.

- [ ] **Step 6: Perform setup visual verification in the existing debug page**

Open `laser-3d-debug.html` and verify at 375×667 and one taller mobile viewport:

- all five selections show their corresponding full 26-piece layout;
- the same board grid, red/white reserved cells, piece models, orientations, shadows, and mirror highlights appear in setup and play;
- the board is a large, centered shallow trapezoid and all pieces are distinguishable;
- the rules body scrolls without moving the camera;
- starting a match removes setup controls;
- cancel return preserves the position; confirm return keeps the chosen layout/difficulty and discards match progress.

- [ ] **Step 7: Commit setup UI and modal behavior**

```bash
git add games/laser/laser-game.js tests/laser-ai.test.js
git commit -m "feat: add tactical laser game setup screen"
```

---

### Task 3: Separately Strengthen Easy and Normal AI

**Files:**
- Modify: `games/laser/laser-game.js:42-323`
- Modify: `tests/laser-ai.test.js`

**Interfaces:**
- Keep `aiChoose(pieces, aiPlayer, difficulty)` and the shared scoring pipeline.
- Add `_debugAI.config(level)` returning a copy of the selected fixed parameter object for parameter regression only.

- [ ] **Step 1: Add failing per-level strength and budget tests**

Add exact parameter assertions and retain the existing fixed-position attack/suicide tests:

```js
assert.deepEqual(game._debugAI.config("easy"), {
  attack:0.65, defense:1.25, guard:1.7,
  reply:0, candidates:24, variety:5
});
assert.deepEqual(game._debugAI.config("normal"), {
  attack:2.0, defense:0.9, guard:0.8,
  reply:0.55, candidates:40, variety:1.5
});
assert.deepEqual(game._debugAI.config("hard"), {
  attack:1.2, defense:1.2, guard:1.5,
  reply:1.0, candidates:40, variety:0.5
});

["easy", "normal"].forEach(function(level){
  var action = game._debugAI.choose(safePressure, 1, level);
  assert.equal(action.pi, 1, level + " should use the mirror to build pressure");
  assert.equal(action.kind, "rot");
  assert.equal(action.d, 1);
});

for(var levelIndex = 0; levelIndex < 3; levelIndex++){
  var level = ["easy", "normal", "hard"][levelIndex];
  for(var layoutIndex = 0; layoutIndex < 5; layoutIndex++){
    var started = Date.now();
    game._debugAI.choose(game._debugAI.initialPieces(layoutIndex), 1, level);
    var elapsed = Date.now() - started;
    assert.ok(elapsed < 500,
      level + " layout " + layoutIndex + " took " + elapsed + "ms");
  }
}
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/laser-ai.test.js`

Expected: FAIL because easy/normal still have the old values and `config` is absent.

- [ ] **Step 3: Apply the separately approved strength increases**

Replace only easy and normal entries:

```js
easy:   {attack:0.65, defense:1.25, guard:1.7, reply:0,    candidates:24, variety:5},
normal: {attack:2.0,  defense:0.9,  guard:0.8, reply:0.55, candidates:40, variety:1.5},
hard:   {attack:1.2,  defense:1.2,  guard:1.5, reply:1.0,  candidates:40, variety:0.5}
```

Do not add coordinate, layout-name, or piece-ID exceptions. Keep easy without complete opponent-reply search; normal keeps partial reply weighting; hard remains the strongest full one-reply mode. If the fixed attack assertion regresses, tune only easy/normal numeric weights while preserving `24/40` candidate budgets, `reply:0` for easy, and `normal.reply < hard.reply`.

- [ ] **Step 4: Run regression, syntax, and performance checks**

Run:

```bash
node tests/laser-ai.test.js
node --check games/laser/laser-game.js
```

Expected: PASS; all three levels avoid self-laser suicide, cross-owner swap and reserved-zone rules remain green, and every layout remains below the local 500 ms ceiling.

- [ ] **Step 5: Commit the two distinct AI increases**

```bash
git add games/laser/laser-game.js tests/laser-ai.test.js
git commit -m "feat: strengthen easy and normal laser AI"
```

---

### Task 4: Animate Computer Move, Rotation, Swap, and Direct Fire

**Files:**
- Modify: `games/laser/laser-game.js:102-107,1169-1219,1466-1489,1705-1745,1978-1989`
- Modify: `tests/laser-ai.test.js`

**Interfaces:**
- Add `createAiAnimation(action)`, `sampleAiAnimation(anim)`, `updateAiAnimation(dt)`, `commitAiAction(action)`, `drawAiActionOverlay()`, and `visualPose(piece)`.
- Add `_debugEffects.beginAiAction(action)`, `_debugEffects.setPieces(pieces)`, and `_debugEffects.snapshot()` wrappers around the real animation state for deterministic integration tests.

- [ ] **Step 1: Add failing animation completion tests**

Use a fresh match per action, start animation through the real state helper, advance public `update(dt)`, and compare committed pieces:

```js
function testAiAnimation(action, advanceSeconds, expected){
  var animCtx = fakeContext();
  var animGame = LaserGame.create(animCtx, 375, 667, function(){});
  animGame._debugGame.beginMatch();
  animGame._debugEffects.beginAiAction(action);
  assert.equal(animGame._debugGame.snapshot().busy, true);
  animGame.update(advanceSeconds);
  var snap = animGame._debugGame.snapshot();
  expected(snap);
  assert.equal(snap.aiAnim, null);
  animGame.exit();
}

testAiAnimation({pi:14, kind:"move", r:5, c:7}, 0.75, function(snap){
  assert.equal(snap.pieces[14].row, 5);
  assert.equal(snap.pieces[14].col, 7);
});

testAiAnimation({pi:14, kind:"rot", d:1}, 0.70, function(snap){
  assert.equal(snap.pieces[14].orientation,
    (game._debugAI.initialPieces(0)[14].orientation + 1) % 4);
});
```

Add a swap case by using `_debugEffects.setPieces(crossOwnerSwap)` before `beginAiAction({pi:0, kind:"swap", ti:1})`, then assert both final coordinates are exchanged after 0.81 seconds. Add a skip case and assert no piece changes, notice text is `电脑选择直接发射`, and the animation completes after 0.53 seconds.

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/laser-ai.test.js`

Expected: FAIL because `_debugEffects` and AI animation state do not exist.

- [ ] **Step 3: Separate commit logic from visual timing**

Extract the mutation branch currently inside `applyAiAction` into `commitAiAction(action)`. It handles `rot`, `laserRot`, `move`, and `swap` once and returns `true`; invalid piece indexes return `false`. Keep rule validation in the existing action generation/application path—animation never invents an action.

`createAiAnimation` captures immutable start/end row, column, orientation, target index, and total duration:

- move: `0.16 + 0.42 + 0.16 = 0.74s`;
- rotation/laser rotation: `0.16 + 0.36 + 0.16 = 0.68s`;
- swap: `0.16 + 0.48 + 0.16 = 0.80s`;
- skip: `0.52s` notice only.

Keep `G.busy = true` from AI choice through animation and beam completion. On animation completion, call `commitAiAction` once, clear `G.aiAnim`, set `G.phase = "fire"`, then call `fireLaser()`. If animation creation or sampling throws, immediately commit the selected action and continue to fire so the turn cannot stall.

- [ ] **Step 4: Render the approved A animation without mutating rules state**

Have `drawPieces3D()` ask `visualPose(piece)` for temporary row, column, height, and orientation overrides. During the lead-in draw a yellow source ring. During motion use `easeInOut` for horizontal interpolation and `sin(PI*t) * 0.34` for lift. During landing draw a fading yellow pulse. Rotation interpolates the model angle by 90° in place. Swap samples both pieces in opposite directions and pulses both destinations.

Draw one short label above the board: `电脑移动：<起点> → <终点>`, `电脑旋转棋子`, `电脑互换棋子`, or `电脑选择直接发射`. Do not move grid coordinates in `G.pieces` until completion.

- [ ] **Step 5: Run automated checks**

Run:

```bash
node tests/laser-ai.test.js
node --check games/laser/laser-game.js
```

Expected: PASS; each animation commits exactly one final action, input stays blocked, and existing rules remain green.

- [ ] **Step 6: Visually verify all four action types**

In `laser-3d-debug.html`, use deterministic debug actions or natural play to verify source highlight, raised travel, landing pulse, in-place rotation, synchronized two-piece swap, and direct-fire label. Confirm laser starts only after the computer action is visually complete.

- [ ] **Step 7: Commit computer action animation**

```bash
git add games/laser/laser-game.js tests/laser-ai.test.js
git commit -m "feat: animate laser AI actions"
```

---

### Task 5: Refine the Laser Beam and Reflection Accents

**Files:**
- Modify: `games/laser/laser-game.js:1225-1314,1978-1989`
- Modify: `tests/laser-ai.test.js`

**Interfaces:**
- Add pure `beamTurns(path)` for visual reflection points only.
- Add `G.beamPulseT`, advanced by the existing public `update(dt)`.
- Add `_debugEffects.beamTurns(path)` returning copied points for regression tests.

- [ ] **Step 1: Add failing path/turn tests**

```js
var reflectedPath = [
  {r:0,c:0}, {r:0,c:1}, {r:0,c:2},
  {r:1,c:2}, {r:2,c:2}, {r:2,c:3}
];
assert.deepEqual(game._debugEffects.beamTurns(reflectedPath), [
  {r:0,c:2}, {r:2,c:2}
]);
assert.deepEqual(reflectedPath, [
  {r:0,c:0}, {r:0,c:1}, {r:0,c:2},
  {r:1,c:2}, {r:2,c:2}, {r:2,c:3}
], "beam effects must not mutate the simulated path");
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/laser-ai.test.js`

Expected: FAIL because `beamTurns` is absent.

- [ ] **Step 3: Implement direction-change extraction**

For each interior path point, compare normalized row/column direction from previous→current and current→next. Return the current point only when direction changes. Handle missing, short, repeated, or malformed points by returning an empty/safe result; never alter `G.path`.

- [ ] **Step 4: Replace the thick beam with three restrained layers**

Keep the current progressive path clipping, but draw visible path sections with round caps in this order:

1. orange outer glow, `4–6px`, low alpha and `shadowBlur` around `8px`;
2. saturated yellow energy line, `2–3px`;
3. white-hot core, `1–1.5px`.

Use `0.88 + sin(G.beamPulseT * 14) * 0.12` for a subtle alpha/width pulse. Replace the oversized radial endpoint with a compact white/yellow head that advances along the currently revealed segment. At every `beamTurns(G.path)` point already reached by `G.animT`, draw one small fading ring and 3–4 short radial spark strokes. These accents are derived per frame and are not appended to `G.particles`.

Reset `shadowBlur`, alpha, cap, and composite state with `ctx.save()/restore()` so pieces and UI retain their current appearance. Leave `simulateLaser`, hit resolution, flash, and explosion logic unchanged.

- [ ] **Step 5: Run automated checks**

Run:

```bash
node tests/laser-ai.test.js
node --check games/laser/laser-game.js
```

Expected: PASS; turn extraction is correct and all rule/AI tests remain unchanged.

- [ ] **Step 6: Visually compare straight, reflected, and hit beams**

In `laser-3d-debug.html`, verify a straight shot, a one-reflection shot, a multi-reflection shot, and a piece hit. The core remains crisp, the yellow and orange layers do not obscure board cells, the head is smaller than a piece base, every direction change flashes briefly, and the existing explosion begins at the beam endpoint.

- [ ] **Step 7: Commit the beam refinement**

```bash
git add games/laser/laser-game.js tests/laser-ai.test.js
git commit -m "feat: refine laser beam effects"
```

---

### Task 6: End-to-End Verification and Final Review

**Files:**
- Verify: `games/laser/laser-game.js`
- Verify: `tests/laser-ai.test.js`
- Verify: `laser-3d-debug.html`
- Verify: `game.js`
- Verify: `docs/superpowers/specs/2026-08-11-laser-game-experience-design.md`

**Interfaces:**
- No new interface. This task verifies the complete setup → play → AI animation → laser → return flow.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
node tests/laser-ai.test.js
node --check games/laser/laser-game.js
node --check game.js
```

Expected: all commands exit 0 and tests print `laser AI regression tests passed`.

- [ ] **Step 2: Check the five-layout preview and three difficulty starts**

For every layout, switch the setup preview, start once with each difficulty across the test pass, and verify the match begins with the exact previewed pieces and locked label/state. Confirm no layout or difficulty control appears or responds during play.

- [ ] **Step 3: Recheck the two critical chess rules in live interaction**

Use a double mirror adjacent to an opponent shield or single mirror and confirm the swap is offered when both destinations are legal. Move/swap near each reserved zone and confirm blue cannot enter red cells, red cannot enter white/blue cells, and a swap is rejected if either resulting destination is illegal.

- [ ] **Step 4: Recheck interruption and cleanup paths**

During AI thinking, AI motion, beam travel, and ordinary human selection, verify player input cannot corrupt the turn. On a safe human turn, verify return confirmation cancellation preserves progress and confirmation discards progress. Exit the game and confirm no tracked timer or animation continues to render.

- [ ] **Step 5: Review the final diff without staging unrelated files**

Run:

```bash
git diff --check
git status --short
git log --oneline -8
```

Expected: no whitespace errors; only planned source/test changes are committed. `project.config.json`, `project.private.config.json`, and `.idea/` remain untouched and unstaged.

- [ ] **Step 6: Commit any verification-only test adjustment**

If Task 6 added or corrected a regression assertion, commit only the source/test files involved:

```bash
git add games/laser/laser-game.js tests/laser-ai.test.js
git commit -m "test: cover laser game setup flow"
```

If no file changed, do not create an empty commit.
