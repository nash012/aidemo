// 跳一跳 —— 微信小游戏模块包装版
// 由 wechat-minigame/game.js 移植为可由游戏合集主入口加载的模块。
// 仅改造画布/触摸/主循环/定时器基础设施，游戏逻辑保持原样。

module.exports = {
  create: function (ctx, W, H, returnToMenu) {

    // ============ 超时追踪（便于退出时统一清理） ============
    var _timeouts = [];
    function _setTrackTimeout(fn, delay) {
      var id = setTimeout(function () {
        var idx = _timeouts.indexOf(id);
        if (idx >= 0) _timeouts.splice(idx, 1);
        fn();
      }, delay);
      _timeouts.push(id);
      return id;
    }

    // ============ 音效（wx.createWebAudioContext，基础库 2.19+，不可用则静音） ============
    var actx = null;
    function ac() {
      if (!actx) {
        try { if (wx.createWebAudioContext) actx = wx.createWebAudioContext(); } catch (e) {}
      }
      if (actx && actx.state === 'suspended') { try { actx.resume(); } catch (e) {} }
      return actx;
    }
    function tone(freq, dur, type, vol, delay) {
      var a = ac(); if (!a) return;
      var t = a.currentTime + (delay || 0);
      var o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol || 0.15, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(a.destination);
      o.start(t); o.stop(t + dur + 0.03);
    }
    function sweep(f1, f2, dur, type, vol) {
      var a = ac(); if (!a) return;
      var t = a.currentTime;
      var o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f1, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol || 0.15, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(a.destination);
      o.start(t); o.stop(t + dur + 0.03);
    }
    var sfx = {
      jump: function () { sweep(430, 170, 0.26, 'triangle', 0.12); },
      land: function () { tone(150, 0.13, 'sine', 0.18); },
      perfect: function () { tone(880, 0.09, 'triangle', 0.14); tone(1320, 0.13, 'triangle', 0.12, 0.07); },
      fail: function () { sweep(230, 70, 0.45, 'sawtooth', 0.12); }
    };

    // ============ 本地存档 ============
    var best = 0;
    try { var _v = wx.getStorageSync('jj_best'); if (_v) best = +_v; } catch (e) {}
    function saveBest() { try { wx.setStorageSync('jj_best', best); } catch (e) {} }

    // ============ 常量 ============
    var GROUND_RATIO = 0.80;
    var CHARGE_TIME = 1.4;
    var MAX_DIST = 340;
    var CHAR_W = 30, CHAR_H = 34;
    var PERFECT_R = 11;

    // ============ 游戏状态 ============
    var state = 'ready';           // ready | charging | jumping | falling | gameover
    var score = 0;
    var combo = 0;
    var power = 0;
    var cam = { x: 0 };
    var shake = 0;
    var T = 0;
    var platforms = [];
    var landIndex = 0;
    var char = { x: 0, feetY: 0, sx: 1, sy: 1, tsx: 1, tsy: 1, rot: 0 };
    var jump = null;
    var fall = { t: 0, y0: 0 };
    var particles = [];
    var floats = [];

    var rand = function (a, b) { return a + Math.random() * (b - a); };
    var groundY = function () { return H * GROUND_RATIO; };
    var FONT = function (w, s) { return w + ' ' + s + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'; };

    // ============ 平台生成 ============
    function makePlatform(prev) {
      if (!prev) return { x: 0, w: 130, h: 70, hue: 0 };
      var gap = rand(85, 230);
      return { x: prev.x + prev.w + gap, w: rand(58, 100), h: rand(48, 92), hue: prev.hue + 1 };
    }
    function nextPlatform() {
      platforms.push(makePlatform(platforms[platforms.length - 1]));
      while (platforms.length > 7 && landIndex > 2) { platforms.shift(); landIndex--; }
    }

    // ============ 重置 ============
    function reset() {
      platforms = [];
      platforms.push(makePlatform(null));
      platforms.push(makePlatform(platforms[0]));
      platforms.push(makePlatform(platforms[1]));
      landIndex = 0;
      var p = platforms[0];
      char.x = p.x + p.w / 2;
      char.feetY = groundY() - p.h;
      char.sx = char.tsx = 1; char.sy = char.tsy = 1; char.rot = 0;
      cam.x = char.x - W * 0.32;
      score = 0; combo = 0; power = 0; state = 'ready';
      particles = []; floats = []; jump = null; shake = 0;
    }

    // ============ 输入（触摸：按下蓄力，松开起跳） ============
    function onPress() {
      if (state === 'ready') { state = 'charging'; power = 0; ac(); }
      else if (state === 'gameover') reset();
    }
    function onRelease() {
      if (state === 'charging') doJump();
    }

    // ============ 跳跃 ============
    function doJump() {
      var dist = Math.max(power * MAX_DIST, 6);
      jump = {
        startX: char.x, dist: dist, arc: 70 + dist * 0.55,
        t: 0, dur: 0.32 + (dist / MAX_DIST) * 0.5, fromFeetY: char.feetY
      };
      state = 'jumping';
      char.tsx = 0.82; char.tsy = 1.2;
      sfx.jump();
    }

    // ============ 着陆判定 ============
    function land() {
      var lx = char.x;
      var cur = platforms[landIndex];
      // 蓄力不足：仍站在当前平台，不扣分，回到中心
      if (lx >= cur.x && lx <= cur.x + cur.w) {
        char.x = cur.x + cur.w / 2;
        char.feetY = groundY() - cur.h;
        char.tsx = 1.2; char.tsy = 0.8;
        sfx.land();
        state = 'ready';
        _setTrackTimeout(function () { if (state === 'ready') { char.tsx = 1; char.tsy = 1; } }, 120);
        return;
      }
      var next = platforms[landIndex + 1];
      if (next && lx >= next.x && lx <= next.x + next.w) {
        landIndex++;
        char.feetY = groundY() - next.h;
        var center = next.x + next.w / 2;
        var perfect = Math.abs(lx - center) <= PERFECT_R;
        char.tsx = 1.35; char.tsy = 0.68;
        var gain = 1;
        if (perfect) {
          combo++; gain = 2;
          shake = 11; sfx.perfect();
          addFloat(char.x, char.feetY - 54, combo > 1 ? '完美 x' + combo + '  +2' : '完美! +2', '#ffd166');
          burst(char.x, char.feetY, '#ffd166', 18);
        } else {
          combo = 0; shake = 4; sfx.land();
          burst(char.x, char.feetY, '#ffffff', 8);
        }
        score += gain;
        if (score > best) { best = score; saveBest(); }
        nextPlatform();
        state = 'landed';
        _setTrackTimeout(function () { if (state === 'landed') { state = 'ready'; char.tsx = 1; char.tsy = 1; } }, 150);
      } else {
        // 落空：坠落
        state = 'falling';
        fall.t = 0; fall.y0 = char.feetY;
        char.tsx = 0.8; char.tsy = 1.2;
        sfx.fail();
      }
    }

    // ============ 粒子 / 浮字 ============
    function burst(x, y, color, n) {
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, s = rand(70, 240);
        particles.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 90, life: rand(0.4, 0.85), color: color, size: rand(2, 5) });
      }
    }
    function addFloat(x, y, text, color) {
      floats.push({ x: x, y: y, text: text, color: color, life: 1, vy: -38 });
    }

    // ============ 更新 ============
    function update(dt) {
      T += dt;
      char.sx += (char.tsx - char.sx) * Math.min(1, dt * 14);
      char.sy += (char.tsy - char.sy) * Math.min(1, dt * 14);

      if (state === 'charging') {
        power = Math.min(1, power + dt / CHARGE_TIME);
        char.tsx = 1 + power * 0.32; char.tsy = 1 - power * 0.4;
      }
      if (state === 'jumping') {
        jump.t += dt / jump.dur;
        var t = jump.t;
        char.x = jump.startX + jump.dist * t;
        char.feetY = jump.fromFeetY - jump.arc * 4 * t * (1 - t);
        char.rot = Math.sin(t * Math.PI) * 0.45;
        if (t >= 1) { char.rot = 0; land(); }
      } else if (state === 'falling') {
        fall.t += dt;
        char.feetY = fall.y0 + 1300 * fall.t * fall.t;
        char.rot += dt * 9;
        if (fall.t > 0.9) state = 'gameover';
      } else {
        char.rot *= 0.8;
      }

      var targetCam = char.x - W * 0.32;
      cam.x += (targetCam - cam.x) * Math.min(1, dt * 8);
      shake *= Math.pow(0.0015, dt);

      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.vy += 950 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
      }
      for (var j = floats.length - 1; j >= 0; j--) {
        var f = floats[j];
        f.y += f.vy * dt; f.life -= dt;
        if (f.life <= 0) floats.splice(j, 1);
      }
    }

    // ============ 圆角矩形路径 ============
    function rr(x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    // ============ 渲染 ============
    function render() {
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      if (shake > 0.3) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      drawBackground();
      drawGround();
      drawPlatforms();
      drawCharShadow();
      drawCharacter();
      drawParticles();
      drawPower();
      ctx.restore();
      drawFloats();
      drawUI();
      if (state === 'gameover') drawGameOver();
    }

    function drawBackground() {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#3a2c6b');
      g.addColorStop(0.5, '#6d5bb0');
      g.addColorStop(1, '#cdb8ec');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,235,190,0.45)';
      ctx.beginPath(); ctx.arc(W * 0.82, H * 0.2, 62, 0, Math.PI * 2); ctx.fill();
      for (var i = 0; i < 5; i++) {
        var span = W + 260;
        var px = (i * 250 - cam.x * 0.22) % span; if (px < 0) px += span;
        px -= 130;
        var py = H * 0.16 + (i % 3) * 46;
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath(); ctx.arc(px, py, 50 + (i % 2) * 22, 0, Math.PI * 2); ctx.fill();
      }
    }

    function drawGround() {
      var gy = groundY();
      ctx.fillStyle = '#241a44';
      ctx.fillRect(0, gy, W, H - gy);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, gy, W, 3);
    }

    function drawPlatforms() {
      var gy = groundY();
      for (var i = 0; i < platforms.length; i++) {
        var p = platforms[i];
        var sx = p.x - cam.x;
        if (sx + p.w < -30 || sx > W + 30) continue;
        var top = gy - p.h;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        rr(sx + 4, top + 7, p.w, p.h, 12); ctx.fill();
        ctx.fillStyle = (p.hue % 2 === 0) ? '#6d5bd0' : '#8270e0';
        rr(sx, top, p.w, p.h, 12); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        rr(sx, top, p.w, 11, 12); ctx.fill();
        if (i === landIndex + 1) {
          ctx.fillStyle = 'rgba(255,209,102,0.5)';
          ctx.beginPath();
          ctx.arc(sx + p.w / 2, top + 4, 2.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    function drawCharShadow() {
      var cx = char.x - cam.x;
      var gy = groundY();
      var air = Math.max(0, (groundY() - (char.feetY + 30)) / 200);
      var sw = (CHAR_W * 0.5) * (1 - air * 0.6);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.22 * (1 - air * 0.5)) + ')';
      ctx.beginPath();
      ctx.ellipse(cx, gy + 2, Math.max(4, sw), 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawCharacter() {
      var cx = char.x - cam.x;
      var w = CHAR_W * char.sx, h = CHAR_H * char.sy;
      ctx.save();
      ctx.translate(cx, char.feetY - h / 2);
      ctx.rotate(char.rot);
      ctx.fillStyle = '#ffd166';
      rr(-w / 2, -h / 2, w, h, 8); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      rr(-w / 2 + 3, -h / 2 + 3, w * 0.42, h * 0.3, 4); ctx.fill();
      ctx.fillStyle = '#3a2c6b';
      var ey = -h * 0.08;
      ctx.beginPath();
      ctx.arc(-w * 0.17, ey, 2.6, 0, Math.PI * 2);
      ctx.arc(w * 0.17, ey, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function drawPower() {
      if (state !== 'charging') return;
      var cx = char.x - cam.x;
      var bh = 72, bw = 8;
      var bx = cx - 30, by = char.feetY - bh - 12;
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      rr(bx, by, bw, bh, 4); ctx.fill();
      var fh = bh * power;
      ctx.fillStyle = power < 0.5 ? '#7bed9f' : (power < 0.8 ? '#ffd166' : '#ff6b6b');
      rr(bx, by + bh - fh, bw, fh, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = FONT('600', 12); ctx.textAlign = 'center';
      ctx.fillText(Math.round(power * 100) + '%', bx + bw / 2, by - 6);
    }

    function drawParticles() {
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x - cam.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function drawFloats() {
      ctx.textAlign = 'center';
      for (var i = 0; i < floats.length; i++) {
        var f = floats[i];
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
        ctx.fillStyle = f.color;
        ctx.font = FONT('700', 19);
        ctx.fillText(f.text, f.x - cam.x, f.y);
      }
      ctx.globalAlpha = 1;
    }

    function drawUI() {
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.96)';
      ctx.font = FONT('700', 46);
      ctx.fillText(score, 26, 58);
      ctx.font = FONT('500', 14);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('最高 ' + best, 26, 80);

      if (state === 'ready' && score === 0) {
        var a = 0.55 + 0.35 * Math.sin(T * 3);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#fff';
        ctx.font = FONT('600', 17);
        ctx.textAlign = 'center';
        ctx.fillText('按住屏幕蓄力，松开跳跃', W / 2, H * 0.42);
        ctx.font = FONT('400', 13);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText('落在平台中心可触发完美 +2', W / 2, H * 0.42 + 24);
        ctx.globalAlpha = 1;
      }
    }

    function drawGameOver() {
      ctx.fillStyle = 'rgba(26,18,45,0.62)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.font = FONT('700', 30);
      ctx.fillText('游戏结束', W / 2, H / 2 - 30);
      ctx.font = FONT('600', 20);
      ctx.fillStyle = '#ffd166';
      ctx.fillText('本局 ' + score + '   最高 ' + best, W / 2, H / 2 + 4);
      ctx.font = FONT('500', 15);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      var a = 0.6 + 0.4 * Math.sin(T * 4);
      ctx.globalAlpha = a;
      ctx.fillText('点击屏幕重新开始', W / 2, H / 2 + 44);
      ctx.globalAlpha = 1;
    }

    // ============ 初始化 ============
    reset();

    // ============ 模块接口 ============
    return {
      update: function (dt) { update(dt); },
      render: function () { render(); },
      onTouchStart: function (e) { onPress(); },
      onTouchMove: function (e) { /* 跳一跳不使用移动事件 */ },
      onTouchEnd: function (e) { onRelease(); },
      exit: function () {
        for (var i = 0; i < _timeouts.length; i++) clearTimeout(_timeouts[i]);
        _timeouts = [];
      }
    };
  }
};
