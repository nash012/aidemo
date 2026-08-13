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

var doubleMirror = GlbLoader.parseGlb(modelArrayBuffer("double_mirror_blue.glb"));
assert.deepEqual(GlbLoader.mirrorSurfaces(doubleMirror), [
  "double_mirror_blue_Mirror_Front",
  "double_mirror_blue_Mirror_Back"
], "double mirror must expose its two authored mirror faces");

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
  for(var i=1;i<4;i++) assert.ok(Math.abs((angles[i]-angles[i-1]) - Math.PI/2) < 1e-9,
    type + " orientations must rotate by exactly 90 degrees");
});
assert.equal(WebGLRenderer.validateMirrorDirections(), true,
  "authored mirror normals must agree with all existing reflection directions");

function fakeGl(){
  var calls = {bufferData:0, drawElements:0, attrib:0, matrix:0, deletedBuffers:0, deletedPrograms:0};
  var gl = {
    _calls:calls,
    VERTEX_SHADER:35633, FRAGMENT_SHADER:35632, COMPILE_STATUS:35713, LINK_STATUS:35714,
    ARRAY_BUFFER:34962, ELEMENT_ARRAY_BUFFER:34963, STATIC_DRAW:35044,
    FLOAT:5126, UNSIGNED_SHORT:5123, TRIANGLES:4,
    DEPTH_TEST:2929, BLEND:3042, SRC_ALPHA:770, ONE_MINUS_SRC_ALPHA:771,
    COLOR_BUFFER_BIT:16384, DEPTH_BUFFER_BIT:256,
    createShader:function(){ return {}; }, shaderSource:function(){}, compileShader:function(){},
    getShaderParameter:function(){ return true; }, getShaderInfoLog:function(){ return ""; },
    deleteShader:function(){}, createProgram:function(){ return {}; }, attachShader:function(){},
    linkProgram:function(){}, getProgramParameter:function(){ return true; },
    getProgramInfoLog:function(){ return ""; }, enable:function(){}, blendFunc:function(){},
    createBuffer:function(){ return {}; }, bindBuffer:function(){},
    bufferData:function(){ calls.bufferData++; }, deleteBuffer:function(){ calls.deletedBuffers++; },
    deleteProgram:function(){ calls.deletedPrograms++; }, viewport:function(){}, clearColor:function(){},
    clear:function(){}, useProgram:function(){}, getAttribLocation:function(_,name){ return name === "aPosition" ? 0 : 1; },
    getUniformLocation:function(_,name){ return {name:name}; }, enableVertexAttribArray:function(){},
    vertexAttribPointer:function(){ calls.attrib++; }, uniformMatrix4fv:function(){ calls.matrix++; },
    uniform4fv:function(){}, drawElements:function(){ calls.drawElements++; }
  };
  return gl;
}

var observedGl = fakeGl();
var observedCanvas = {width:640, height:480, getContext:function(){ return observedGl; }};
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
observedRenderer.dispose();
assert.ok(observedGl._calls.deletedBuffers > 0, "dispose must release GPU buffers");
assert.equal(observedGl._calls.deletedPrograms, 1, "dispose must release the shader program once");

var shaderFailGl = fakeGl();
shaderFailGl.getShaderParameter = function(){ return false; };
shaderFailGl.getShaderInfoLog = function(){ return "test shader failure"; };
var shaderFailRenderer = WebGLRenderer.create({
  canvas:{getContext:function(){ return shaderFailGl; }},
  readAsset:function(){ throw new Error("assets must not load after shader failure"); }
});
var shaderResult = true;
shaderFailRenderer.load(function(ok){ shaderResult = ok; });
assert.equal(shaderResult, false, "shader compilation failure must disable WebGL");
assert.equal(shaderFailRenderer.status().mode, "fallback");
assert.match(shaderFailRenderer.status().reason, /test shader failure/);
assert.equal(shaderFailRenderer.render(renderScene), false,
  "a failed renderer must never issue partial scene draws");

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

console.log("laser WebGL regression tests passed");
