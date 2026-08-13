"use strict";

var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");

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

console.log("laser WebGL regression tests passed");
