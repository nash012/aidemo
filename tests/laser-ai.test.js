"use strict";

var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");
var LaserGame = require("../games/laser/laser-game.js");
var WebGLRenderer = require("../games/laser/webgl-renderer.js");

function fakeContext(){
  var gradient = { addColorStop:function(){} };
  var texts = [];
  var arcs = [];
  var strokes = [];
  var drawImages = [];
  return new Proxy({
    _texts:texts, _arcs:arcs, _strokes:strokes, _drawImages:drawImages,
    fillText:function(text){ texts.push(text); },
    arc:function(x, y, radius){ arcs.push({radius:radius, strokeStyle:this.strokeStyle}); },
    stroke:function(){ strokes.push({strokeStyle:this.strokeStyle, lineWidth:this.lineWidth}); },
    drawImage:function(source){ drawImages.push(source); },
    measureText:function(s){ return {width:String(s).length * 8}; },
    createLinearGradient:function(){ return gradient; },
    createRadialGradient:function(){ return gradient; }
  }, {
    get:function(target, key){ return key in target ? target[key] : function(){}; },
    set:function(target, key, value){ target[key] = value; return true; }
  });
}

function fakeWebGL(){
  var calls = {draws:0, deletedPrograms:0};
  return {
    _calls:calls,
    VERTEX_SHADER:35633, FRAGMENT_SHADER:35632, COMPILE_STATUS:35713, LINK_STATUS:35714,
    ARRAY_BUFFER:34962, ELEMENT_ARRAY_BUFFER:34963, STATIC_DRAW:35044,
    FLOAT:5126, UNSIGNED_SHORT:5123, TRIANGLES:4,
    DEPTH_TEST:2929, BLEND:3042, SRC_ALPHA:770, ONE_MINUS_SRC_ALPHA:771,
    COLOR_BUFFER_BIT:16384, DEPTH_BUFFER_BIT:256,
    createShader:function(){ return {}; }, shaderSource:function(){}, compileShader:function(){},
    getShaderParameter:function(){ return true; }, getShaderInfoLog:function(){ return ""; },
    deleteShader:function(){}, createProgram:function(){ return {}; }, attachShader:function(){},
    linkProgram:function(){}, getProgramParameter:function(){ return true; }, getProgramInfoLog:function(){ return ""; },
    enable:function(){}, blendFunc:function(){}, createBuffer:function(){ return {}; }, bindBuffer:function(){},
    bufferData:function(){}, deleteBuffer:function(){}, deleteProgram:function(){ calls.deletedPrograms++; },
    viewport:function(){}, clearColor:function(){}, clear:function(){}, useProgram:function(){},
    getAttribLocation:function(_,name){ return name === "aPosition" ? 0 : 1; },
    getUniformLocation:function(_,name){ return {name:name}; }, enableVertexAttribArray:function(){},
    vertexAttribPointer:function(){}, uniformMatrix4fv:function(){}, uniform4fv:function(){},
    drawElements:function(){ calls.draws++; }
  };
}

function piece(id, type, owner, row, col, orientation){
  return {id:id, type:type, owner:owner, row:row, col:col,
    orientation:orientation, alive:true};
}

function touch(game, point){
  game.onTouchStart({touches:[point]});
  game.onTouchEnd({touches:[], changedTouches:[point]});
}

function matchCellPoint(row, col){
  var pitch = 0.95;
  var z = -(row - 3.5);
  var depth = z * Math.cos(pitch) + 15;
  var scale = 405 / depth;
  return {
    clientX:(col - 4.5) * scale + 187.5,
    clientY:-z * Math.sin(pitch) * scale + 326.5
  };
}

function testAiAnimation(action, beforeSeconds, advanceSeconds, expected){
  var animCtx = fakeContext();
  var animGame = LaserGame.create(animCtx, 375, 667, function(){});
  animGame._debugGame.beginMatch();
  var before = animGame._debugGame.snapshot().pieces;
  animGame._debugEffects.beginAiAction(action);
  assert.equal(animGame._debugGame.snapshot().busy, true);
  animGame.update(beforeSeconds);
  assert.deepEqual(animGame._debugGame.snapshot().pieces, before,
    action.kind + " must not mutate rule state before animation completion");
  animGame.update(advanceSeconds - beforeSeconds);
  var snap = animGame._debugGame.snapshot();
  expected(snap, animCtx);
  assert.equal(snap.aiAnim, null);
  assert.equal(snap.busy, true,
    action.kind + " must keep input blocked while the laser runs");
  animGame.update(0.20);
  assert.deepEqual(animGame._debugGame.snapshot().pieces, snap.pieces,
    action.kind + " must commit exactly once");
  animGame.exit();
}

var game = LaserGame.create(fakeContext(), 375, 667, function(){});
assert.ok(game._debugAI, "AI debug surface must exist");

assert.ok(game._debugGame, "game-state debug surface must exist");

assert.ok(game._debugEffects.beamTurns, "beam effects debug surface must exist");
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
assert.deepEqual(game._debugEffects.beamTurns([
  {r:0,c:0}, {r:0,c:1}, null, {r:1,c:2}
]), [], "malformed visual paths must not produce partial turn effects");
assert.deepEqual(game._debugEffects.beamTurns([{r:0,c:0}, {r:0,c:1}]), [],
  "short visual paths must not produce turns");
assert.deepEqual(game._debugEffects.beamTurns([
  {r:0,c:0}, {r:0,c:0}, {r:0,c:1}
]), [], "repeated visual points must not produce turns");
[null, "0", NaN, Infinity].forEach(function(bad){
  assert.deepEqual(game._debugEffects.beamTurns([
    {r:0,c:0}, {r:bad,c:1}, {r:1,c:1}
  ]), [], "invalid coordinates must not produce turns: " + bad);
});

var beamCtx = fakeContext();
var beamGame = LaserGame.create(beamCtx, 375, 667, function(){});
beamGame._debugGame.beginMatch();
beamGame._debugEffects.setPieces([piece("rl", "laser", 0, 0, 0, 1)]);
beamCtx._strokes.length = 0;
beamGame._debugEffects.beginAiAction({kind:"skip"});
beamGame.update(0.90);
var glowWidths = beamCtx._strokes.filter(function(stroke){
  return stroke.strokeStyle === "#ff5a36";
}).map(function(stroke){ return stroke.lineWidth; });
assert.ok(glowWidths.length > 0, "beam render must draw a warm corona");
assert.ok(glowWidths.every(function(width){ return width >= 4 && width <= 6; }),
  "warm corona width must remain within 4–6px after its pulse");
assert.ok(beamCtx._strokes.some(function(stroke){return stroke.strokeStyle==="#65d9ff";}),
  "beam render must add a restrained electric-blue atmospheric halo");
assert.ok(beamGame._debugEffects.snapshot().timeoutCount > 0,
  "beam travel must use a tracked timer");
beamGame.exit();
assert.equal(beamGame._debugEffects.snapshot().timeoutCount, 0,
  "exit must clear beam travel timers");

var killCtx=fakeContext(),killGame=LaserGame.create(killCtx,375,667,function(){});
killGame._debugGame.beginMatch();
killGame._debugEffects.setPieces([
  piece("laser","laser",0,7,9,3),
  piece("victim","mirror",1,4,4,0)
]);
killGame._debugEffects.beginElimination(1);
assert.equal(killGame._debugEffects.snapshot().pieces[1].alive,true,
  "a hit piece must remain visible while its elimination animation begins");
killGame.update(.35);killCtx._arcs.length=0;killGame.render();
var killing=killGame._debugEffects.snapshot();
assert.ok(killing.killPose && killing.killPose.pose.scale<1 && killing.killPose.pose.scale>.08,
  "the hit piece must shrink and lift before removal");
assert.ok(killing.particleCount>0 && killCtx._arcs.length>0,
  "the elimination sequence must include visible impact rings and fragments");
killGame._debugEffects.completeElimination();
assert.equal(killGame._debugEffects.snapshot().pieces[1].alive,false,
  "the hit piece must leave rule state only after the visual sequence completes");
assert.equal(killGame._debugEffects.snapshot().killAnim,null);
killGame._debugEffects.setPieces([piece("victim2","shield",1,3,3,0)]);
killGame._debugEffects.beginElimination(0);
killGame.exit();
assert.equal(killGame._debugEffects.snapshot().killAnim,null,
  "exit must clear an in-flight elimination animation");
assert.equal(killGame._debugEffects.snapshot().particleCount,0,
  "exit must clear elimination fragments");

var initial = game._debugGame.snapshot();
assert.equal(initial.screen, "setup");
assert.equal(initial.layoutIdx, 0);
assert.equal(initial.difficulty, "normal");
assert.deepEqual(initial.pieces, game._debugAI.initialPieces(0));
assert.deepEqual(initial.camera, {
  yaw:0, pitch:1.08
}, "setup must expose its fixed shallow camera");
initial.pieces[0].row = -1;
assert.deepEqual(game._debugGame.snapshot().pieces, game._debugAI.initialPieces(0),
  "snapshot must not expose mutable game pieces");

var setupCamera = game._debugGame.snapshot().camera;
game.onTouchStart({touches:[{clientX:100, clientY:100}]});
game.onTouchMove({touches:[{clientX:120, clientY:100}]});
game.onTouchMove({touches:[{clientX:150, clientY:130}]});
game.onTouchEnd({touches:[], changedTouches:[{clientX:150, clientY:130}]});
assert.deepEqual(game._debugGame.snapshot().camera, setupCamera,
  "single-finger setup drag must not rotate the preview camera");

game.onTouchStart({touches:[
  {clientX:100, clientY:100}, {clientX:200, clientY:100}
]});
game.onTouchMove({touches:[
  {clientX:80, clientY:120}, {clientX:220, clientY:120}
]});
game.onTouchEnd({touches:[], changedTouches:[
  {clientX:80, clientY:120}, {clientX:220, clientY:120}
]});
assert.deepEqual(game._debugGame.snapshot().camera, setupCamera,
  "two-finger setup gestures must not rotate the preview camera");

game.cameraControl(40, 30);
assert.deepEqual(game._debugGame.snapshot().camera, setupCamera,
  "external camera control must not rotate the setup preview");
game._debugGame.selectLayout(1);
assert.deepEqual(game._debugGame.snapshot().camera, setupCamera,
  "switching setup layout must restore the fixed preview camera");

game._debugGame.selectLayout(2);
game._debugGame.selectDifficulty("easy");
var validSetup = game._debugGame.snapshot();
[-1, 5, 1.5].forEach(function(invalidLayout){
  game._debugGame.selectLayout(invalidLayout);
  var afterInvalidLayout = game._debugGame.snapshot();
  assert.equal(afterInvalidLayout.layoutIdx, validSetup.layoutIdx,
    "invalid layout must preserve selection: " + invalidLayout);
  assert.equal(afterInvalidLayout.difficulty, validSetup.difficulty,
    "invalid layout must preserve difficulty: " + invalidLayout);
  assert.deepEqual(afterInvalidLayout.pieces, validSetup.pieces,
    "invalid layout must preserve preview: " + invalidLayout);
});
game._debugGame.selectDifficulty("unknown");
var afterInvalidDifficulty = game._debugGame.snapshot();
assert.equal(afterInvalidDifficulty.layoutIdx, validSetup.layoutIdx,
  "unknown difficulty must preserve layout");
assert.equal(afterInvalidDifficulty.difficulty, validSetup.difficulty,
  "unknown difficulty must preserve selection");
assert.deepEqual(afterInvalidDifficulty.pieces, validSetup.pieces,
  "unknown difficulty must preserve preview");

var cameraGame = LaserGame.create(fakeContext(), 375, 667, function(){});
cameraGame._debugGame.beginMatch();
var matchCamera = cameraGame._debugGame.snapshot().camera;
var straightFitDistance = cameraGame._debugGame.snapshot().webglCamera.distance;
cameraGame.cameraControl(40, 30);
assert.notDeepEqual(cameraGame._debugGame.snapshot().camera, matchCamera,
  "external camera control must remain active during play");
assert.ok(cameraGame._debugGame.snapshot().webglCamera.distance > straightFitDistance,
  "angled boards must automatically pull the WebGL camera back to keep every edge visible");
matchCamera = cameraGame._debugGame.snapshot().camera;
cameraGame.onTouchStart({touches:[{clientX:100, clientY:100}]});
cameraGame.onTouchMove({touches:[{clientX:120, clientY:100}]});
cameraGame.onTouchMove({touches:[{clientX:150, clientY:130}]});
cameraGame.onTouchEnd({touches:[], changedTouches:[{clientX:150, clientY:130}]});
assert.notDeepEqual(cameraGame._debugGame.snapshot().camera, matchCamera,
  "single-finger camera drag must remain active during play");
matchCamera = cameraGame._debugGame.snapshot().camera;
cameraGame.onTouchStart({touches:[
  {clientX:100, clientY:100}, {clientX:200, clientY:100}
]});
cameraGame.onTouchMove({touches:[
  {clientX:80, clientY:120}, {clientX:220, clientY:120}
]});
cameraGame.onTouchEnd({touches:[], changedTouches:[
  {clientX:80, clientY:120}, {clientX:220, clientY:120}
]});
assert.notDeepEqual(cameraGame._debugGame.snapshot().camera, matchCamera,
  "two-finger camera gestures must remain active during play");
cameraGame.exit();

for(var previewLayout = 0; previewLayout < 5; previewLayout++){
  game._debugGame.selectLayout(previewLayout);
  assert.deepEqual(
    game._debugGame.snapshot().pieces,
    game._debugAI.initialPieces(previewLayout),
    "setup preview must use the real layout " + previewLayout
  );
}

["easy", "normal", "hard"].forEach(function(level){
  for(var layoutIndex = 0; layoutIndex < 5; layoutIndex++){
    var setupGame = LaserGame.create(fakeContext(), 375, 667, function(){});
    setupGame._debugGame.selectLayout(layoutIndex);
    setupGame._debugGame.selectDifficulty(level);
    var preview = setupGame._debugGame.snapshot().pieces;
    setupGame._debugGame.beginMatch();
    var match = setupGame._debugGame.snapshot();
    assert.equal(match.lockedLayoutIdx, layoutIndex);
    assert.equal(match.lockedDifficulty, level);
    assert.deepEqual(match.pieces, preview,
      level + " layout " + layoutIndex + " must start from its exact preview");
    setupGame.exit();
  }
});

for(var shieldLayout=0;shieldLayout<5;shieldLayout++){
  var shieldPieces=game._debugAI.initialPieces(shieldLayout).filter(function(p){
    return p.type === "shield";
  });
  assert.ok(shieldPieces.filter(function(p){ return p.owner===0; }).every(function(p){
    return p.orientation===0;
  }), "red shields must face the opponent in layout " + shieldLayout);
  assert.ok(shieldPieces.filter(function(p){ return p.owner===1; }).every(function(p){
    return p.orientation===2;
  }), "blue shields must face the opponent in layout " + shieldLayout);
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

var progressedPieces = startedMatch.pieces.map(function(p){
  return Object.assign({}, p);
});
progressedPieces[0].row = 6;
game._debugEffects.setPieces(progressedPieces);
game._debugGame.requestReturn();
assert.equal(game._debugGame.snapshot().modal, "confirmReturn");
game._debugGame.closeModal();
assert.equal(game._debugGame.snapshot().screen, "playing");
assert.deepEqual(game._debugGame.snapshot().pieces, progressedPieces,
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
assert.ok(uiCtx._texts.indexOf("主动构建反射路线，并预判玩家下一步回应") >= 0);
assert.equal(uiGame._debugGame.snapshot().screen, "setup");

[
  ["easy","主动推进并尝试简单攻击，仍会保留容错空间"],
  ["normal","主动构建反射路线，并预判玩家下一步回应"],
  ["hard","持续施压并推演多回合，优先形成致命光路"]
].forEach(function(expectation){
  var descCtx=fakeContext(), descGame=LaserGame.create(descCtx,375,667,function(){});
  descGame._debugGame.selectDifficulty(expectation[0]);
  descCtx._texts.length=0; descGame.render();
  assert.ok(descCtx._texts.indexOf(expectation[1])>=0,
    expectation[0]+" difficulty must show its new tactical description");
  descGame.exit();
});

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
assert.equal(uiCtx._texts.indexOf("返回设置"), -1);
assert.equal(uiCtx._texts.indexOf("重开"), -1);
assert.ok(uiCtx._texts.indexOf("OPTICAL MATCH / LIVE ARRAY") >= 0);
assert.ok(uiCtx._texts.indexOf("红方行动") >= 0);
assert.ok(uiCtx._texts.indexOf("TACTICAL FIELD / 10×8") >= 0);
assert.ok(uiCtx._texts.indexOf("SELECT") >= 0);
assert.ok(uiCtx._texts.indexOf("选择棋子，或直接发射") >= 0);
var fittedCamera=uiGame._debugGame.snapshot().webglCamera;
assert.ok(fittedCamera.distance>=26,"match camera must zoom out enough for edge pieces");
var depthPath=[{r:0,c:4},{r:7,c:4}];
var overlayHead=uiGame._debugEffects.webglBeamHead(depthPath,.5);
var webglHead=WebGLRenderer.projectPoint(3.5,4,.34,375,667,fittedCamera);
assert.ok(Math.abs(overlayHead.x-webglHead.x)<1e-7 && Math.abs(overlayHead.y-webglHead.y)<1e-7,
  "the circular laser head must use the exact WebGL endpoint projection");
var projectedEnds=depthPath.map(function(point){
  return WebGLRenderer.projectPoint(point.r,point.c,.34,375,667,fittedCamera);
});
assert.ok(Math.abs(overlayHead.y-(projectedEnds[0].y+projectedEnds[1].y)/2)>.05,
  "the laser head must project the moving world point instead of interpolating screen pixels");
var fittedCorners=[[0,0],[0,9],[7,0],[7,9]].map(function(cell){
  return WebGLRenderer.projectCell(cell[0],cell[1],375,667,fittedCamera);
});
assert.ok(Math.min.apply(null,fittedCorners.map(function(point){return point.x;}))>=30 &&
  Math.max.apply(null,fittedCorners.map(function(point){return point.x;}))<=345,
  "all four board corners must retain horizontal room for full 3D pieces");

var tallGame=LaserGame.create(fakeContext(),430,932,function(){});
tallGame._debugGame.beginMatch();
var tallCamera=tallGame._debugGame.snapshot().webglCamera;
assert.ok(tallCamera.distance>30,
  "modern tall phones must increase camera distance from their real aspect ratio");
var tallCorners=[[0,0],[0,9],[7,0],[7,9]].map(function(cell){
  return WebGLRenderer.projectCell(cell[0],cell[1],430,932,tallCamera);
});
assert.ok(Math.min.apply(null,tallCorners.map(function(point){return point.x;}))>=40 &&
  Math.max.apply(null,tallCorners.map(function(point){return point.x;}))<=390,
  "tall-phone board corners must leave enough room for edge models");
tallGame.exit();

touch(uiGame, matchCellPoint(7,5));
touch(uiGame, matchCellPoint(6,5));
assert.equal(uiGame._debugGame.snapshot().phase, "fire");
uiCtx._texts.length = 0;
uiGame.render();
assert.ok(uiCtx._texts.indexOf("回合结束") >= 0);
assert.equal(uiCtx._texts.indexOf("跳过"), -1);

uiGame._debugGame.requestReturn();
uiCtx._texts.length = 0;
uiGame.render();
assert.ok(uiCtx._texts.some(function(text){
  return text.indexOf("当前对局进度将丢失") >= 0;
}));
uiGame.exit();

var startCtx = fakeContext();
var startGame = LaserGame.create(startCtx, 375, 667, function(){});
// Setup controls use an optical formation rail and a bottom-anchored start action.
var layoutTouch = {clientX:269, clientY:431};
startGame.onTouchStart({touches:[layoutTouch]});
startGame.onTouchEnd({touches:[], changedTouches:[layoutTouch]});
assert.equal(startGame._debugGame.snapshot().layoutIdx, 3,
  "the optical formation rail must select the touched layout");
var difficultyTouch = {clientX:75, clientY:488};
startGame.onTouchStart({touches:[difficultyTouch]});
startGame.onTouchEnd({touches:[], changedTouches:[difficultyTouch]});
assert.equal(startGame._debugGame.snapshot().difficulty, "easy",
  "the segmented difficulty control must select the touched level");
var startTouch = {clientX:280, clientY:590};
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

assert.deepEqual(game._debugAI.config("easy"), {
  attack:1.05, defense:1.10, guard:1.15, reply:0,
  advance:0.55, initiative:1.10, passive:0.24,
  candidates:24, variety:3.0, depth:1
});
assert.deepEqual(game._debugAI.config("normal"), {
  attack:2.35, defense:1.00, guard:0.90, reply:0.65,
  advance:0.90, initiative:1.60, passive:0.32,
  candidates:40, variety:1.0, depth:2
});
assert.deepEqual(game._debugAI.config("hard"), {
  attack:2.15, defense:1.20, guard:1.10, reply:1.0,
  advance:1.10, initiative:2.00, passive:0.38,
  candidates:40, variety:0.25, depth:3
});
var easyConfig = game._debugAI.config("easy");
easyConfig.attack = 99;
assert.equal(game._debugAI.config("easy").attack, 1.05,
  "config must not expose mutable AI level settings");

var mirrorDirections = [[0,-1],[1,0],[0,1],[-1,0]];
var mirrorMaps = [{1:0,2:3},{3:0,2:1},{3:2,0:1},{1:2,0:3}];
for(var mirrorOrientation=0;mirrorOrientation<4;mirrorOrientation++){
  for(var incoming=0;incoming<4;incoming++){
    var center={r:3,c:4}, delta=mirrorDirections[incoming];
    var reflectionPieces=[
      piece("laser","laser",0,center.r-delta[1],center.c-delta[0],incoming),
      piece("mirror","mirror",1,center.r,center.c,mirrorOrientation)
    ];
    var reflection=game._debugAI.resolve(reflectionPieces,0,{kind:"skip"});
    var outgoing=mirrorMaps[mirrorOrientation][incoming];
    if(outgoing===undefined){
      assert.equal(reflection.eliminated && reflection.eliminated.id,"mirror",
        "laser must destroy the non-reflective back at orientation "+mirrorOrientation+" input "+incoming);
    } else {
      var outDelta=mirrorDirections[outgoing];
      assert.equal(reflection.eliminated,null,
        "laser must survive the reflective face at orientation "+mirrorOrientation+" input "+incoming);
      assert.deepEqual(reflection.path[2],{r:center.r+outDelta[1],c:center.c+outDelta[0]},
        "laser must leave in the mapped direction at orientation "+mirrorOrientation+" input "+incoming);
    }
  }
}

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
  ["easy", "normal", "hard"].forEach(function(level){
    var action = game._debugAI.choose(safePressure, 1, level, 3);
    assert.equal(action.pi, 1, level + " should use the mirror to build pressure");
    assert.equal(action.kind, "rot");
    assert.equal(action.d, 1);
  });
  assert.equal(game._debugAI.passiveTurn(safePressure,safePressure,0),true,
    "a human turn that creates no attack must increase AI initiative");

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

  var crossOwnerShieldSwap = [
    piece("bs", "switch", 1, 4, 4, 0),
    piece("rs", "shield", 0, 4, 5, 0)
  ];
  assert.ok(game._debugAI.actions(crossOwnerShieldSwap, 1).some(function(action){
    return action.kind === "swap" && action.pi === 0 && action.ti === 1;
  }), "switch must be able to swap with an adjacent opponent shield");

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

  var redTargetByBlueZone = [
    piece("bs", "switch", 1, 4, 0, 0),
    piece("rm", "mirror", 0, 4, 1, 0)
  ];
  assert.ok(!game._debugAI.actions(redTargetByBlueZone, 1).some(function(action){
    return action.kind === "swap" && action.ti === 1;
  }), "swap must be rejected when the red target would land in a blue reserved cell");

  var blueTargetByRedZone = [
    piece("rs", "switch", 0, 4, 9, 0),
    piece("bm", "mirror", 1, 4, 8, 0)
  ];
  assert.ok(!game._debugAI.actions(blueTargetByRedZone, 0).some(function(action){
    return action.kind === "swap" && action.ti === 1;
  }), "swap must be rejected when the blue target would land in a red reserved cell");

  testAiAnimation({pi:14, kind:"move", r:5, c:7}, 0.73, 0.75, function(snap, ctx){
    assert.equal(snap.pieces[14].row, 5);
    assert.equal(snap.pieces[14].col, 7);
    assert.ok(ctx._texts.some(function(text){
      return text.indexOf("电脑移动：") === 0;
    }));
  });

  testAiAnimation({pi:14, kind:"rot", d:1}, 0.67, 0.70, function(snap, ctx){
    assert.equal(snap.pieces[14].orientation,
      (game._debugAI.initialPieces(0)[14].orientation + 1) % 4);
    assert.ok(ctx._texts.indexOf("电脑旋转棋子") >= 0);
  });

  testAiAnimation({pi:25, kind:"laserRot", dir:1}, 0.67, 0.70, function(snap){
    assert.equal(snap.pieces[25].orientation, 1);
  });

  var blockedGame = LaserGame.create(fakeContext(), 375, 667, function(){});
  blockedGame._debugGame.beginMatch();
  var blockedPieces = blockedGame._debugGame.snapshot().pieces;
  blockedGame._debugEffects.beginAiAction({pi:14, kind:"move", r:5, c:7});
  touch(blockedGame, matchCellPoint(7, 5));
  assert.deepEqual(blockedGame._debugGame.snapshot().pieces, blockedPieces,
    "player touch must not change pieces during AI motion");
  assert.equal(blockedGame._debugGame.snapshot().sel, -1,
    "player touch must not select a piece during AI motion");
  blockedGame.update(0.75);
  var beamState = blockedGame._debugGame.snapshot();
  touch(blockedGame, matchCellPoint(7, 5));
  assert.deepEqual(blockedGame._debugGame.snapshot().pieces, beamState.pieces,
    "player touch must not change pieces during beam travel");
  assert.equal(blockedGame._debugGame.snapshot().phase, "anim");
  assert.equal(blockedGame._debugGame.snapshot().sel, -1);
  blockedGame.exit();

  var animatedSwap = [
    piece("bs", "switch", 1, 4, 4, 0),
    piece("rm", "mirror", 0, 4, 5, 0)
  ];
  var swapCtx = fakeContext();
  var swapGame = LaserGame.create(swapCtx, 375, 667, function(){});
  swapGame._debugGame.beginMatch();
  swapGame._debugEffects.setPieces(animatedSwap);
  swapCtx._arcs.length = 0;
  swapGame._debugEffects.beginAiAction({pi:0, kind:"swap", ti:1});
  assert.equal(swapGame._debugGame.snapshot().busy, true);
  assert.equal(swapCtx._arcs.filter(function(arc){
    return arc.strokeStyle === "rgba(255,225,77,0.95)";
  }).length, 2, "swap lead-in must highlight both pieces");
  swapCtx._arcs.length = 0;
  swapGame.update(0.70);
  assert.equal(swapCtx._arcs.filter(function(arc){
    return typeof arc.strokeStyle === "string" && arc.strokeStyle.indexOf("rgba(255,225,77,") === 0;
  }).length, 2, "swap landing must pulse both destinations");
  swapGame.update(0.09);
  assert.deepEqual(swapGame._debugGame.snapshot().pieces, animatedSwap,
    "swap must keep both rule positions unchanged during animation");
  swapGame.update(0.02);
  var swapped = swapGame._debugEffects.snapshot();
  assert.equal(swapped.pieces[0].row, 4);
  assert.equal(swapped.pieces[0].col, 5);
  assert.equal(swapped.pieces[1].row, 4);
  assert.equal(swapped.pieces[1].col, 4);
  assert.equal(swapped.aiAnim, null);
  assert.ok(swapCtx._texts.indexOf("电脑互换棋子") >= 0);
  swapGame.update(0.20);
  assert.deepEqual(swapGame._debugEffects.snapshot().pieces, swapped.pieces,
    "swap must commit exactly once");
  swapGame.exit();

  testAiAnimation({kind:"skip"}, 0.51, 0.53, function(snap, ctx){
    assert.deepEqual(snap.pieces, game._debugAI.initialPieces(0));
    assert.equal(snap.actionNotice, "电脑选择直接发射");
    assert.ok(ctx._texts.indexOf("电脑选择直接发射") >= 0);
  });

  var invalidGame = LaserGame.create(fakeContext(), 375, 667, function(){});
  invalidGame._debugGame.beginMatch();
  invalidGame._debugEffects.beginAiAction({pi:999, kind:"move", r:3, c:3});
  var recovered = invalidGame._debugGame.snapshot();
  assert.equal(recovered.aiAnim, null);
  assert.equal(recovered.phase, "anim",
    "an animation creation failure must continue immediately to laser fire");
  assert.equal(recovered.busy, true);
  invalidGame.exit();

  var exitGame = LaserGame.create(fakeContext(), 375, 667, function(){});
  exitGame._debugGame.beginMatch();
  var exitPieces = exitGame._debugGame.snapshot().pieces;
  exitGame._debugEffects.beginAiAction({pi:14, kind:"move", r:5, c:7});
  exitGame.exit();
  var exited = exitGame._debugEffects.snapshot();
  assert.equal(exited.aiAnim, null, "exit must clear a pending AI animation");
  assert.equal(exited.actionNotice, null, "exit must clear the AI action notice");
  assert.equal(exited.timeoutCount, 0, "exit must clear tracked timers");
  exitGame.update(1);
  var afterExitUpdate = exitGame._debugEffects.snapshot();
  assert.deepEqual(afterExitUpdate.pieces, exitPieces,
    "update after exit must not commit the pending action");
  assert.equal(afterExitUpdate.aiAnim, null);
  assert.equal(afterExitUpdate.actionNotice, null);
  assert.equal(afterExitUpdate.timeoutCount, 0,
    "update after exit must not create a timer");

  var savedSetTimeout = global.setTimeout;
  var savedClearTimeout = global.clearTimeout;
  var savedNow = Date.now;
  var pendingTimers = [];
  var nextTimerId = 1;
  var fakeNow = 1000;
  global.setTimeout = function(fn){
    var id = nextTimerId++;
    pendingTimers.push({id:id, fn:fn});
    return id;
  };
  global.clearTimeout = function(id){
    pendingTimers = pendingTimers.filter(function(timer){ return timer.id !== id; });
  };
  Date.now = function(){ return fakeNow; };
  try {
    var thinkingGame = LaserGame.create(fakeContext(), 375, 667, function(){});
    thinkingGame._debugGame.beginMatch();
    touch(thinkingGame, {clientX:53, clientY:596});
    assert.equal(thinkingGame._debugGame.snapshot().phase, "anim");
    assert.equal(thinkingGame._debugGame.snapshot().busy, true);
    touch(thinkingGame, matchCellPoint(7, 5));
    assert.equal(thinkingGame._debugGame.snapshot().sel, -1,
      "player touch must not select a piece during human beam travel");

    fakeNow += 10000;
    for(var timerStep=0;timerStep<20;timerStep++){
      var timerState=thinkingGame._debugGame.snapshot();
      if(timerState.current===1 && timerState.busy) break;
      assert.ok(pendingTimers.length,"laser resolution must eventually schedule the AI turn");
      thinkingGame.update(0.1);
      pendingTimers.shift().fn();
    }
    var thinking = thinkingGame._debugGame.snapshot();
    assert.equal(thinking.current, 1);
    assert.equal(thinking.busy, true);
    assert.equal(thinking.playerPassiveTurns,1,
      "a non-attacking human turn must increase the AI initiative counter");
    assert.ok(thinkingGame._debugEffects.snapshot().timeoutCount > 0,
      "AI thinking must use a tracked timer");
    touch(thinkingGame, matchCellPoint(0, 6));
    assert.equal(thinkingGame._debugGame.snapshot().sel, -1,
      "player touch must not select a piece during AI thinking");
    thinkingGame.exit();
    assert.equal(thinkingGame._debugEffects.snapshot().timeoutCount, 0,
      "exit must clear AI thinking timers");
  } finally {
    global.setTimeout = savedSetTimeout;
    global.clearTimeout = savedClearTimeout;
    Date.now = savedNow;
  }

  for(var levelIndex = 0; levelIndex < 3; levelIndex++){
    var level = ["easy", "normal", "hard"][levelIndex];
    for(var layoutIndex = 0; layoutIndex < 5; layoutIndex++){
      var started = Date.now();
      game._debugAI.choose(game._debugAI.initialPieces(layoutIndex), 1, level);
      var elapsed = Date.now() - started;
      assert.ok(elapsed < 800,
        level + " layout " + layoutIndex + " took " + elapsed + "ms");
    }
  }
} finally {
  Math.random = savedRandom;
  game.exit();
}

var webglCtx = fakeContext();
var webgl = fakeWebGL();
var offscreen = {width:0,height:0,getContext:function(type){ return type === "webgl" ? webgl : null; }};
var webglGame = LaserGame.create(webglCtx, 375, 667, function(){}, {
  createCanvas:function(){ return offscreen; },
  readAsset:function(assetPath, done){
    var data = fs.readFileSync(path.join(__dirname, "..", assetPath));
    done(null, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  },
  dpr:1
});
webglGame.render();
assert.ok(webglCtx._drawImages.indexOf(offscreen) >= 0,
  "a ready WebGL board must be composited into the existing 2D game UI");
assert.ok(webgl._calls.draws > 0,
  "the integrated setup preview must render real GLB geometry");
assert.equal(webglGame._debugGame.snapshot().rendererMode, "ready",
  "the game state debug surface must expose the active renderer mode");
webglGame._debugGame.beginMatch();
var webglPiecePoint = require("../games/laser/webgl-renderer.js")
  .projectCell(7, 4, 375, 667, {yaw:0,pitch:0.95,distance:22,offsetY:-27});
touch(webglGame, {clientX:webglPiecePoint.x, clientY:webglPiecePoint.y});
assert.ok(webglGame._debugGame.snapshot().sel >= 0,
  "touching a projected red GLB piece must select its real board cell");
webglGame.exit();
assert.equal(webgl._calls.deletedPrograms, 1,
  "exiting the laser module must dispose the WebGL program exactly once");

var fallbackCtx = fakeContext();
var fallbackGame = LaserGame.create(fallbackCtx, 375, 667, function(){}, {
  createCanvas:function(){ return {getContext:function(){ return null; }}; },
  readAsset:function(){ throw new Error("assets must not load without WebGL"); },
  dpr:1
});
fallbackGame.render();
assert.equal(fallbackGame._debugGame.snapshot().rendererMode, "fallback",
  "missing WebGL must select the existing pseudo-3D renderer");
assert.equal(fallbackCtx._drawImages.length, 0,
  "fallback mode must not composite an unusable offscreen canvas");
fallbackGame.exit();

var pendingReads = [];
var lateGl = fakeWebGL();
var lateCtx = fakeContext();
var lateGame = LaserGame.create(lateCtx, 375, 667, function(){}, {
  createCanvas:function(){ return {width:0,height:0,getContext:function(){ return lateGl; }}; },
  readAsset:function(assetPath, done){ pendingReads.push({path:assetPath, done:done}); },
  dpr:1
});
assert.equal(lateGame._debugGame.snapshot().rendererMode, "loading",
  "asynchronous model reads must expose loading state");
lateGame.exit();
pendingReads.forEach(function(read){
  var data = fs.readFileSync(path.join(__dirname, "..", read.path));
  read.done(null, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
});
lateGame.render();
assert.equal(lateGame._debugGame.snapshot().rendererMode, "loading",
  "late model callbacks after exit must not revive the WebGL renderer");
assert.equal(lateCtx._drawImages.length, 0,
  "late model callbacks after exit must not composite a disposed canvas");

var compositeCtx = fakeContext();
compositeCtx.drawImage = function(){ throw new Error("test composite failure"); };
var compositeGl = fakeWebGL();
var compositeGame = LaserGame.create(compositeCtx, 375, 667, function(){}, {
  createCanvas:function(){ return {width:0,height:0,getContext:function(){ return compositeGl; }}; },
  readAsset:function(assetPath, done){
    var data = fs.readFileSync(path.join(__dirname, "..", assetPath));
    done(null, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  },
  dpr:1
});
compositeGame.render();
assert.equal(compositeGame._debugGame.snapshot().rendererMode, "fallback",
  "2D composition failure must permanently switch the module to pseudo-3D");
assert.equal(compositeGl._calls.deletedPrograms, 1,
  "composition failure must dispose WebGL resources once");
compositeGame.exit();

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

  // App starts directly on the laser setup screen (no menu)
  suiteFrame(16);
  assert.ok(suiteCtx._texts.indexOf("来桌游") >= 0,
    "suite must start directly on laser setup screen");
  assert.ok(suiteCtx._texts.indexOf("选择阵型") >= 0,
    "suite setup must show formation selector");
  assert.ok(suiteCtx._texts.indexOf("开始游戏") >= 0,
    "suite setup must show start button");

  // Click "开始游戏" to start playing
  var productionStart = {clientX:280, clientY:590};
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
