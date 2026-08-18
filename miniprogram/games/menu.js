/**
 * 总菜单模块
 * 展示小游戏卡片，点击进入对应游戏
 * 敬请期待的游戏以灰色卡片展示，不可点击
 */
"use strict";

module.exports = {
  create: function (ctx, W, H, onSelect) {
    // 游戏配置：available=可玩, upcoming=敬请期待
    var games = [
      { key: "laser",    title: "激光镭射象棋", desc: "策略对战，激光反射",     icon: "⚡", color: "#ff5a6e", colorLite: "#ff8a5a", available: true },
      { key: "pigmerge", title: "萌宠合成",     desc: "敬请期待",               icon: "🐾", color: "#3a3a4a", colorLite: "#4a4a5a", available: false }
    ];

    var T = 0; // 动画计时
    var cards = [];
    var pressedCard = null;

    // 计算卡片布局
    var cardW = W - 48;
    var cardH = 88;
    var gap = 16;
    var startY = H * 0.28;

    for (var i = 0; i < games.length; i++) {
      cards.push({
        x: 24,
        y: startY + i * (cardH + gap),
        w: cardW,
        h: cardH,
        game: games[i],
        appearDelay: i * 0.1,
        appearT: 0
      });
    }

    function hitCard(x, y) {
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        if (!c.game.available) continue;
        if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return c;
      }
      return null;
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    return {
      update: function (dt) {
        T += dt;
        for (var i = 0; i < cards.length; i++) {
          if (cards[i].appearT < 1) {
            cards[i].appearT = Math.min(1, cards[i].appearT + dt * 3);
          }
        }
      },

      render: function () {
        // 背景渐变
        var g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, "#1a1438");
        g.addColorStop(0.5, "#241a50");
        g.addColorStop(1, "#1a1438");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        // 浮动装饰圆
        for (var i = 0; i < 6; i++) {
          var cx = (W / 6) * i + Math.sin(T * 0.5 + i * 1.3) * 30;
          var cy = H * 0.08 + (i % 3) * H * 0.28 + Math.cos(T * 0.3 + i) * 20;
          var r = 40 + (i % 2) * 25;
          ctx.fillStyle = "rgba(255,255,255,0.025)";
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }

        // 标题
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#fff";
        ctx.font = "700 26px sans-serif";
        ctx.fillText("\u{1F3AE} 来桌游", W / 2, H * 0.11);

        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.font = "13px sans-serif";
        ctx.fillText("选择一款游戏开始", W / 2, H * 0.11 + 28);

        // 卡片
        for (var i = 0; i < cards.length; i++) {
          var c = cards[i];
          var ap = c.appearT;
          if (ap <= 0) continue;
          var ease = 1 - Math.pow(1 - ap, 3); // easeOutCubic
          var offsetY = (1 - ease) * 30;
          var alpha = ease;
          var isPressed = (pressedCard === c);
          var isAvailable = c.game.available;

          ctx.globalAlpha = alpha;

          // 卡片阴影
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          roundRect(c.x + 2, c.y + 5 + offsetY, c.w, c.h, 14);
          ctx.fill();

          // 卡片背景渐变
          var cg = ctx.createLinearGradient(c.x, c.y, c.x + c.w, c.y + c.h);
          cg.addColorStop(0, c.game.color);
          cg.addColorStop(1, c.game.colorLite);
          ctx.fillStyle = cg;
          var scale = isPressed ? 0.97 : 1;
          var sx = c.x + (c.w * (1 - scale)) / 2;
          var sy = c.y + offsetY + (c.h * (1 - scale)) / 2;
          roundRect(sx, sy, c.w * scale, c.h * scale, 14);
          ctx.fill();

          // 边框
          ctx.strokeStyle = "rgba(255,255,255,0.2)";
          ctx.lineWidth = 1;
          ctx.stroke();

          // 图标圆背景
          var iconR = 25;
          var iconX = c.x + 34;
          var iconY = c.y + c.h / 2 + offsetY;
          ctx.fillStyle = "rgba(255,255,255,0.22)";
          ctx.beginPath();
          ctx.arc(iconX, iconY, iconR, 0, Math.PI * 2);
          ctx.fill();

          // 图标 emoji
          ctx.font = "26px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(c.game.icon, iconX, iconY + 1);

          // 标题
          ctx.textAlign = "left";
          ctx.fillStyle = "#fff";
          ctx.font = "700 17px sans-serif";
          ctx.fillText(c.game.title, c.x + 72, c.y + 34 + offsetY);

          // 描述
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.font = "12px sans-serif";
          ctx.fillText(c.game.desc, c.x + 72, c.y + 56 + offsetY);

          if (isAvailable) {
            // 箭头
            ctx.fillStyle = "rgba(255,255,255,0.55)";
            ctx.font = "22px sans-serif";
            ctx.textAlign = "right";
            ctx.textBaseline = "middle";
            ctx.fillText("\u203A", c.x + c.w - 16, c.y + c.h / 2 + offsetY);
          } else {
            // 敬请期待徽章
            var badgeW = 64;
            var badgeH = 20;
            var badgeX = c.x + c.w - badgeW - 12;
            var badgeY = c.y + (c.h - badgeH) / 2 + offsetY;
            ctx.fillStyle = "rgba(255,255,255,0.15)";
            roundRect(badgeX, badgeY, badgeW, badgeH, 10);
            ctx.fill();
            ctx.fillStyle = "rgba(255,255,255,0.6)";
            ctx.font = "600 11px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("敬请期待", badgeX + badgeW / 2, badgeY + badgeH / 2 + 1);
          }

          ctx.globalAlpha = 1;
        }

        // 底部提示
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.font = "12px sans-serif";
        ctx.fillText("点击卡片开始游戏", W / 2, H - 28);
      },

      onTouchStart: function (e) {
        var pos = null;
        if (e && e.changedTouches && e.changedTouches.length > 0) {
          pos = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        } else if (e && e.touches && e.touches.length > 0) {
          pos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        if (pos) {
          pressedCard = hitCard(pos.x, pos.y);
        }
      },

      onTouchEnd: function (e) {
        var pos = null;
        if (e && e.changedTouches && e.changedTouches.length > 0) {
          pos = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        }
        if (pos) {
          var c = hitCard(pos.x, pos.y);
          if (c) {
            pressedCard = null;
            onSelect(c.game.key);
            return;
          }
        }
        pressedCard = null;
      },

      onTouchMove: function () {},

      exit: function () {}
    };
  }
};
