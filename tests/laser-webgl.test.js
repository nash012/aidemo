"use strict";

var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");
var GlbLoader = null;
try { GlbLoader = require("../games/laser/glb-loader.js"); } catch (e) {}
var WebGLRenderer = null;
try { WebGLRenderer = require("../games/laser/webgl-renderer.js"); } catch (e) {}

var MODEL_DIR = path.join(__dirname, "..", "games", "laser", "models");
var MODEL_FILES = [
  "laser_cannon_red.glb",
  "laser_cannon_blue.glb",
  "king_red.glb",
  "king_blue.glb",
  "shield_red.glb",
  "shield_blue.glb",
  "single_mirror_red.glb",
  "single_mirror_blue.glb",
  "double_mirror_red.glb",
  "double_mirror_blue.glb"
];

MODEL_FILES.forEach(function(file){
  var modelPath = path.join(MODEL_DIR, file);
  assert.ok(fs.existsSync(modelPath), file + " must be bundled with the laser game");
  var data = fs.readFileSync(modelPath);
  assert.ok(data.length >= 20, file + " must contain a complete GLB header");
  assert.equal(data.toString("ascii", 0, 4), "glTF", file + " must be a GLB file");
  assert.equal(data.readUInt32LE(4), 2, file + " must use glTF 2.0");
  assert.equal(data.readUInt32LE(8), data.length, file + " header length must match file size");
});

assert.equal(fs.existsSync(path.join(MODEL_DIR, "all_pieces_overview.glb")), false,
  "the overview model must not ship in the runtime bundle");

assert.ok(GlbLoader && typeof GlbLoader.parseGlb === "function",
  "the runtime must expose a GLB parser");
assert.equal(typeof GlbLoader.mirrorSurfaces, "function",
  "the runtime must expose mirror surface metadata");

function modelArrayBuffer(file){
  var data = fs.readFileSync(path.join(MODEL_DIR, file));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function replaceGlbText(buffer, from, to){
  assert.equal(from.length, to.length, "GLB text replacements must preserve chunk length");
  var copy = Buffer.from(new Uint8Array(buffer));
  var offset = copy.indexOf(from);
  assert.ok(offset >= 0, "GLB fixture must contain " + from);
  copy.write(to, offset, "ascii");
  return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
}

var singleMirror = GlbLoader.parseGlb(modelArrayBuffer("single_mirror_red.glb"));
assert.equal(singleMirror.meshes.length, 10,
  "single mirror must retain all ten authored mesh parts");
assert.deepEqual(singleMirror.materials.map(function(material){ return material.name; }),
  ["red", "red_dark", "mirror"], "single mirror PBR materials must be preserved");
singleMirror.meshes.forEach(function(mesh){
  assert.ok(mesh.primitives.length > 0, "every GLB mesh must contain a primitive");
  mesh.primitives.forEach(function(primitive){
    assert.ok(primitive.positions.length > 0, "primitive positions must be decoded");
    assert.equal(primitive.normals.length, primitive.positions.length,
      "every rendered vertex must have a normal");
    assert.ok(primitive.indices.length > 0, "primitive indices must be decoded");
    assert.ok(primitive.material && primitive.material.name,
      "primitive material factors must be resolved");
  });
});
assert.deepEqual(GlbLoader.mirrorSurfaces(singleMirror),
  ["single_mirror_red_Mirror_Face"],
  "single mirror must expose only its authored front mirror face");
assert.deepEqual(GlbLoader.mirrorSurfaceNormals(singleMirror), [[0,1]],
  "single mirror metadata must expose its one reflective local normal");

var doubleMirror = GlbLoader.parseGlb(modelArrayBuffer("double_mirror_blue.glb"));
assert.deepEqual(GlbLoader.mirrorSurfaces(doubleMirror), [
  "double_mirror_blue_Mirror_Front",
  "double_mirror_blue_Mirror_Back"
], "double mirror must expose its two authored mirror faces");
assert.deepEqual(GlbLoader.mirrorSurfaceNormals(doubleMirror), [[0,-1],[0,1]],
  "double mirror metadata must expose two opposing reflective normals");

var transformedMirror = GlbLoader.parseGlb(modelArrayBuffer("single_mirror_red.glb"));
transformedMirror.nodes.filter(function(node){ return /_Mirror_Face$/.test(node.name); })[0]
  .rotation = [0,1,0,0];
assert.throws(function(){ GlbLoader.mirrorSurfaces(transformedMirror); }, /transform/,
  "unsupported mirror node transforms must fail instead of being ignored");
var badNormalMirror = GlbLoader.parseGlb(modelArrayBuffer("single_mirror_red.glb"));
var badNormalNode = badNormalMirror.nodes.filter(function(node){ return /_Mirror_Face$/.test(node.name); })[0];
var badNormals = badNormalMirror.meshes[badNormalNode.mesh].primitives[0].normals;
for(var badN=0;badN<badNormals.length;badN+=3){ badNormals[badN]=1; badNormals[badN+1]=0; badNormals[badN+2]=0; }
badNormals[0]=0; badNormals[2]=1;
assert.throws(function(){ GlbLoader.mirrorSurfaces(badNormalMirror); }, /normal/,
  "one stray Z normal must not validate an incorrectly authored mirror surface");

var validSingle = new Uint8Array(modelArrayBuffer("single_mirror_red.glb"));
var badMagic = validSingle.slice();
badMagic[0] = 0;
assert.throws(function(){ GlbLoader.parseGlb(badMagic.buffer); }, /bad magic/,
  "a damaged GLB header must fail closed");
var truncated = validSingle.slice(0, validSingle.length - 4);
new DataView(truncated.buffer).setUint32(8, truncated.length, true);
assert.throws(function(){ GlbLoader.parseGlb(truncated.buffer); }, /bounds|truncated/,
  "a truncated GLB chunk must fail closed");
assert.throws(function(){ GlbLoader.mirrorSurfaces({nodes:[]}); }, /missing mirror/,
  "a model without authored mirror nodes must fail closed");
var uint32Indices = replaceGlbText(modelArrayBuffer("single_mirror_red.glb"),
  '"componentType":5123', '"componentType":5125');
assert.throws(function(){ GlbLoader.parseGlb(uint32Indices); }, /32-bit indices/,
  "WebGL1-unsupported 32-bit indices must fail closed instead of truncating");

assert.ok(WebGLRenderer, "the runtime must expose a WebGL board renderer");
assert.deepEqual([
  {type:"laser", owner:0, want:"laser_cannon_red"},
  {type:"king", owner:1, want:"king_blue"},
  {type:"shield", owner:0, want:"shield_red"},
  {type:"mirror", owner:1, want:"single_mirror_blue"},
  {type:"switch", owner:0, want:"double_mirror_red"}
].map(function(test){ return WebGLRenderer.pieceModelKey(test); }), [
  "laser_cannon_red", "king_blue", "shield_red",
  "single_mirror_blue", "double_mirror_red"
], "piece types and teams must map to the authored GLB names");

for(var row=0;row<8;row++){
  for(var col=0;col<10;col++){
    var world = WebGLRenderer.cellToWorld(row, col);
    assert.deepEqual(WebGLRenderer.worldToCell(world.x, world.z), {r:row,c:col},
      "board cell coordinates must round-trip at " + row + "," + col);
  }
}
assert.equal(WebGLRenderer.worldToCell(-5.1, 0), null,
  "world positions outside the board must not select a cell");

var zones = WebGLRenderer.zoneCells();
assert.deepEqual(zones.red, [
  {r:0,c:1},{r:0,c:9},{r:1,c:9},{r:2,c:9},{r:3,c:9},
  {r:4,c:9},{r:5,c:9},{r:6,c:9},{r:7,c:1}
],
  "red restricted cells must match the current board");
assert.deepEqual(zones.white, [
  {r:0,c:8},{r:1,c:0},{r:2,c:0},{r:3,c:0},{r:4,c:0},
  {r:5,c:0},{r:6,c:0},{r:7,c:0},{r:7,c:8}
],
  "white restricted cells must match the current board");

["laser", "shield", "mirror", "switch"].forEach(function(type){
  var angles = [0,1,2,3].map(function(orientation){
    return WebGLRenderer.orientationAngle(type, orientation);
  });
  for(var i=1;i<4;i++) assert.ok(Math.abs(Math.abs(angles[i]-angles[i-1]) - Math.PI/2) < 1e-9,
    type + " orientations must rotate by exactly 90 degrees");
  assert.ok(Math.abs(WebGLRenderer.orientationAngle(type, 0.5) -
    (angles[0] + angles[1]) / 2) < 1e-9,
    type + " AI rotation must interpolate continuously between orientations");
});
assert.equal(WebGLRenderer.validateMirrorDirections(
  GlbLoader.mirrorSurfaceNormals(singleMirror)[0]), true,
  "authored mirror normals must agree with all existing reflection directions");
assert.equal(WebGLRenderer.validateMirrorDirections([1,0]), false,
  "a mirror normal rotated away from the authored face must fail rule calibration");

function fakeGl(options){
  options = options || {};
  var bufferNumber = 0, shaderNumber = 0;
  var calls = {bufferData:0, drawElements:0, attrib:0, matrix:0, modelMatrices:[],
    deletedBuffers:0, deletedPrograms:0, deletedShaders:0, depthMasks:[]};
  var gl = {
    _calls:calls,
    VERTEX_SHADER:35633, FRAGMENT_SHADER:35632, COMPILE_STATUS:35713, LINK_STATUS:35714,
    ARRAY_BUFFER:34962, ELEMENT_ARRAY_BUFFER:34963, STATIC_DRAW:35044,
    FLOAT:5126, UNSIGNED_SHORT:5123, TRIANGLES:4,
    DEPTH_TEST:2929, BLEND:3042, SRC_ALPHA:770, ONE_MINUS_SRC_ALPHA:771,
    COLOR_BUFFER_BIT:16384, DEPTH_BUFFER_BIT:256,
    createShader:function(){ shaderNumber++; return {number:shaderNumber}; }, shaderSource:function(){}, compileShader:function(){},
    getShaderParameter:function(shader){ return shader.number !== options.failShaderAt; }, getShaderInfoLog:function(){ return "test shader failure"; },
    deleteShader:function(){ calls.deletedShaders++; }, createProgram:function(){ return {}; }, attachShader:function(){},
    linkProgram:function(){}, getProgramParameter:function(){ return true; },
    getProgramInfoLog:function(){ return ""; }, enable:function(){}, blendFunc:function(){},
    createBuffer:function(){ bufferNumber++; return bufferNumber === options.failBufferAt ? null : {number:bufferNumber}; }, bindBuffer:function(){},
    bufferData:function(){ calls.bufferData++; }, deleteBuffer:function(){ calls.deletedBuffers++; },
    deleteProgram:function(){ calls.deletedPrograms++; }, viewport:function(){}, clearColor:function(){},
    clear:function(){}, useProgram:function(){}, getAttribLocation:function(_,name){ return name === "aPosition" ? 0 : 1; },
    getUniformLocation:function(_,name){ return {name:name}; }, enableVertexAttribArray:function(){},
    vertexAttribPointer:function(){ calls.attrib++; }, uniformMatrix4fv:function(location,_,value){
      calls.matrix++;
      if(location && location.name === "uModel") calls.modelMatrices.push(Array.prototype.slice.call(value));
    },
    uniform4fv:function(){}, depthMask:function(value){ calls.depthMasks.push(value); },
    drawElements:function(){ calls.drawElements++; }
  };
  return gl;
}

var observedGl = fakeGl();
var observedContextOptions = null;
var observedCanvas = {width:640, height:480, getContext:function(type,options){
  observedContextOptions = options; return observedGl;
}};
var observedRenderer = WebGLRenderer.create({
  canvas:observedCanvas,
  readAsset:function(assetPath, done){
    var file = assetPath.slice(assetPath.lastIndexOf("/") + 1);
    done(null, modelArrayBuffer(file));
  }
});
var loaded = false;
observedRenderer.load(function(ok){ loaded = ok; });
assert.equal(loaded, true, "all ten real GLBs must initialize the WebGL renderer");
assert.deepEqual(observedContextOptions, {alpha:true,antialias:true,preserveDrawingBuffer:true},
  "offscreen WebGL must preserve its frame for 2D canvas composition");
observedRenderer.resize(640, 480, 1);
var boardOnlyBefore = observedGl._calls.drawElements;
observedRenderer.render({pieces:[],camera:{yaw:0,pitch:0.95},selected:-1,targets:[],path:null,aiPose:null});
assert.equal(observedGl._calls.drawElements - boardOnlyBefore, 81,
  "the board must draw its 80 colored cells plus one shared 3D edge shell");
[
  {r:0,c:0}, {r:0,c:9}, {r:3,c:4}, {r:4,c:5}, {r:7,c:0}, {r:7,c:9}
].forEach(function(cell){
  var screen = WebGLRenderer.projectCell(cell.r, cell.c, 640, 480, {yaw:0,pitch:0.95});
  assert.deepEqual(observedRenderer.pick(screen.x, screen.y, {yaw:0,pitch:0.95}), cell,
    "WebGL picking must return the projected board cell " + cell.r + "," + cell.c);
});
[
  {yaw:0,pitch:1.08,distance:27,offsetY:-90},
  {yaw:0,pitch:0.95,distance:22,offsetY:-27},
  {yaw:0.7,pitch:0.65,distance:22,offsetY:-27}
].forEach(function(camera){
  var screen = WebGLRenderer.projectCell(7, 4, 640, 480, camera);
  assert.deepEqual(observedRenderer.pick(screen.x, screen.y, camera), {r:7,c:4},
    "setup and playing camera offsets must share the same picking transform");
});
var setupCorners = [
  WebGLRenderer.projectCell(0,0,375,667,{yaw:0,pitch:1.08,distance:27,offsetY:-90}),
  WebGLRenderer.projectCell(0,9,375,667,{yaw:0,pitch:1.08,distance:27,offsetY:-90}),
  WebGLRenderer.projectCell(7,0,375,667,{yaw:0,pitch:1.08,distance:27,offsetY:-90}),
  WebGLRenderer.projectCell(7,9,375,667,{yaw:0,pitch:1.08,distance:27,offsetY:-90})
];
assert.ok(Math.min.apply(null, setupCorners.map(function(point){ return point.y; })) >= 150 &&
  Math.max.apply(null, setupCorners.map(function(point){ return point.y; })) <= 345,
  "setup WebGL board must leave room below for formation labels and controls");
assert.equal(observedRenderer.pick(-100, -100, {yaw:0,pitch:0.95}), null,
  "screen points outside the WebGL canvas must not select a board cell");
var uploadsAfterLoad = observedGl._calls.bufferData;
var renderScene = {
  pieces:[{type:"king",owner:0,row:7,col:4,orientation:1,alive:true}],
  camera:{yaw:0,pitch:0.95}, selected:-1, targets:[], path:null, aiPose:null
};
assert.equal(observedRenderer.render(renderScene), true, "a ready renderer must draw the board scene");
assert.ok(observedGl._calls.drawElements > 0, "render must issue indexed draws");
assert.ok(observedGl._calls.attrib > 0, "render must bind position and normal vertex attributes");
assert.ok(observedGl._calls.matrix > 0, "render must upload camera and model matrices");
observedRenderer.render(renderScene);
assert.equal(observedGl._calls.bufferData, uploadsAfterLoad,
  "repeated frames must reuse uploaded board and model buffers");

observedGl._calls.modelMatrices.length = 0;
observedRenderer.render({
  pieces:renderScene.pieces,
  camera:renderScene.camera,
  selected:-1, targets:[], path:null,
  aiPose:{poses:{0:{row:4,col:6,height:0.3,orientation:2}}}
});
var animatedModel = observedGl._calls.modelMatrices[observedGl._calls.modelMatrices.length - 1];
assert.ok(Math.abs(animatedModel[12] - 1.5) < 1e-6 &&
  Math.abs(animatedModel[13] - 0.32) < 1e-6 &&
  Math.abs(animatedModel[14] - 0.5) < 1e-6,
  "AI animation poses must drive the rendered GLB instance before rule state commits");

var drawsBeforeBaseline = observedGl._calls.drawElements;
observedRenderer.render({
  pieces:[], camera:renderScene.camera, selected:-1, targets:[], aiPose:null, path:null
});
var baseFrameDraws = observedGl._calls.drawElements - drawsBeforeBaseline;
var drawsBeforeHighlightBaseline = observedGl._calls.drawElements;
observedRenderer.render({
  pieces:renderScene.pieces, camera:renderScene.camera, selected:-1,
  targets:[], aiPose:null, path:null
});
var highlightBaseline = observedGl._calls.drawElements - drawsBeforeHighlightBaseline;
var drawsBeforeHighlights = observedGl._calls.drawElements;
observedRenderer.render({
  pieces:renderScene.pieces, camera:renderScene.camera, selected:0,
  targets:[{r:6,c:4},{r:6,c:5}], aiPose:null, path:null
});
assert.equal(observedGl._calls.drawElements - drawsBeforeHighlights - highlightBaseline, 3,
  "one selected piece and two legal targets must add three WebGL highlight rings");
var drawsWithoutBeam = observedGl._calls.drawElements;
observedRenderer.render({
  pieces:[], camera:renderScene.camera, selected:-1, targets:[], aiPose:null,
  path:[{r:0,c:0},{r:0,c:1},{r:2,c:1}], beamProgress:1
});
var beamDraws = observedGl._calls.drawElements - drawsWithoutBeam - baseFrameDraws;
assert.equal(beamDraws, 4,
  "each valid laser segment must draw one glow layer and one bright core");
assert.deepEqual(observedGl._calls.depthMasks.slice(-4), [false,true,false,true],
  "each translucent glow must stop writing depth before its bright core is drawn");
var drawsBeforeHalfBeam = observedGl._calls.drawElements;
observedRenderer.render({
  pieces:[], camera:renderScene.camera, selected:-1, targets:[], aiPose:null,
  path:[{r:0,c:0},{r:0,c:1},{r:2,c:1}], beamProgress:0.5
});
assert.equal(observedGl._calls.drawElements - drawsBeforeHalfBeam - baseFrameDraws, 2,
  "halfway beam progress must draw only the first completed segment layers");
var drawsBeforeZeroBeam = observedGl._calls.drawElements;
observedRenderer.render({
  pieces:[], camera:renderScene.camera, selected:-1, targets:[], aiPose:null,
  path:[{r:0,c:0},{r:0,c:1},{r:2,c:1}], beamProgress:0
});
assert.equal(observedGl._calls.drawElements - drawsBeforeZeroBeam, baseFrameDraws,
  "zero beam progress must not reveal the future path");
var drawsBeforeInvalidBeam = observedGl._calls.drawElements;
observedRenderer.render({
  pieces:[], camera:renderScene.camera, selected:-1, targets:[], aiPose:null,
  path:[{r:0,c:0},null,{r:0,c:1}], beamProgress:1
});
assert.equal(observedGl._calls.drawElements - drawsBeforeInvalidBeam, baseFrameDraws,
  "malformed laser paths must not draw partial WebGL beam segments");
observedRenderer.dispose();
assert.ok(observedGl._calls.deletedBuffers > 0, "dispose must release GPU buffers");
assert.equal(observedGl._calls.deletedPrograms, 1, "dispose must release the shader program once");

var shaderFailGl = fakeGl({failShaderAt:2});
var shaderFailRenderer = WebGLRenderer.create({
  canvas:{getContext:function(){ return shaderFailGl; }},
  readAsset:function(){ throw new Error("assets must not load after shader failure"); }
});
var shaderResult = true;
shaderFailRenderer.load(function(ok){ shaderResult = ok; });
assert.equal(shaderResult, false, "shader compilation failure must disable WebGL");
assert.equal(shaderFailRenderer.status().mode, "fallback");
assert.match(shaderFailRenderer.status().reason, /test shader failure/);
assert.equal(shaderFailGl._calls.deletedShaders, 2,
  "a fragment shader failure must also release the compiled vertex shader");
assert.equal(shaderFailRenderer.render(renderScene), false,
  "a failed renderer must never issue partial scene draws");

var bufferFailGl = fakeGl({failBufferAt:3});
var bufferFailRenderer = WebGLRenderer.create({
  canvas:{getContext:function(){ return bufferFailGl; }},
  readAsset:function(){ throw new Error("assets must not load after buffer failure"); }
});
bufferFailRenderer.load(function(){});
assert.equal(bufferFailRenderer.status().mode, "fallback");
assert.equal(bufferFailGl._calls.deletedBuffers, 2,
  "partial GPU buffer allocation must release every buffer already created");

var assetFailGl = fakeGl();
var assetFailRenderer = WebGLRenderer.create({
  canvas:{width:640,height:480,getContext:function(){ return assetFailGl; }},
  readAsset:function(assetPath, done){ done(new Error("missing " + assetPath)); }
});
var assetResult = true;
assetFailRenderer.load(function(ok){ assetResult = ok; });
assert.equal(assetResult, false, "any missing GLB must disable the whole WebGL scene");
assert.equal(assetFailRenderer.status().mode, "fallback");
assert.equal(assetFailGl._calls.drawElements, 0,
  "asset failure must not leave a partially rendered model set");

var invalidMirrorGl = fakeGl();
var invalidMirrorRenderer = WebGLRenderer.create({
  canvas:{width:640,height:480,getContext:function(){ return invalidMirrorGl; }},
  readAsset:function(assetPath,done){
    var file=assetPath.slice(assetPath.lastIndexOf("/")+1);
    var data=modelArrayBuffer(file);
    if(file === "single_mirror_red.glb") data=replaceGlbText(data,"Mirror_Face","Mirror_Fail");
    done(null,data);
  }
});
invalidMirrorRenderer.load(function(){});
assert.equal(invalidMirrorRenderer.status().mode, "fallback",
  "invalid authored mirror surface metadata must disable the whole WebGL scene");

var lostGl = fakeGl();
lostGl.isContextLost = function(){ return true; };
var lostRenderer = WebGLRenderer.create({
  canvas:{width:640,height:480,getContext:function(){ return lostGl; }},
  readAsset:function(assetPath,done){
    var file=assetPath.slice(assetPath.lastIndexOf("/")+1);
    done(null,modelArrayBuffer(file));
  }
});
lostRenderer.load(function(){});
assert.equal(lostRenderer.render(renderScene), false,
  "a lost WebGL context must switch immediately to fallback rendering");
assert.equal(lostRenderer.status().mode, "fallback");

console.log("laser WebGL regression tests passed");
