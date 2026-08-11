"use strict";

var assert = require("node:assert");
var LaserGame = require("../games/laser/laser-game.js");

function fakeContext(){
  var gradient = { addColorStop:function(){} };
  var texts = [];
  return new Proxy({
    _texts:texts,
    fillText:function(text){ texts.push(text); },
    measureText:function(s){ return {width:String(s).length * 8}; },
    createLinearGradient:function(){ return gradient; },
    createRadialGradient:function(){ return gradient; }
  }, {
    get:function(target, key){ return key in target ? target[key] : function(){}; },
    set:function(target, key, value){ target[key] = value; return true; }
  });
}

function piece(id, type, owner, row, col, orientation){
  return {id:id, type:type, owner:owner, row:row, col:col,
    orientation:orientation, alive:true};
}

var game = LaserGame.create(fakeContext(), 375, 667, function(){});
assert.ok(game._debugAI, "AI debug surface must exist");

assert.ok(game._debugGame, "game-state debug surface must exist");

var initial = game._debugGame.snapshot();
assert.equal(initial.screen, "setup");
assert.equal(initial.layoutIdx, 0);
assert.equal(initial.difficulty, "normal");
assert.deepEqual(initial.pieces, game._debugAI.initialPieces(0));
initial.pieces[0].row = -1;
assert.deepEqual(game._debugGame.snapshot().pieces, game._debugAI.initialPieces(0),
  "snapshot must not expose mutable game pieces");

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

var uiCtx = fakeContext();
var uiGame = LaserGame.create(uiCtx, 375, 667, function(){});
uiGame.render();
assert.ok(uiCtx._texts.indexOf("选择阵型") >= 0);
assert.ok(uiCtx._texts.indexOf("选择难度") >= 0);
assert.ok(uiCtx._texts.indexOf("规则介绍") >= 0);
assert.ok(uiCtx._texts.indexOf("开始游戏") >= 0);
assert.equal(uiGame._debugGame.snapshot().screen, "setup");

uiGame._debugGame.openRules();
uiGame.onTouchStart({touches:[{clientX:188, clientY:450}]});
uiGame.onTouchMove({touches:[{clientX:188, clientY:250}]});
assert.ok(uiGame._debugGame.snapshot().rulesScroll > 0,
  "rules drag must scroll the clipped body");
uiGame.onTouchEnd({touches:[], changedTouches:[{clientX:188, clientY:250}]});
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

var startCtx = fakeContext();
var startGame = LaserGame.create(startCtx, 375, 667, function(){});
var startTouch = {clientX:280, clientY:565};
startGame.onTouchStart({touches:[startTouch]});
startGame.onTouchEnd({touches:[], changedTouches:[startTouch]});
assert.equal(startGame._debugGame.snapshot().screen, "playing",
  "the production start button must begin the default match");
startGame.exit();

var safePressure = [
  piece("bl", "laser", 1, 0, 0, 2),
  piece("bm", "mirror", 1, 3, 0, 0),
  piece("bk", "king", 1, 0, 5, 0),
  piece("rl", "laser", 0, 7, 9, 0),
  piece("rk", "king", 0, 4, 4, 0)
];

var mateThreat = [
  piece("bl", "laser", 1, 0, 0, 2),
  piece("bm", "mirror", 1, 3, 0, 0),
  piece("bk", "king", 1, 3, 5, 0),
  piece("rl", "laser", 0, 7, 5, 0),
  piece("rk", "king", 0, 4, 4, 0)
];

var savedRandom = Math.random;
Math.random = function(){ return 0; };
try {
  var normal = game._debugAI.choose(safePressure, 1, "normal");
  assert.equal(normal.pi, 1, "normal should use the mirror to build pressure");
  assert.equal(normal.kind, "rot");
  assert.equal(normal.d, 1);

  var hard = game._debugAI.choose(mateThreat, 1, "hard");
  assert.equal(hard.pi, 2, "hard should move the exposed king");
  assert.equal(hard.kind, "move");
  assert.notEqual(hard.c, 5);

  ["easy", "normal", "hard"].forEach(function(level){
    var suicide = [
      piece("bl", "laser", 1, 0, 0, 2),
      piece("bk", "king", 1, 3, 0, 0),
      piece("rk", "king", 0, 7, 9, 0),
      piece("rl", "laser", 0, 7, 8, 0)
    ];
    var action = game._debugAI.choose(suicide, 1, level);
    var result = game._debugAI.resolve(suicide, 1, action);
    assert.ok(!(result.eliminated && result.eliminated.id === "bk"),
      level + " must avoid firing into its own king when it can move");
  });

  var crossOwnerSwap = [
    piece("bs", "switch", 1, 4, 4, 0),
    piece("rm", "mirror", 0, 4, 5, 0)
  ];
  assert.ok(game._debugAI.actions(crossOwnerSwap, 1).some(function(action){
    return action.kind === "swap" && action.pi === 0 && action.ti === 1;
  }), "switch must be able to swap with an adjacent opponent mirror");

  var blueByRedZone = [
    piece("bs", "switch", 1, 4, 8, 0),
    piece("rm", "mirror", 0, 4, 9, 0)
  ];
  assert.ok(!game._debugAI.actions(blueByRedZone, 1).some(function(action){
    return (action.kind === "move" && action.r === 4 && action.c === 9) ||
      (action.kind === "swap" && action.ti === 1);
  }), "blue pieces must not move or swap into a red reserved cell");

  var redByBlueZone = [
    piece("rs", "switch", 0, 4, 1, 0),
    piece("bm", "mirror", 1, 4, 0, 0)
  ];
  assert.ok(!game._debugAI.actions(redByBlueZone, 0).some(function(action){
    return (action.kind === "move" && action.r === 4 && action.c === 0) ||
      (action.kind === "swap" && action.ti === 1);
  }), "red pieces must not move or swap into a blue reserved cell");

  for(var layoutIndex = 0; layoutIndex < 5; layoutIndex++){
    var started = Date.now();
    game._debugAI.choose(game._debugAI.initialPieces(layoutIndex), 1, "hard");
    var elapsed = Date.now() - started;
    assert.ok(elapsed < 500,
      "hard layout " + layoutIndex + " took " + elapsed + "ms");
  }
} finally {
  Math.random = savedRandom;
  game.exit();
}

var savedWx = global.wx;
var savedRequestAnimationFrame = global.requestAnimationFrame;
var suiteCtx = fakeContext();
var suiteHandlers = {};
var suiteFrame = null;
global.wx = {
  getWindowInfo:function(){ return {windowWidth:375, windowHeight:667, pixelRatio:1}; },
  createCanvas:function(){ return {getContext:function(){ return suiteCtx; }}; },
  onTouchStart:function(fn){ suiteHandlers.start = fn; },
  onTouchMove:function(fn){ suiteHandlers.move = fn; },
  onTouchEnd:function(fn){ suiteHandlers.end = fn; },
  onTouchCancel:function(fn){ suiteHandlers.cancel = fn; }
};
global.requestAnimationFrame = function(fn){ suiteFrame = fn; };
try {
  delete require.cache[require.resolve("../game.js")];
  require("../game.js");

  var laserCard = {clientX:100, clientY:320};
  suiteHandlers.start({touches:[laserCard]});
  suiteHandlers.end({touches:[], changedTouches:[laserCard]});
  suiteCtx._texts.length = 0;
  suiteHandlers.start({touches:[{clientX:20, clientY:20}]});
  suiteFrame(16);
  assert.ok(suiteCtx._texts.some(function(text){ return text.indexOf("游戏合集") >= 0; }),
    "suite back must leave laser setup for the game menu");

  suiteHandlers.start({touches:[laserCard]});
  suiteHandlers.end({touches:[], changedTouches:[laserCard]});
  var productionStart = {clientX:280, clientY:565};
  suiteHandlers.start({touches:[productionStart]});
  suiteHandlers.end({touches:[], changedTouches:[productionStart]});
  suiteCtx._texts.length = 0;
  suiteHandlers.start({touches:[{clientX:20, clientY:20}]});
  suiteFrame(32);
  assert.ok(suiteCtx._texts.indexOf("返回后当前对局进度将丢失。") >= 0,
    "suite back must request confirmation during a laser match");
  assert.ok(!suiteCtx._texts.some(function(text){ return text.indexOf("游戏合集") >= 0; }),
    "suite back must not discard an active laser match");
} finally {
  delete require.cache[require.resolve("../game.js")];
  if(savedWx === undefined) delete global.wx;
  else global.wx = savedWx;
  if(savedRequestAnimationFrame === undefined) delete global.requestAnimationFrame;
  else global.requestAnimationFrame = savedRequestAnimationFrame;
}

console.log("laser AI regression tests passed");
