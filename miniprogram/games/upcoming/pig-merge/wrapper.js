/**
 * 萌宠合成 —— 游戏合集包装器
 * 将 Pig Merge Game 类适配为合集模块接口
 */
"use strict";

var Game = require("./main.js");

module.exports = {
  create: function (ctx, W, H, returnToMenu) {
    // Game 构造函数期望 (canvas, screenWidth, screenHeight)，内部调用 canvas.getContext('2d')
    // 我们传入一个伪 canvas 对象，使其返回共享的 ctx
    var fakeCanvas = { getContext: function () { return ctx; } };
    var game = new Game(fakeCanvas, W, H);

    return {
      update: function (dt) {
        game.update(dt);
      },
      render: function () {
        game.render();
      },
      onTouchStart: function (e) {
        game.onTouchStart(e);
      },
      onTouchMove: function (e) {
        game.onTouchMove(e);
      },
      onTouchEnd: function (e) {
        game.onTouchEnd(e);
      },
      exit: function () {
        // 清理物理世界和特效
        try {
          if (game.physics) game.physics.clear();
        } catch (e) {}
        try {
          if (game.effects) game.effects.clear();
        } catch (e) {}
        game.currentPig = null;
      }
    };
  }
};
