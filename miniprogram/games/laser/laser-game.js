"use strict";

// Stable public entry kept for the collection shell and existing tests.
// Internal modules live under game/, core/ and config/ so callers do not
// depend on implementation paths.
module.exports = require("./game/create-game.js");
