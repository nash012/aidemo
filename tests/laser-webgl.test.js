"use strict";

var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");
var GlbLoader = null;
try { GlbLoader = require("../games/laser/glb-loader.js"); } catch (e) {}

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

console.log("laser WebGL regression tests passed");
