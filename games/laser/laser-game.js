// ============================================================
// 激光镭射象棋 Laser Chess —— 3D版
// 游戏合集模块包装版，3D透视渲染
// 棋盘 10×8，每方13枚棋子，5种官方阵型
// 手指拖动调整视角，游戏居中，安全区域适配
// ============================================================
var WebGLRenderer = require("./webgl-renderer.js");

module.exports = {
  create: function(ctx, W, H, returnToMenu, platform) {
    "use strict";

    /* -------------------- 屏幕别名 -------------------- */
    var SW = W, SH = H;

    /* -------------------- 定时器追踪 -------------------- */
    var _timeouts = [];
    function _setTrackTimeout(fn, delay) {
      var id = setTimeout(function() {
        var idx = _timeouts.indexOf(id);
        if (idx >= 0) _timeouts.splice(idx, 1);
        fn();
      }, delay);
      _timeouts.push(id);
      return id;
    }

    /* -------------------- 安全区域与布局 -------------------- */
    var SAFE_TOP = 52;
    var SAFE_BOT = 36;
    var TOPBAR_H = 62;
    var BTN_H = 46;
    var BTN_GAP = 8;
    var STATUS_H = 34;
    var btnAreaH = BTN_H + 12;
    var boardAreaTop = SAFE_TOP + TOPBAR_H;
    var boardAreaBot = SH - SAFE_BOT - btnAreaH - STATUS_H;

    /* -------------------- 常量与方向 -------------------- */
    var COLS = 10, ROWS = 8;
    var UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
    var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
    var DIRS8 = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    var LASER = "laser", KING = "king", SHIELD = "shield", MIRROR = "mirror", SWITCH = "switch";
    var PIECE_VAL = { king:10000, shield:3, switch:4, mirror:2, laser:0 };
    var AI_LEVELS = {
      easy:   {attack:1.05, defense:1.10, guard:1.15, reply:0,    advance:0.55, initiative:1.10, passive:0.24, candidates:24, variety:3.0,  depth:1},
      normal: {attack:2.35, defense:1.00, guard:0.90, reply:0.65, advance:0.90, initiative:1.60, passive:0.32, candidates:40, variety:1.0,  depth:2},
      hard:   {attack:2.15, defense:1.20, guard:1.10, reply:1.0,  advance:1.10, initiative:2.00, passive:0.38, candidates:40, variety:0.25, depth:3}
    };
    // The authored GLB's visible mirror face points along its local +X,+Z
    // normal. A ray can hit that face only while travelling against that
    // outward normal; the opposite two approaches hit the dark back plate.
    var MIRROR_MAP = [ {0:1,3:2}, {0:3,1:2}, {1:0,2:3}, {2:1,3:0} ];
    var SW_SLASH = {1:0,0:1,3:2,2:3};
    var SW_BACK  = {1:2,2:1,3:0,0:3};
    var LASER_DIRS = {0:[LEFT,UP], 1:[RIGHT,DOWN]};

    /* -------------------- 3D 投影系统 -------------------- */
    // pitch=0 水平直视，pitch=π/2 正上方俯视
    // 0.95 ≈ 55°，匹配桌游图片的斜俯视角度
    // yaw=0 正对棋盘，无偏转
    var DEFAULT_YAW = 0;
    var DEFAULT_PITCH = 0.95;
    var SETUP_PITCH = 1.08;
    var cam = {
      yaw: DEFAULT_YAW,
      pitch: DEFAULT_PITCH,
      dist: 15,
      focal: 0,
      cx: SW / 2,
      cy: (boardAreaTop + boardAreaBot) / 2
    };
    cam.focal = Math.min(SW * 0.72, (boardAreaBot - boardAreaTop) * 1.18) * cam.dist / 10;

    var camAnim = null;
    var pieceDrawPose = null;

    function project3D(x, y, z) {
      if(pieceDrawPose){
        var pdx = x - pieceDrawPose.x, pdz = z - pieceDrawPose.z;
        var pcos = Math.cos(pieceDrawPose.angle), psin = Math.sin(pieceDrawPose.angle);
        x = pieceDrawPose.x + pdx * pcos - pdz * psin;
        z = pieceDrawPose.z + pdx * psin + pdz * pcos;
        y += pieceDrawPose.height;
      }
      z = -z; // 翻转z轴，使row 7（红方）在近端（屏幕底部），row 0（蓝方）在远端（屏幕顶部）
      var cosY = Math.cos(cam.yaw), sinY = Math.sin(cam.yaw);
      var rx = x * cosY - z * sinY;
      var rz = x * sinY + z * cosY;
      var ry = y;
      var cosP = Math.cos(cam.pitch), sinP = Math.sin(cam.pitch);
      // 修正pitch旋转方向：正pitch=俯视，远端在上方，近端在下方
      var ry2 = ry * cosP + rz * sinP;
      var rz2 = -ry * sinP + rz * cosP;
      rz2 += cam.dist;
      if (rz2 < 0.1) rz2 = 0.1;
      var s = cam.focal / rz2;
      return { x: rx * s + cam.cx, y: -ry2 * s + cam.cy, z: rz2, s: s };
    }

    function darkenColor(hex, factor) {
      var r = parseInt(hex.substr(1,2), 16);
      var g = parseInt(hex.substr(3,2), 16);
      var b = parseInt(hex.substr(5,2), 16);
      r = Math.max(0, Math.floor(r * factor));
      g = Math.max(0, Math.floor(g * factor));
      b = Math.max(0, Math.floor(b * factor));
      return "rgb(" + r + "," + g + "," + b + ")";
    }

    function easeInOut(t) {
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function pieceHeight(type) {
      return { king:0.90, laser:0.60, shield:0.65, mirror:0.70, switch:0.65 }[type] || 0.6;
    }

    /* -------------------- 游戏逻辑（与2D版完全一致） -------------------- */
    function laserHit(p, inDir){
      try {
        var o = p.orientation, t = p.type;
        if(o===undefined||o===null||o<0||o>3) return "block";
        if(inDir===undefined||inDir===null||inDir<0||inDir>3) return "block";
        if(t===KING) return "eliminate";
        if(t===LASER) return "block";
        if(t===SHIELD) return inDir===((o+2)%4) ? "block" : "eliminate";
        if(t===MIRROR){ var r=MIRROR_MAP[o]?MIRROR_MAP[o][inDir]:undefined; return r!==undefined?r:"eliminate"; }
        if(t===SWITCH){ var tbl=(o%2===0)?SW_SLASH:SW_BACK; var r2=tbl[inDir]; return r2!==undefined?r2:"block"; }
        return "block";
      } catch(e) { return "block"; }
    }
    function pieceAt(pieces, r, c){
      for(var i=0;i<pieces.length;i++){ if(pieces[i].alive && pieces[i].row===r && pieces[i].col===c) return pieces[i]; }
      return null;
    }
    function getLaser(pieces, player){
      for(var i=0;i<pieces.length;i++){ if(pieces[i].alive && pieces[i].owner===player && pieces[i].type===LASER) return pieces[i]; }
      return null;
    }
    function simulateLaser(pieces, laser){
      var dir = laser.orientation;
      var r = laser.row + DY[dir], c = laser.col + DX[dir];
      var path = [{r:laser.row, c:laser.col}];
      var eliminated = null;
      var seen = {};
      var steps = 0;
      while(r>=0 && r<ROWS && c>=0 && c<COLS && steps<200){
        steps++;
        var key = r+","+c+","+dir;
        if(seen[key]) break;
        seen[key] = 1;
        var p = pieceAt(pieces, r, c);
        path.push({r:r, c:c});
        if(p){
          var res = laserHit(p, dir);
          if(res==="eliminate"){ eliminated = p; break; }
          if(res==="block") break;
          if(typeof res==="number"){ dir = res; }
          else break;
        }
        r += DY[dir]; c += DX[dir];
      }
      return { path: path, eliminated: eliminated };
    }
    function generateActions(pieces, player, opts){
      opts = opts || {};
      var acts = [];
      for(var i=0;i<pieces.length;i++){
        var p = pieces[i];
        if(p.owner!==player || !p.alive) continue;
        if(p.type===LASER){
          var dirs = LASER_DIRS[player];
          var newDir = p.orientation===dirs[0] ? dirs[1] : dirs[0];
          acts.push({pi:i, kind:"laserRot", dir:newDir});
          continue;
        }
        for(var j=0;j<DIRS8.length;j++){
          var d = DIRS8[j];
          var nr=p.row+d[0], nc=p.col+d[1];
          if(nr<0||nr>=ROWS||nc<0||nc>=COLS) continue;
          if(!isZoneAllowed(nr, nc, p.owner)) continue; // 区域限制
          if(!pieceAt(pieces, nr, nc)) acts.push({pi:i, kind:"move", r:nr, c:nc});
        }
        acts.push({pi:i, kind:"rot", d:1});
        acts.push({pi:i, kind:"rot", d:3});
        if(p.type===SWITCH && !opts.noSwap){
          for(var k=0;k<DIRS8.length;k++){
            var d2 = DIRS8[k];
            var nr2=p.row+d2[0], nc2=p.col+d2[1];
            if(nr2<0||nr2>=ROWS||nc2<0||nc2>=COLS) continue;
            var t = pieceAt(pieces, nr2, nc2);
            if(t && (t.type===SHIELD || t.type===MIRROR)){
              if(isZoneAllowed(nr2, nc2, p.owner) && isZoneAllowed(p.row, p.col, t.owner))
                acts.push({pi:i, kind:"swap", ti:pieces.indexOf(t)});
            }
          }
        }
      }
      return acts;
    }
    function applyAction(pieces, act){
      if(act.kind === "skip") return pieces.map(function(p){ return Object.assign({}, p); });
      var np = pieces.map(function(p){ return Object.assign({}, p); });
      var p = np[act.pi];
      if(act.kind==="rot") p.orientation = (p.orientation + act.d) % 4;
      else if(act.kind==="laserRot") p.orientation = act.dir;
      else if(act.kind==="move"){ p.row = act.r; p.col = act.c; }
      else if(act.kind==="swap"){ var t=np[act.ti]; var tr=t.row,tc=t.col; t.row=p.row;t.col=p.col; p.row=tr;p.col=tc; }
      return np;
    }
    function resolveTurn(pieces, player, act){
      var after = applyAction(pieces, act);
      var laser = getLaser(after, player);
      var path = [], eliminated = null;
      if(laser){
        var sim = simulateLaser(after, laser);
        path = sim.path; eliminated = sim.eliminated;
        if(eliminated) eliminated.alive = false;
      }
      return { np:after, path:path, eliminated:eliminated };
    }

    /* -------------------- AI -------------------- */
    function allActions(pieces, player){
      var acts = generateActions(pieces, player);
      acts.push({kind:"skip"});
      return acts;
    }
    function findKing(pieces, player){
      for(var i=0;i<pieces.length;i++){
        var p = pieces[i];
        if(p.alive && p.owner===player && p.type===KING) return p;
      }
      return null;
    }
    function laserPressure(pieces, player){
      var laser = getLaser(pieces, player);
      var king = findKing(pieces, 1-player);
      if(!laser || !king) return 0;
      var sim = simulateLaser(pieces, laser);
      var minDist = Infinity, turns = 0, enemyHalf = 0;
      var prevDir = -1;
      for(var i=0;i<sim.path.length;i++){
        var pt = sim.path[i];
        var dist = Math.abs(pt.r-king.row) + Math.abs(pt.c-king.col);
        if(dist < minDist) minDist = dist;
        if((player===1 && pt.r>=ROWS/2) || (player===0 && pt.r<ROWS/2)) enemyHalf++;
        if(i>0){
          var prev = sim.path[i-1];
          var dir = pt.r>prev.r ? DOWN : pt.r<prev.r ? UP : pt.c>prev.c ? RIGHT : LEFT;
          if(prevDir>=0 && dir!==prevDir) turns++;
          prevDir = dir;
        }
      }
      return Math.max(0, 12-minDist*3) + Math.min(sim.path.length, 14)*0.35 + turns*2 + enemyHalf*0.3;
    }

    function attackingPresence(pieces, player){
      var king=findKing(pieces,1-player);
      if(!king) return 30;
      var score=0;
      for(var i=0;i<pieces.length;i++){
        var p=pieces[i];
        if(!p.alive || p.owner!==player || p.type===KING || p.type===LASER) continue;
        var dist=Math.abs(p.row-king.row)+Math.abs(p.col-king.col);
        var tactical=p.type===SWITCH ? 1.2 : p.type===MIRROR ? 1.0 : 0.7;
        score+=Math.max(0,10-dist)*0.18*tactical;
        if((player===1 && p.row>=ROWS/2) || (player===0 && p.row<ROWS/2)) score+=0.55*tactical;
      }
      return score;
    }

    function initiativeBonus(before, after, player, action, cfg, passiveTurns){
      var beforeThreat=laserPressure(before,player)+attackingPresence(before,player)*0.35;
      var afterThreat=laserPressure(after,player)+attackingPresence(after,player)*0.35;
      var scale=(cfg.initiative||0)*(1+Math.min(3,passiveTurns||0)*0.45);
      var bonus=(afterThreat-beforeThreat)*scale;
      if(action && action.kind==="skip") bonus-=scale*(1.8+Math.min(3,passiveTurns||0));
      return bonus;
    }

    function passiveHumanTurn(before, after, player){
      if(!Array.isArray(before) || !Array.isArray(after)) return false;
      var opp=1-player, beforeOpp=0, afterOpp=0;
      for(var i=0;i<before.length;i++) if(before[i].alive && before[i].owner===opp) beforeOpp++;
      for(var j=0;j<after.length;j++) if(after[j].alive && after[j].owner===opp) afterOpp++;
      if(afterOpp<beforeOpp) return false;
      var beforeThreat=laserPressure(before,player)+attackingPresence(before,player)*0.35;
      var afterThreat=laserPressure(after,player)+attackingPresence(after,player)*0.35;
      return afterThreat<beforeThreat+0.75;
    }

    function evaluatePosition(pieces, player, difficulty, aggressionPlayer, passiveTurns){
      var cfg = AI_LEVELS[difficulty] || AI_LEVELS.normal;
      var opp = 1 - player;
      var score = 0;
      for(var i=0;i<pieces.length;i++){
        var p = pieces[i];
        if(!p.alive) continue;
        var v = PIECE_VAL[p.type] || 0;
        score += (p.owner===player ? v : -v);
      }
      var myKing = findKing(pieces, player);
      var passive=Math.min(3,Math.max(0,passiveTurns||0));
      var myBoost=player===aggressionPlayer ? 1+passive*cfg.passive : 1;
      var oppBoost=opp===aggressionPlayer ? 1+passive*cfg.passive : 1;
      score += laserPressure(pieces, player) * cfg.attack * myBoost;
      score -= laserPressure(pieces, opp) * cfg.defense * oppBoost;
      score += attackingPresence(pieces,player) * cfg.advance * myBoost;
      score -= attackingPresence(pieces,opp) * cfg.advance * 0.55 * oppBoost;
      if(myKing){
        var guards = 0;
        for(var j=0;j<pieces.length;j++){
          var pp = pieces[j];
          if(!pp.alive || pp.owner!==player || pp.type===KING || pp.type===LASER) continue;
          if(Math.abs(pp.row-myKing.row)+Math.abs(pp.col-myKing.col)<=2) guards++;
        }
        score += guards * cfg.guard;
      }
      return score;
    }
    /* -------------------- Alpha-Beta 搜索 -------------------- */
    var AB_CHILD_LIMIT = 30; // 非根节点候选上限（控制搜索复杂度）

    function alphaBeta(pieces, depth, alpha, beta, player, difficulty, aggressionPlayer, passiveTurns){
      var opp = 1 - player;
      // 终局检测
      var myKing = findKing(pieces, player);
      var oppKing = findKing(pieces, opp);
      if(!myKing) return -100000 - depth;
      if(!oppKing) return 100000 + depth;
      if(depth === 0){
        return evaluatePosition(pieces, player, difficulty, aggressionPlayer, passiveTurns);
      }
      var acts = allActions(pieces, player);
      // 走法排序：快速评估用于提升剪枝效率
      var scored = [];
      for(var i=0;i<acts.length;i++){
        var a = acts[i];
        var res = resolveTurn(pieces, player, a);
        var s, suicide = false, kingKill = false;
        if(res.eliminated && res.eliminated.type === KING){
          if(res.eliminated.owner === player){
            s = -100000 - depth; suicide = true;
          } else {
            s = 100000 + depth; kingKill = true;
          }
        } else {
          s = evaluatePosition(res.np, player, difficulty, aggressionPlayer, passiveTurns);
          if(res.eliminated){
            s += (res.eliminated.owner === player ? -PIECE_VAL[res.eliminated.type] : PIECE_VAL[res.eliminated.type]) * 4;
          }
        }
        scored.push({res:res, s:s, suicide:suicide, kingKill:kingKill});
      }
      scored.sort(function(x,y){ return y.s - x.s; });
      var limit = Math.min(scored.length, AB_CHILD_LIMIT);
      var best = -Infinity;
      for(var j=0;j<limit;j++){
        var c = scored[j];
        if(c.suicide) continue;
        var val;
        if(c.kingKill){
          val = 100000 + depth;
        } else {
          val = -alphaBeta(c.res.np, depth - 1, -beta, -alpha, opp, difficulty, aggressionPlayer, passiveTurns);
        }
        if(val > best) best = val;
        if(val > alpha) alpha = val;
        if(alpha >= beta) break;
      }
      if(best === -Infinity){
        best = evaluatePosition(pieces, player, difficulty, aggressionPlayer, passiveTurns);
      }
      return best;
    }

    function aiChoose(pieces, aiPlayer, difficulty, passiveTurns){
      difficulty = AI_LEVELS[difficulty] ? difficulty : "normal";
      var cfg = AI_LEVELS[difficulty];
      var opp = 1 - aiPlayer;
      passiveTurns=Math.min(3,Math.max(0,passiveTurns||0));
      // easy: 保持原有 1-ply 随机逻辑
      if(difficulty === "easy"){
        var acts0 = allActions(pieces, aiPlayer);
        var scored0 = acts0.map(function(a){
          var s = 0, win = false, suicide = false;
          var res = resolveTurn(pieces, aiPlayer, a);
          if(res.eliminated){
            var e = res.eliminated;
            if(e.type===KING){
              if(e.owner===aiPlayer){ s=-100000; suicide=true; }
              else { s=100000; win=true; }
            } else {
              s += (e.owner===aiPlayer ? -PIECE_VAL[e.type] : PIECE_VAL[e.type]) * 4;
            }
          }
          if(!win && !suicide){
            s += evaluatePosition(res.np, aiPlayer, difficulty, aiPlayer, passiveTurns);
            s += initiativeBonus(pieces,res.np,aiPlayer,a,cfg,passiveTurns);
          }
          return { a:a, s:s, win:win, suicide:suicide };
        });
        var wins0 = scored0.filter(function(x){ return x.win; });
        if(wins0.length) return wins0[Math.floor(Math.random()*wins0.length)].a;
        var safe0 = scored0.filter(function(x){ return !x.suicide; });
        var pool0 = safe0.length ? safe0 : scored0;
        pool0.sort(function(x,y){ return y.s - x.s; });
        var top0 = pool0.slice(0, cfg.candidates);
        var bestS0 = top0[0].s;
        var eq0 = top0.filter(function(x){ return x.s >= bestS0 - cfg.variety; });
        return eq0[Math.floor(Math.random()*eq0.length)].a;
      }
      // normal/hard: Alpha-Beta 搜索（depth=2/3）
      var depth = cfg.depth;
      var acts = allActions(pieces, aiPlayer);
      // 根节点走法排序
      var scored = [];
      for(var i=0;i<acts.length;i++){
        var a = acts[i];
        var res = resolveTurn(pieces, aiPlayer, a);
        var s, suicide = false, kingKill = false;
        if(res.eliminated && res.eliminated.type === KING){
          if(res.eliminated.owner === aiPlayer){
            s = -100000 - depth; suicide = true;
          } else {
            s = 100000 + depth; kingKill = true;
          }
        } else {
          s = evaluatePosition(res.np, aiPlayer, difficulty, aiPlayer, passiveTurns);
          s += initiativeBonus(pieces,res.np,aiPlayer,a,cfg,passiveTurns);
          if(res.eliminated){
            s += (res.eliminated.owner === aiPlayer ? -PIECE_VAL[res.eliminated.type] : PIECE_VAL[res.eliminated.type]) * 4;
          }
        }
        scored.push({a:a, s:s, res:res, suicide:suicide, kingKill:kingKill});
      }
      scored.sort(function(x,y){ return y.s - x.s; });
      var limit = Math.min(scored.length, cfg.candidates);
      var results = [];
      var alpha = -Infinity, beta = Infinity;
      for(var j=0;j<limit;j++){
        var c = scored[j];
        if(c.suicide) continue;
        var val;
        if(c.kingKill){
          val = 100000 + depth;
        } else if(depth > 1){
          val = -alphaBeta(c.res.np, depth - 1, -beta, -alpha, opp, difficulty, aiPlayer, passiveTurns);
        } else {
          val = c.s;
        }
        results.push({a:c.a, s:val});
        if(val > alpha) alpha = val;
      }
      if(!results.length) return {kind:"skip"};
      results.sort(function(x,y){ return y.s - x.s; });
      var bestS = results[0].s;
      var eq = results.filter(function(x){ return x.s >= bestS - cfg.variety; });
      return eq[Math.floor(Math.random()*eq.length)].a;
    }

    /* -------------------- 保留区域（红色区只允许红方，白色区只允许蓝方） -------------------- */
    // 红色区域：只有红方(player 0)棋子可进入
    var RED_ZONES = {};
    [[6,9],[5,9],[4,9],[3,9],[2,9],[1,9],[0,9],[7,1],[0,1]].forEach(function(z){ RED_ZONES[z[0]+","+z[1]] = 1; });
    // 白色区域：只有蓝方(player 1)棋子可进入
    var BLUE_ZONES = {};
    [[7,0],[6,0],[5,0],[4,0],[3,0],[2,0],[1,0],[7,8],[0,8]].forEach(function(z){ BLUE_ZONES[z[0]+","+z[1]] = 1; });

    function isZoneAllowed(row, col, owner){
      var key = row + "," + col;
      if(owner === 0 && BLUE_ZONES[key]) return false; // 红方不能进蓝区
      if(owner === 1 && RED_ZONES[key]) return false;  // 蓝方不能进红区
      return true;
    }

    /* -------------------- 5种官方布局（Khet 2.0官方非对称阵型） -------------------- */
    var LAYOUTS = [
      {name:"幺点", en:"ACE", desc:"入门阵型，简单均衡",
       p0:[[LASER,7,9,UP],[SHIELD,7,5,UP],[KING,7,4,RIGHT],[SHIELD,7,3,UP],
           [MIRROR,7,2,UP],[MIRROR,6,7,RIGHT],[MIRROR,4,9,LEFT],
           [SWITCH,4,5,RIGHT],[SWITCH,4,4,DOWN],[MIRROR,4,2,UP],
           [MIRROR,3,9,UP],[MIRROR,3,2,LEFT],[MIRROR,2,3,UP]],
       p1:[[MIRROR,5,6,DOWN],[MIRROR,4,7,RIGHT],[MIRROR,4,0,DOWN],
           [MIRROR,3,7,DOWN],[SWITCH,3,5,DOWN],[SWITCH,3,4,RIGHT],
           [MIRROR,3,0,RIGHT],[MIRROR,1,2,LEFT],[MIRROR,0,7,DOWN],
           [SHIELD,0,6,DOWN],[KING,0,5,RIGHT],[SHIELD,0,4,DOWN],
           [LASER,0,0,DOWN]]},
      {name:"好奇", en:"CURIOSITY", desc:"镜面前推，开局更具进攻性",
       p0:[[LASER,7,9,UP],[SHIELD,7,5,UP],[KING,7,4,RIGHT],[SHIELD,7,3,UP],
           [SWITCH,7,2,DOWN],[MIRROR,5,3,LEFT],[MIRROR,4,9,LEFT],
           [SWITCH,4,4,DOWN],[MIRROR,4,1,UP],[MIRROR,3,9,UP],
           [MIRROR,3,4,DOWN],[MIRROR,3,1,LEFT],[MIRROR,2,3,UP]],
       p1:[[MIRROR,5,6,DOWN],[MIRROR,4,8,RIGHT],[MIRROR,4,5,UP],
           [MIRROR,4,0,DOWN],[MIRROR,3,8,DOWN],[SWITCH,3,5,DOWN],
           [MIRROR,3,0,RIGHT],[MIRROR,2,6,RIGHT],[SWITCH,0,7,DOWN],
           [SHIELD,0,6,DOWN],[KING,0,5,RIGHT],[SHIELD,0,4,DOWN],
           [LASER,0,0,DOWN]]},
      {name:"圣杯", en:"GRAIL", desc:"国王重兵把守，防御坚固",
       p0:[[LASER,7,9,UP],[MIRROR,7,5,RIGHT],[SHIELD,7,4,UP],[MIRROR,7,3,UP],
           [KING,6,4,RIGHT],[MIRROR,5,9,LEFT],[MIRROR,5,5,RIGHT],
           [SHIELD,5,4,UP],[SWITCH,5,3,DOWN],[MIRROR,4,9,UP],
           [SWITCH,4,7,RIGHT],[MIRROR,3,6,DOWN],[MIRROR,3,4,UP]],
       p1:[[MIRROR,4,5,DOWN],[MIRROR,4,3,UP],[SWITCH,3,2,RIGHT],
           [MIRROR,3,0,DOWN],[SWITCH,2,6,DOWN],[SHIELD,2,5,DOWN],
           [MIRROR,2,4,LEFT],[MIRROR,2,0,RIGHT],[KING,1,5,RIGHT],
           [MIRROR,0,6,DOWN],[SHIELD,0,5,DOWN],[MIRROR,0,4,LEFT],
           [LASER,0,0,DOWN]]},
      {name:"水星", en:"MERCURY", desc:"镜链复杂，反射路径多变",
       p0:[[LASER,7,9,UP],[MIRROR,7,5,RIGHT],[KING,7,4,RIGHT],[MIRROR,7,3,UP],
           [SHIELD,6,4,UP],[MIRROR,6,3,UP],[MIRROR,5,9,UP],
           [SWITCH,5,6,DOWN],[SHIELD,5,4,UP],[MIRROR,4,9,LEFT],
           [MIRROR,3,8,LEFT],[MIRROR,3,4,UP],[SWITCH,0,9,DOWN]],
       p1:[[SWITCH,7,0,DOWN],[MIRROR,4,5,DOWN],[MIRROR,4,1,RIGHT],
           [MIRROR,3,0,RIGHT],[SHIELD,2,5,DOWN],[SWITCH,2,3,DOWN],
           [MIRROR,2,0,DOWN],[MIRROR,1,6,DOWN],[SHIELD,1,5,DOWN],
           [MIRROR,0,6,DOWN],[KING,0,5,RIGHT],[MIRROR,0,4,LEFT],
           [LASER,0,0,DOWN]]},
      {name:"苏菲", en:"SOPHIE", desc:"棋子分散全盘，高阶对弈",
       p0:[[LASER,7,9,UP],[KING,7,5,RIGHT],[MIRROR,7,3,UP],
           [SHIELD,6,6,UP],[SHIELD,6,4,UP],[MIRROR,5,9,LEFT],
           [MIRROR,5,5,RIGHT],[MIRROR,5,4,UP],[SWITCH,4,2,RIGHT],
           [MIRROR,2,9,UP],[SWITCH,2,7,DOWN],[MIRROR,1,9,LEFT],
           [MIRROR,0,5,UP]],
       p1:[[MIRROR,7,4,DOWN],[MIRROR,6,0,RIGHT],[SWITCH,5,2,DOWN],
           [MIRROR,5,0,DOWN],[SWITCH,3,7,RIGHT],[MIRROR,2,5,DOWN],
           [MIRROR,2,4,LEFT],[MIRROR,2,0,RIGHT],[SHIELD,1,5,DOWN],
           [SHIELD,1,3,DOWN],[MIRROR,0,6,DOWN],[KING,0,4,RIGHT],
           [LASER,0,0,DOWN]]},
    ];

    function makeInitialPieces(layoutIndex){
      layoutIndex = layoutIndex || 0;
      var layout = LAYOUTS[layoutIndex];
      var pieces = [];
      layout.p0.forEach(function(d, idx){
        pieces.push({id:"r"+idx, type:d[0], owner:0, row:d[1], col:d[2], orientation:d[3], alive:true});
      });
      layout.p1.forEach(function(d, idx){
        pieces.push({id:"b"+idx, type:d[0], owner:1, row:d[1], col:d[2], orientation:d[3], alive:true});
      });
      return pieces;
    }

    /* -------------------- 游戏状态 -------------------- */
    var DIFFICULTY_ORDER = ["easy", "normal", "hard"];
    var DIFFICULTY_LABEL = {easy:"简单", normal:"普通", hard:"困难"};
    var DIFFICULTY_DESC = {
      easy:"主动推进并尝试简单攻击，仍会保留容错空间",
      normal:"主动构建反射路线，并预判玩家下一步回应",
      hard:"持续施压并推演多回合，优先形成致命光路"
    };
    var G = {
      pieces:[], current:0, phase:"select", sel:-1, mode:"pve", aiPlayer:1,
      difficulty:"normal", screen:"setup", lockedLayoutIdx:null, lockedDifficulty:null,
      rulesScroll:0, aiAnim:null, actionNotice:null,
      path:null, animT:0, beamPulseT:0, over:false, winner:-1, busy:false,
      history:{}, drawOffer:false, modal:null, flashN:0, flashPiece:null,
      eliminated:null, layoutIdx:0, undoSnapshot:null,
      particles:[], particleT:0, dropdownOpen:false, diffDropdownOpen:false,
      playerPassiveTurns:0, turnStartPieces:null
    };

    /* -------------------- WebGL 棋盘（失败时保留现有伪3D） -------------------- */
    var webglCanvas = null;
    var webglRenderer = null;
    var rendererMode = "fallback";
    var rendererAlive = true;

    function initWebGLRenderer(){
      if(!platform || typeof platform.createCanvas !== "function" ||
         typeof platform.readAsset !== "function") return;
      try {
        webglCanvas = platform.createCanvas();
        webglRenderer = WebGLRenderer.create({
          canvas:webglCanvas,
          readAsset:platform.readAsset
        });
        webglRenderer.resize(SW, SH, platform.dpr || 1);
        rendererMode = "loading";
        webglRenderer.load(function(ok){
          if(!rendererAlive) return;
          rendererMode = ok ? "ready" : "fallback";
          try { render(); } catch(e) {}
        });
      } catch(e){
        rendererMode = "fallback";
        if(webglRenderer) webglRenderer.dispose();
        webglRenderer = null; webglCanvas = null;
      }
    }

    function webglScene(){
      var targets = [];
      if(G.phase === "move" && G.sel >= 0 && G.pieces[G.sel])
        targets = moveTargets(G.pieces[G.sel]);
      return {
        pieces:G.pieces.map(copySnapshotValue),
        selected:G.sel,
        targets:targets.map(copySnapshotValue),
        path:G.path ? G.path.map(copySnapshotValue) : null,
        beamProgress:G.animT,
        aiPose:copySnapshotValue(sampleAiAnimation(G.aiAnim)),
        camera:webglCamera(),
        setup:G.screen === "setup",
        zoneCells:WebGLRenderer.zoneCells()
      };
    }

    function webglCamera(){
      var cos=Math.abs(Math.cos(cam.yaw)), sin=Math.abs(Math.sin(cam.yaw));
      var halfWidth=cos*5.65+sin*4.65;
      var matchDistance=Math.max(26,26*halfWidth/5.65);
      return {
        yaw:cam.yaw,
        pitch:cam.pitch,
        distance:G.screen === "setup" ? 27 : matchDistance,
        offsetY:G.screen === "setup" ? -90 : (boardAreaTop+boardAreaBot-SH)/2-7
      };
    }

    function drawWebGLBoard(){
      if(rendererMode !== "ready" || !webglRenderer || !webglCanvas) return false;
      try {
        if(!webglRenderer.render(webglScene())) throw new Error("WebGL render failed");
        ctx.drawImage(webglCanvas, 0, 0, SW, SH);
        return true;
      } catch(e){
        rendererMode = "fallback";
        webglRenderer.dispose();
        webglRenderer = null; webglCanvas = null;
        return false;
      }
    }

    function clearMatchVisualState(){
      G.path=null; G.animT=0; G.beamPulseT=0; G.sel=-1;
      G.flashN=0; G.flashPiece=null; G.eliminated=null;
      G.undoSnapshot=null; G.particles=[]; G.particleT=0;
      G.aiAnim=null; G.actionNotice=null; camAnim=null;
      for(var i=0;i<_timeouts.length;i++) clearTimeout(_timeouts[i]);
      _timeouts = [];
    }

    function resetMatchState(pieces){
      clearMatchVisualState();
      G.pieces = pieces;
      G.current=0; G.phase="select"; G.sel=-1;
      G.over=false; G.winner=-1; G.busy=false;
      G.history={}; G.drawOffer=false; G.modal=null;
      G.undoSnapshot=null;
      G.playerPassiveTurns=0;
      G.turnStartPieces=G.pieces.map(copySnapshotValue);
    }

    function setSetupCamera(){
      camAnim = null;
      cam.yaw = 0; cam.pitch = SETUP_PITCH;
      cam.cx = 0; cam.cy = 0; cam.focal = 1;
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      var corners = [[-COLS/2,-ROWS/2],[COLS/2,-ROWS/2],
        [COLS/2,ROWS/2],[-COLS/2,ROWS/2]];
      for(var i=0;i<corners.length;i++){
        var p = project3D(corners[i][0], 0, corners[i][1]);
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      var previewTop = SAFE_TOP + 70;
      var previewBot = Math.max(previewTop + 80, SH * 0.55);
      cam.focal = Math.min((SW - 24) / (maxX - minX),
        (previewBot - previewTop) / (maxY - minY));
      cam.cx = SW / 2 - (minX + maxX) * cam.focal / 2;
      cam.cy = (previewTop + previewBot) / 2 - (minY + maxY) * cam.focal / 2;
    }

    function setMatchCamera(){
      camAnim = null;
      cam.yaw = DEFAULT_YAW; cam.pitch = DEFAULT_PITCH;
      cam.cx = SW / 2; cam.cy = (boardAreaTop + boardAreaBot) / 2;
      updateMatchCameraFit();
    }

    function updateMatchCameraFit(){
      var cos=Math.abs(Math.cos(cam.yaw)), sin=Math.abs(Math.sin(cam.yaw));
      var halfWidth=cos*5.65+sin*4.65;
      var base=Math.min(SW*.72,(boardAreaBot-boardAreaTop)*1.18)*cam.dist/10;
      cam.cx=SW/2; cam.cy=(boardAreaTop+boardAreaBot)/2;
      cam.focal=base*Math.min(1,5.65/halfWidth);
    }

    function enterSetup(){
      clearMatchVisualState();
      G.screen = "setup";
      G.lockedLayoutIdx = null;
      G.lockedDifficulty = null;
      G.dropdownOpen = false;
      G.diffDropdownOpen = false;
      G.pieces = makeInitialPieces(G.layoutIdx);
      G.current=0; G.phase="select"; G.over=false; G.winner=-1;
      G.history={}; G.drawOffer=false; G.modal=null; G.busy=false;
      G.playerPassiveTurns=0; G.turnStartPieces=null;
      setSetupCamera();
      render();
    }

    function beginMatch(){
      if(G.screen !== "setup") return;
      G.dropdownOpen = false;
      G.diffDropdownOpen = false;
      G.lockedLayoutIdx = G.layoutIdx;
      G.lockedDifficulty = G.difficulty;
      G.screen = "playing";
      resetMatchState(makeInitialPieces(G.lockedLayoutIdx));
      setMatchCamera();
      render();
    }

    function restartMatch(){
      if(G.screen !== "playing") return;
      resetMatchState(makeInitialPieces(G.lockedLayoutIdx));
      setMatchCamera();
      render();
    }

    function selectLayout(index){
      if(G.screen !== "setup" || typeof index !== "number" || index % 1 !== 0 || index < 0 || index >= LAYOUTS.length) return;
      G.layoutIdx = index;
      G.pieces = makeInitialPieces(index);
      setSetupCamera();
      render();
    }

    function selectDifficulty(level){
      if(G.screen !== "setup" || DIFFICULTY_ORDER.indexOf(level) < 0) return;
      G.difficulty = level;
      render();
    }

    function openRules(){
      if(G.screen !== "setup") return;
      G.rulesScroll = 0;
      G.modal = "rules";
      render();
    }

    function closeModal(){
      if(!G.modal) return;
      G.modal = null;
      render();
    }

    function requestReturnToSetup(){
      if(G.screen !== "playing") return;
      G.modal = "confirmReturn";
      render();
    }

    function confirmReturnToSetup(){
      if(G.modal !== "confirmReturn") return;
      G.layoutIdx = G.lockedLayoutIdx;
      G.difficulty = G.lockedDifficulty;
      enterSetup();
    }

    function copySnapshotValue(value){
      var copy, key;
      if(!value || typeof value !== "object") return value;
      if(Array.isArray(value)) return value.map(copySnapshotValue);
      copy = {};
      for(key in value){
        if(Object.prototype.hasOwnProperty.call(value, key)) copy[key] = copySnapshotValue(value[key]);
      }
      return copy;
    }

    function signature(){
      var arr = [];
      for(var i=0;i<G.pieces.length;i++){
        var p = G.pieces[i];
        if(p.alive) arr.push(p.row+","+p.col+","+p.type+","+p.owner+","+p.orientation);
      }
      arr.sort();
      return arr.join("|") + "#" + G.current;
    }
    function recordState(){
      var k = signature();
      G.history[k] = (G.history[k]||0) + 1;
      if(G.history[k] >= 3) G.drawOffer = true;
    }

    /* -------------------- 颜色 -------------------- */
    function ownerColor(o, l){ return o===0 ? (l?"#ff4a4a":"#cc2020") : (l?"#3a8aff":"#1a4ad0"); }

    /* -------------------- 圆角矩形 -------------------- */
    function roundRect(x, y, w, h, r){
      r = Math.min(r, w/2, h/2);
      ctx.beginPath();
      ctx.moveTo(x+r, y);
      ctx.arcTo(x+w, y, x+w, y+h, r);
      ctx.arcTo(x+w, y+h, x, y+h, r);
      ctx.arcTo(x, y+h, x, y, r);
      ctx.arcTo(x, y, x+w, y, r);
      ctx.closePath();
    }

    /* -------------------- 3D 渲染辅助 -------------------- */
    function draw3DFaces(faces, proj){
      var sorted = faces.map(function(f){
        var depth = 0;
        for(var i=0;i<f.v.length;i++) depth += proj[f.v[i]].z;
        return { face:f, depth: depth / f.v.length };
      });
      sorted.sort(function(a,b){ return b.depth - a.depth; });
      for(var i=0;i<sorted.length;i++){
        var f = sorted[i].face;
        ctx.fillStyle = f.c;
        ctx.beginPath();
        ctx.moveTo(proj[f.v[0]].x, proj[f.v[0]].y);
        for(var j=1;j<f.v.length;j++) ctx.lineTo(proj[f.v[j]].x, proj[f.v[j]].y);
        ctx.closePath();
        ctx.fill();
        if(f.stroke){
          ctx.strokeStyle = f.stroke;
          ctx.lineWidth = f.lw || 1;
          ctx.stroke();
        }
      }
    }

    function draw3DBox(cx, cz, w, d, h, topColor, baseColor, y0){
      y0 = y0 || 0;
      var hw = w/2, hd = d/2;
      var verts = [
        [-hw,y0,-hd],[hw,y0,-hd],[hw,y0,hd],[-hw,y0,hd],
        [-hw,y0+h,-hd],[hw,y0+h,-hd],[hw,y0+h,hd],[-hw,y0+h,hd]
      ];
      var proj = verts.map(function(v){ return project3D(cx+v[0], v[1], cz+v[2]); });
      var dark = darkenColor(baseColor, 0.45);
      var mid = darkenColor(baseColor, 0.65);
      var faces = [
        {v:[0,1,5,4], c:dark, stroke:"rgba(0,0,0,0.3)", lw:1},
        {v:[1,2,6,5], c:mid, stroke:"rgba(0,0,0,0.3)", lw:1},
        {v:[2,3,7,6], c:darkenColor(baseColor,0.35), stroke:"rgba(0,0,0,0.3)", lw:1},
        {v:[3,0,4,7], c:mid, stroke:"rgba(0,0,0,0.3)", lw:1},
        {v:[4,5,6,7], c:topColor, stroke:"rgba(255,255,255,0.15)", lw:1}
      ];
      draw3DFaces(faces, proj);
      return proj;
    }

    /* -------------------- 3D 多部件组合渲染（统一深度排序） -------------------- */
    function drawComposite3D(cx, cz, parts){
      var allProj = [];
      var allFaces = [];
      for(var pi=0; pi<parts.length; pi++){
        var part = parts[pi];
        var hw = part.w/2, hd = part.d/2;
        var y0 = part.y0 || 0, h = part.h;
        var bi = allProj.length;
        var verts = [
          [-hw,y0,-hd],[hw,y0,-hd],[hw,y0,hd],[-hw,y0,hd],
          [-hw,y0+h,-hd],[hw,y0+h,-hd],[hw,y0+h,hd],[-hw,y0+h,hd]
        ];
        for(var vi=0; vi<8; vi++){
          allProj.push(project3D(cx+verts[vi][0], verts[vi][1], cz+verts[vi][2]));
        }
        var dark = darkenColor(part.baseColor, 0.45);
        var mid = darkenColor(part.baseColor, 0.65);
        var bk = darkenColor(part.baseColor, 0.35);
        allFaces.push({v:[bi+0,bi+1,bi+5,bi+4], c:dark, stroke:"rgba(0,0,0,0.3)", lw:1});
        allFaces.push({v:[bi+1,bi+2,bi+6,bi+5], c:mid, stroke:"rgba(0,0,0,0.3)", lw:1});
        allFaces.push({v:[bi+2,bi+3,bi+7,bi+6], c:bk, stroke:"rgba(0,0,0,0.3)", lw:1});
        allFaces.push({v:[bi+3,bi+0,bi+4,bi+7], c:mid, stroke:"rgba(0,0,0,0.3)", lw:1});
        allFaces.push({v:[bi+4,bi+5,bi+6,bi+7], c:part.topColor, stroke:"rgba(255,255,255,0.15)", lw:1});
      }
      draw3DFaces(allFaces, allProj);
    }

    function drawShadow3D(cx, cz, w, d){
      var hw = w*0.5, hd = d*0.5;
      var p1 = project3D(cx-hw, 0.005, cz-hd);
      var p2 = project3D(cx+hw, 0.005, cz-hd);
      var p3 = project3D(cx+hw, 0.005, cz+hd);
      var p4 = project3D(cx-hw, 0.005, cz+hd);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath();
      ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y);
      ctx.lineTo(p3.x,p3.y); ctx.lineTo(p4.x,p4.y);
      ctx.closePath(); ctx.fill();
    }

    function drawCellQuad3D(row, col, y, color, strokeColor, strokeW){
      var wx = col - (COLS-1)/2;
      var wz = row - (ROWS-1)/2;
      var hw = 0.5, hd = 0.5;
      var p1 = project3D(wx-hw, y, wz-hd);
      var p2 = project3D(wx+hw, y, wz-hd);
      var p3 = project3D(wx+hw, y, wz+hd);
      var p4 = project3D(wx-hw, y, wz+hd);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y);
      ctx.lineTo(p3.x,p3.y); ctx.lineTo(p4.x,p4.y);
      ctx.closePath(); ctx.fill();
      if(strokeColor){
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeW || 2;
        ctx.stroke();
      }
    }

    function drawAiRing(row, col, alpha, scale){
      var p = project3D(col - (COLS-1)/2, 0.025, row - (ROWS-1)/2);
      ctx.strokeStyle = "rgba(255,225,77," + alpha + ")";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.s * 0.34 * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* -------------------- 3D 棋盘渲染 -------------------- */
    function drawBoard3D(){
      var hw = COLS/2, hd = ROWS/2, th = 0.3;
      var verts = [
        [-hw,-th,-hd],[hw,-th,-hd],[hw,-th,hd],[-hw,-th,hd],
        [-hw,0,-hd],[hw,0,-hd],[hw,0,hd],[-hw,0,hd]
      ];
      var proj = verts.map(function(v){ return project3D(v[0], v[1], v[2]); });
      var faces = [
        {v:[0,1,5,4], c:"#2a2d38"},
        {v:[1,2,6,5], c:"#22242e"},
        {v:[2,3,7,6], c:"#1a1c24"},
        {v:[3,0,4,7], c:"#22242e"},
        {v:[4,5,6,7], c:"#3a3e4a"}
      ];
      draw3DFaces(faces, proj);

      // 格子底色（仅交替色，半透明叠加）
      for(var r=0;r<ROWS;r++){
        for(var c=0;c<COLS;c++){
          if((r+c)%2===0){
            drawCellQuad3D(r, c, 0.002, "rgba(80,86,100,0.35)", null, 0);
          }
        }
      }

      // 保留区域着色
      for(var r=0;r<ROWS;r++){
        for(var c=0;c<COLS;c++){
          var zkey = r + "," + c;
          if(RED_ZONES[zkey]){
            drawCellQuad3D(r, c, 0.003, "rgba(200,60,50,0.30)", null, 0);
            var cp1 = project3D(c - (COLS-1)/2, 0.01, r - (ROWS-1)/2);
            ctx.fillStyle = "rgba(220,80,70,0.55)";
            ctx.beginPath(); ctx.arc(cp1.x, cp1.y, cp1.s*0.16, 0, 6.283); ctx.fill();
          } else if(BLUE_ZONES[zkey]){
            drawCellQuad3D(r, c, 0.003, "rgba(240,240,245,0.25)", null, 0);
            var cp2 = project3D(c - (COLS-1)/2, 0.01, r - (ROWS-1)/2);
            ctx.fillStyle = "rgba(220,225,235,0.55)";
            ctx.beginPath(); ctx.arc(cp2.x, cp2.y, cp2.s*0.16, 0, 6.283); ctx.fill();
          }
        }
      }

      // 网格线
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      for(var r2=0;r2<=ROWS;r2++){
        var z = r2 - ROWS/2;
        var a = project3D(-hw, 0.003, z);
        var b = project3D(hw, 0.003, z);
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      }
      for(var c2=0;c2<=COLS;c2++){
        var x = c2 - COLS/2;
        var a2 = project3D(x, 0.003, -hd);
        var b2 = project3D(x, 0.003, hd);
        ctx.beginPath(); ctx.moveTo(a2.x,a2.y); ctx.lineTo(b2.x,b2.y); ctx.stroke();
      }

      // 选中高亮
      if(G.sel >= 0 && G.pieces[G.sel]){
        var sp = G.pieces[G.sel];
        if(sp.alive) drawCellQuad3D(sp.row, sp.col, 0.004, "rgba(255,225,77,0.15)", "#ffe14d", 2);
      }

      // 移动目标
      if(G.phase === "move" && G.sel >= 0){
        var selP = G.pieces[G.sel];
        if(selP){
          var targets = moveTargets(selP);
          for(var t=0;t<targets.length;t++){
            drawCellQuad3D(targets[t].r, targets[t].c, 0.004, "rgba(61,169,252,0.22)", "rgba(108,193,255,0.7)", 2);
            var wx2 = targets[t].c - (COLS-1)/2;
            var wz2 = targets[t].r - (ROWS-1)/2;
            var cp = project3D(wx2, 0.01, wz2);
            ctx.strokeStyle = "rgba(108,193,255,0.8)";
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(cp.x, cp.y, cp.s*0.12, 0, 6.283); ctx.stroke();
          }
        }
      }
    }

    /* -------------------- 3D 棋子图标 -------------------- */
    function drawPieceIcon3D(p, wx, wz, ph){
      var pw = 0.72;
      var p4 = project3D(wx-pw/2, ph, wz-pw/2);
      var p5 = project3D(wx+pw/2, ph, wz-pw/2);
      var p7 = project3D(wx-pw/2, ph, wz+pw/2);
      var p6 = project3D(wx+pw/2, ph, wz+pw/2);
      var cx = (p4.x+p5.x+p6.x+p7.x)/4;
      var cy = (p4.y+p5.y+p6.y+p7.y)/4;
      var angle = Math.atan2(p5.y-p4.y, p5.x-p4.x);
      var w = Math.sqrt((p5.x-p4.x)*(p5.x-p4.x)+(p5.y-p4.y)*(p5.y-p4.y));
      var s = w / pw;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.scale(s, s);

      if(p.type===KING) drawIconKing();
      else if(p.type===LASER) drawIconLaser(p.orientation);
      else if(p.type===SHIELD) drawIconShield(p.orientation);
      else if(p.type===MIRROR) drawIconMirror(p.orientation);
      else if(p.type===SWITCH) drawIconSwitch(p.orientation);

      ctx.restore();
    }

    /* -------------------- 3D 单面镜 — 方形底座+直角三棱柱+斜面镜+彩色边框 -------------------- */
    function drawMirrorPrism3D(wx, wz, orientation, baseColor, liteColor){
      var sq2 = Math.SQRT1_2;
      var s = 0.70;
      var hw = 0.42, hd = 0.42;
      var depth = s * hw * Math.SQRT2;
      var h = 0.58;

      var isSlash = (orientation % 2 === 1);
      var p;
      if (isSlash) p = [sq2, -sq2];
      else         p = [sq2,  sq2];

      var mirrorFront = (orientation >= 2) !== (orientation % 2 === 1);
      var backSign = mirrorFront ? -1 : 1;

      var e1, e2;
      if (isSlash) { e1 = [-hw*s, -hd*s]; e2 = [ hw*s,  hd*s]; }
      else         { e1 = [ hw*s, -hd*s]; e2 = [-hw*s,  hd*s]; }
      var e3 = [p[0]*backSign*depth, p[1]*backSign*depth];

      // 方形薄底座
      draw3DBox(wx, wz, 0.70, 0.70, 0.05, darkenColor(baseColor, 0.5), darkenColor(baseColor, 0.4), 0);
      var y0 = 0.05;

      var verts = [
        [e1[0], y0, e1[1]],
        [e2[0], y0, e2[1]],
        [e3[0], y0, e3[1]],
        [e1[0], y0+h, e1[1]],
        [e2[0], y0+h, e2[1]],
        [e3[0], y0+h, e3[1]],
      ];
      var proj = verts.map(function(v){ return project3D(wx+v[0], v[1], wz+v[2]); });

      var dark = darkenColor(baseColor, 0.28);
      var mid = darkenColor(baseColor, 0.5);
      var vdark = darkenColor(baseColor, 0.2);
      var mirrorC = "rgba(200,240,255,0.92)";

      var faces = [
        {v:[0,1,2], c:vdark, stroke:"rgba(0,0,0,0.3)", lw:1},
        {v:[3,5,4], c:mid, stroke:"rgba(0,0,0,0.35)", lw:1},
        {v:[0,1,4,3], c:mirrorC, stroke:liteColor, lw:2.5},             // 镜面+彩色边框
        {v:[0,3,5,2], c:dark, stroke:"rgba(0,0,0,0.3)", lw:1},
        {v:[1,2,5,4], c:dark, stroke:"rgba(0,0,0,0.3)", lw:1},
      ];

      draw3DFaces(faces, proj);

      // 镜面高光线
      var mx1=(proj[0].x+proj[1].x)/2, my1=(proj[0].y+proj[1].y)/2;
      var mx2=(proj[3].x+proj[4].x)/2, my2=(proj[3].y+proj[4].y)/2;
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx1,my1); ctx.lineTo(mx2,my2);
      ctx.stroke();
    }

    /* -------------------- 3D 双面镜 — 阶梯圆底座+竖直薄板+圆柱旋钮+双镜面 -------------------- */
    function drawSwitchPrism3D(wx, wz, orientation, baseColor, liteColor){
      var sq2 = Math.SQRT1_2;
      var bw = 0.26;
      var bh = 0.50;
      var bt = 0.06;
      var segs = 10;

      // 阶梯圆形底座
      function drawCyl(cy, r, h, color, topC) {
        var bProj = [], bFaces = [];
        for (var i = 0; i < segs; i++) {
          var a = (i / segs) * Math.PI * 2;
          bProj.push(project3D(wx + Math.cos(a) * r, cy, wz + Math.sin(a) * r));
        }
        for (var j = 0; j < segs; j++) {
          var a2 = (j / segs) * Math.PI * 2;
          bProj.push(project3D(wx + Math.cos(a2) * r, cy + h, wz + Math.sin(a2) * r));
        }
        for (var k = 0; k < segs; k++) {
          var ni = (k + 1) % segs;
          var shade = 0.35 + 0.35 * Math.abs(Math.cos((k / segs) * Math.PI * 2));
          bFaces.push({ v: [k, ni, ni + segs, k + segs], c: darkenColor(color, shade * 0.7), stroke: "rgba(0,0,0,0.2)", lw: 0.5 });
        }
        var topV = [];
        for (var m = 0; m < segs; m++) topV.push(m + segs);
        bFaces.push({ v: topV, c: topC, stroke: "rgba(0,0,0,0.3)", lw: 1 });
        draw3DFaces(bFaces, bProj);
      }
      drawCyl(0,    0.36, 0.04, darkenColor(baseColor, 0.35), darkenColor(baseColor, 0.5));
      drawCyl(0.04, 0.27, 0.04, darkenColor(baseColor, 0.5), darkenColor(baseColor, 0.6));
      var baseH = 0.08;

      // 镜体参数
      var isSlash = (orientation % 2 === 1);
      var d, perp;
      if (isSlash) { d = [sq2, sq2];  perp = [sq2, -sq2]; }
      else         { d = [sq2, -sq2]; perp = [sq2,  sq2]; }

      function vert(ds, ps, y) {
        return [d[0]*ds + perp[0]*ps, y, d[1]*ds + perp[1]*ps];
      }

      var bodyY = baseH;
      var v0 = vert(-bw, -bt, bodyY);
      var v1 = vert(-bw,  bt, bodyY);
      var v2 = vert( bw, -bt, bodyY);
      var v3 = vert( bw,  bt, bodyY);
      var v4 = vert(-bw, -bt, bodyY+bh);
      var v5 = vert(-bw,  bt, bodyY+bh);
      var v6 = vert( bw, -bt, bodyY+bh);
      var v7 = vert( bw,  bt, bodyY+bh);

      var allVerts = [v0,v1,v2,v3,v4,v5,v6,v7];
      var proj = allVerts.map(function(v){ return project3D(wx+v[0], v[1], wz+v[2]); });

      var dark = darkenColor(baseColor, 0.28);
      var mid = darkenColor(baseColor, 0.5);
      var vdark = darkenColor(baseColor, 0.2);
      var mirrorC = "rgba(200,240,255,0.92)";

      var faces = [
        {v:[1,3,7,5], c:mirrorC, stroke:liteColor, lw:2},            // 前镜面+彩色边框
        {v:[0,4,6,2], c:mirrorC, stroke:liteColor, lw:2},            // 后镜面+彩色边框
        {v:[0,1,5,4], c:liteColor, stroke:"rgba(0,0,0,0.35)", lw:1}, // 左端面
        {v:[2,6,7,3], c:mid, stroke:"rgba(0,0,0,0.35)", lw:1},       // 右端面
        {v:[4,5,7,6], c:dark, stroke:"rgba(0,0,0,0.3)", lw:1},       // 顶面
        {v:[0,2,3,1], c:vdark, stroke:"rgba(0,0,0,0.3)", lw:1},       // 底面
      ];
      draw3DFaces(faces, proj);

      // 侧旋钮（圆柱形，沿d方向）
      var knobY = bodyY + bh * 0.45;
      var knobR = 0.05;
      var knobOff = bw * 0.95;
      var knobLen = 0.08;
      function drawKnob(kcx, kcz) {
        var kProj = [], kFaces = [];
        for (var ki = 0; ki < 8; ki++) {
          var ka = (ki/8)*Math.PI*2;
          var kpx = perp[0]*Math.cos(ka)*knobR;
          var kpz = perp[1]*Math.cos(ka)*knobR;
          var kpy = Math.sin(ka)*knobR;
          kProj.push(project3D(kcx - d[0]*knobLen*0.5 + kpx, knobY + kpy, kcz - d[1]*knobLen*0.5 + kpz));
          kProj.push(project3D(kcx + d[0]*knobLen*0.5 + kpx, knobY + kpy, kcz + d[1]*knobLen*0.5 + kpz));
        }
        for (var kf = 0; kf < 8; kf++) {
          var kni = (kf+1)%8;
          var kshade = 0.3 + 0.4*Math.abs(Math.cos((kf/8)*Math.PI*2));
          kFaces.push({v:[kf*2, kf*2+1, kni*2+1, kni*2], c:darkenColor("#5a5a6e", kshade), stroke:"rgba(0,0,0,0.2)", lw:0.5});
        }
        // 外端面
        var endV = [];
        for (var ef = 0; ef < 8; ef++) endV.push(ef*2+1);
        kFaces.push({v: endV, c: "#3a3a4e", stroke:"rgba(0,0,0,0.3)", lw:1});
        draw3DFaces(kFaces, kProj);
      }
      drawKnob(wx + d[0]*knobOff, wz + d[1]*knobOff);
      drawKnob(wx - d[0]*knobOff, wz - d[1]*knobOff);

      // 镜面高光线
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      var fmx1=(proj[1].x+proj[3].x)/2, fmy1=(proj[1].y+proj[3].y)/2;
      var fmx2=(proj[5].x+proj[7].x)/2, fmy2=(proj[5].y+proj[7].y)/2;
      var bmx1=(proj[0].x+proj[2].x)/2, bmy1=(proj[0].y+proj[2].y)/2;
      var bmx2=(proj[4].x+proj[6].x)/2, bmy2=(proj[4].y+proj[6].y)/2;
      ctx.moveTo(fmx1,fmy1); ctx.lineTo(fmx2,fmy2);
      ctx.moveTo(bmx1,bmy1); ctx.lineTo(bmx2,bmy2);
      ctx.stroke();
    }

    /* -------------------- 3D 激光炮 — 圆盘底座+方形炮塔+圆柱炮管+同心环透镜 -------------------- */
    function drawLaserCylinder3D(wx, wz, orientation, baseColor, liteColor){
      var segs = 12;
      var isRed = (baseColor === "#cc2020");
      var lensColor = isRed ? "rgba(255,120,30,0.85)" : "rgba(80,180,255,0.85)";
      var lensGlow = isRed ? "rgba(255,200,80,0.6)" : "rgba(120,220,255,0.6)";
      var metalC = "#4a4a5e";
      var metalD = "#2a2a3e";

      function drawCyl(cy, r, h, color, topC) {
        var bProj = [], bFaces = [];
        for (var i = 0; i < segs; i++) {
          var a = (i / segs) * Math.PI * 2;
          bProj.push(project3D(wx + Math.cos(a) * r, cy, wz + Math.sin(a) * r));
        }
        for (var j = 0; j < segs; j++) {
          var a2 = (j / segs) * Math.PI * 2;
          bProj.push(project3D(wx + Math.cos(a2) * r, cy + h, wz + Math.sin(a2) * r));
        }
        for (var k = 0; k < segs; k++) {
          var ni = (k + 1) % segs;
          var shade = 0.35 + 0.35 * Math.abs(Math.cos((k / segs) * Math.PI * 2));
          bFaces.push({ v: [k, ni, ni + segs, k + segs], c: darkenColor(color, shade * 0.7), stroke: "rgba(0,0,0,0.2)", lw: 0.5 });
        }
        var topV = [];
        for (var m = 0; m < segs; m++) topV.push(m + segs);
        bFaces.push({ v: topV, c: topC, stroke: "rgba(0,0,0,0.3)", lw: 1 });
        draw3DFaces(bFaces, bProj);
      }

      // 1. 圆盘底座
      var baseR = 0.36, baseH = 0.08;
      drawCyl(0, baseR, baseH, darkenColor(baseColor, 0.4), darkenColor(baseColor, 0.5));

      // 2. 隆起边缘
      drawCyl(baseH, 0.30, 0.03, darkenColor(baseColor, 0.5), darkenColor(baseColor, 0.6));

      // 3. 方形炮塔
      var turretW = 0.40, turretH = 0.26;
      var turretY = baseH + 0.03;
      draw3DBox(wx, wz, turretW, turretW, turretH, liteColor, baseColor, turretY);

      // 4. 顶部小圆台
      drawCyl(turretY + turretH, 0.14, 0.04, metalC, metalD);

      // 5. 圆柱炮管
      var dir = orientation;
      var dx = DX[dir], dz = DY[dir];
      var barrelLen = 0.24, barrelR = 0.07;
      var barrelMidY = turretY + turretH * 0.5;
      var barrelStartX = wx + dx * (turretW/2);
      var barrelStartZ = wz + dz * (turretW/2);
      var barrelEndX = wx + dx * (turretW/2 + barrelLen);
      var barrelEndZ = wz + dz * (turretW/2 + barrelLen);

      var bProj = [], bFaces = [];
      for (var bi = 0; bi < segs; bi++) {
        var ba = (bi / segs) * Math.PI * 2;
        var perpX = -dz * Math.cos(ba) * barrelR;
        var perpZ = dx * Math.cos(ba) * barrelR;
        var perpY = Math.sin(ba) * barrelR;
        bProj.push(project3D(barrelStartX + perpX, barrelMidY + perpY, barrelStartZ + perpZ));
        bProj.push(project3D(barrelEndX + perpX, barrelMidY + perpY, barrelEndZ + perpZ));
      }
      for (var bk = 0; bk < segs; bk++) {
        var bni = (bk + 1) % segs;
        var bshade = 0.3 + 0.4 * Math.abs(Math.cos((bk / segs) * Math.PI * 2));
        bFaces.push({ v: [bk*2, bk*2+1, bni*2+1, bni*2], c: darkenColor(metalC, bshade), stroke: "rgba(0,0,0,0.2)", lw: 0.5 });
      }
      var frontV = [];
      for (var bf = 0; bf < segs; bf++) frontV.push(bf*2+1);
      bFaces.push({ v: frontV, c: "#1a1a2e", stroke: "rgba(0,0,0,0.4)", lw: 1 });
      draw3DFaces(bFaces, bProj);

      // 6. 透镜（炮口圆形，带同心环）
      var lensProj = project3D(barrelEndX, barrelMidY, barrelEndZ);
      var lensR = lensProj.s * 0.08;

      ctx.fillStyle = metalD;
      ctx.beginPath();
      ctx.arc(lensProj.x, lensProj.y, lensR * 1.3, 0, 6.283);
      ctx.fill();

      ctx.fillStyle = "#0a0a1a";
      ctx.beginPath();
      ctx.arc(lensProj.x, lensProj.y, lensR, 0, 6.283);
      ctx.fill();

      for (var ri = 3; ri >= 1; ri--) {
        ctx.strokeStyle = ri === 1 ? lensColor : "rgba(80,80,100,0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(lensProj.x, lensProj.y, lensR * ri / 3, 0, 6.283);
        ctx.stroke();
      }

      var lg = ctx.createRadialGradient(lensProj.x, lensProj.y, 0, lensProj.x, lensProj.y, lensR * 0.7);
      lg.addColorStop(0, lensGlow);
      lg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.arc(lensProj.x, lensProj.y, lensR * 0.7, 0, 6.283);
      ctx.fill();

      // 7. 侧旋钮
      var perpDx = -dz, perpDz = dx;
      var knobOff = turretW * 0.55;
      draw3DBox(wx + perpDx * knobOff, wz + perpDz * knobOff, 0.07, 0.07, 0.07, "#5a5a6e", "#3a3a4e", turretY + turretH * 0.35);
      draw3DBox(wx - perpDx * knobOff, wz - perpDz * knobOff, 0.07, 0.07, 0.07, "#5a5a6e", "#3a3a4e", turretY + turretH * 0.35);
    }

    /* -------------------- 3D 国王 — 阶梯圆底座+锥形塔身+金腰带+宝石王冠+十字 -------------------- */
    function drawKingTower3D(wx, wz, baseColor, liteColor){
      var isRed = (baseColor === "#cc2020");
      var goldC = isRed ? "#ffd700" : "#c0c0c0";
      var goldD = isRed ? "#daa520" : "#808080";
      var jewelC = isRed ? "#ff4444" : "#4488ff";
      var finialC = isRed ? "#ff4a4a" : "#3a8aff";
      var finialD = isRed ? "#cc2020" : "#1a4ad0";
      var segs = 12;
      var allProj = [], allFaces = [];

      function addCyl(cy, r, h, color, topC) {
        var baseIdx = allProj.length;
        for (var i = 0; i < segs; i++) {
          var a = (i / segs) * Math.PI * 2;
          allProj.push(project3D(wx + Math.cos(a) * r, cy, wz + Math.sin(a) * r));
        }
        for (var j = 0; j < segs; j++) {
          var a2 = (j / segs) * Math.PI * 2;
          allProj.push(project3D(wx + Math.cos(a2) * r, cy + h, wz + Math.sin(a2) * r));
        }
        for (var k = 0; k < segs; k++) {
          var ni = (k + 1) % segs;
          var shade = 0.35 + 0.35 * Math.abs(Math.cos((k / segs) * Math.PI * 2));
          allFaces.push({ v: [baseIdx + k, baseIdx + ni, baseIdx + ni + segs, baseIdx + k + segs], c: darkenColor(color, shade), stroke: "rgba(0,0,0,0.2)", lw: 0.5 });
        }
        var topV = [];
        for (var m = 0; m < segs; m++) topV.push(baseIdx + m + segs);
        allFaces.push({ v: topV, c: topC, stroke: "rgba(0,0,0,0.3)", lw: 1 });
      }

      // 阶梯圆形底座
      addCyl(0,    0.34, 0.06, darkenColor(baseColor, 0.4), darkenColor(baseColor, 0.5));
      addCyl(0.06, 0.26, 0.04, darkenColor(baseColor, 0.5), darkenColor(baseColor, 0.6));

      // 锥形塔身（底宽顶窄，有腹部凸起）
      addCyl(0.10, 0.20, 0.14, baseColor, liteColor);
      addCyl(0.24, 0.23, 0.06, baseColor, liteColor);  // 腹部
      addCyl(0.30, 0.18, 0.10, baseColor, liteColor);  // 收颈

      // 金色腰带
      addCyl(0.40, 0.22, 0.04, goldC, goldD);

      // 王冠基座（宽于颈部）
      var crownY = 0.44;
      addCyl(crownY, 0.24, 0.06, goldC, goldD);
      draw3DFaces(allFaces, allProj);

      // 王冠尖头（4方向小柱）
      var crownTopY = crownY + 0.06;
      var crownR = 0.24;
      for (var ci = 0; ci < 4; ci++) {
        var ca = (ci / 4) * Math.PI * 2;
        var cx = wx + Math.cos(ca) * crownR;
        var cz = wz + Math.sin(ca) * crownR;
        draw3DBox(cx, cz, 0.06, 0.06, 0.08, goldC, goldD, crownTopY);
      }

      // 王冠宝石（4颗小球）
      for (var ji = 0; ji < 4; ji++) {
        var ja = (ji / 4) * Math.PI * 2;
        var jx = wx + Math.cos(ja) * crownR;
        var jz = wz + Math.sin(ja) * crownR;
        var jProj = project3D(jx, crownTopY + 0.08, jz);
        var jR = jProj.s * 0.04;
        ctx.fillStyle = jewelC;
        ctx.beginPath();
        ctx.arc(jProj.x, jProj.y, jR, 0, 6.283);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.beginPath();
        ctx.arc(jProj.x - jR*0.3, jProj.y - jR*0.3, jR*0.3, 0, 6.283);
        ctx.fill();
      }

      // 十字尖顶
      var crossY = crownTopY + 0.08;
      draw3DBox(wx, wz, 0.05, 0.05, 0.12, finialC, finialD, crossY);
      draw3DBox(wx, wz + 0.05, 0.12, 0.035, 0.035, finialC, finialD, crossY + 0.04);
    }

    /* -------------------- 3D 护盾 — 圆盘底座+A型支架+盾牌+金框+铆钉 -------------------- */
    function drawShieldBlock3D(wx, wz, orientation, baseColor, liteColor){
      var isRed = (baseColor === "#cc2020");
      var goldC = isRed ? "#ffd700" : "#c0c0c0";
      var goldD = isRed ? "#daa520" : "#808080";
      var segs = 10;

      // 1. 圆盘底座
      function drawCyl(cy, r, h, color, topC) {
        var bProj = [], bFaces = [];
        for (var i = 0; i < segs; i++) {
          var a = (i / segs) * Math.PI * 2;
          bProj.push(project3D(wx + Math.cos(a) * r, cy, wz + Math.sin(a) * r));
        }
        for (var j = 0; j < segs; j++) {
          var a2 = (j / segs) * Math.PI * 2;
          bProj.push(project3D(wx + Math.cos(a2) * r, cy + h, wz + Math.sin(a2) * r));
        }
        for (var k = 0; k < segs; k++) {
          var ni = (k + 1) % segs;
          var shade = 0.35 + 0.35 * Math.abs(Math.cos((k / segs) * Math.PI * 2));
          bFaces.push({ v: [k, ni, ni + segs, k + segs], c: darkenColor(color, shade * 0.6), stroke: "rgba(0,0,0,0.2)", lw: 0.5 });
        }
        var topV = [];
        for (var m = 0; m < segs; m++) topV.push(m + segs);
        bFaces.push({ v: topV, c: topC, stroke: "rgba(0,0,0,0.3)", lw: 1 });
        draw3DFaces(bFaces, bProj);
      }
      var baseR = 0.34, baseH = 0.05;
      drawCyl(0, baseR, baseH, darkenColor(baseColor, 0.4), darkenColor(baseColor, 0.5));

      // 2. A型支架（后方两根斜撑）
      var dx = DX[orientation], dz = DY[orientation];
      var perpX = -dz, perpZ = dx;
      var thick = 0.05;
      var halfW = 0.22;
      var shieldH = 0.48;
      var shieldY = baseH;
      var standOff = 0.14;

      var standW = 0.04, standD = 0.04;
      var standH = shieldH * 0.7;
      var lsx = wx + dx * standOff - perpX * halfW * 0.5;
      var lsz = wz + dz * standOff - perpZ * halfW * 0.5;
      draw3DBox(lsx, lsz, standW, standD, standH, goldD, darkenColor(goldD, 0.5), baseH);
      var rsx = wx + dx * standOff + perpX * halfW * 0.5;
      var rsz = wz + dz * standOff + perpZ * halfW * 0.5;
      draw3DBox(rsx, rsz, standW, standD, standH, goldD, darkenColor(goldD, 0.5), baseH);

      // 3. 竖立盾牌（heater shield 形状）
      var outline = [
        [-halfW,       shieldH],
        [ halfW,       shieldH],
        [ halfW * 0.82, shieldH * 0.5],
        [ 0,           0],
        [-halfW * 0.82, shieldH * 0.5]
      ];

      var proj = [];
      for (var fi = 0; fi < 5; fi++) {
        var lx = outline[fi][0], ly = outline[fi][1];
        var px = wx + lx * perpX + (thick * 0.5) * dx;
        var pz = wz + lx * perpZ + (thick * 0.5) * dz;
        proj.push(project3D(px, shieldY + ly, pz));
      }
      for (var bi2 = 0; bi2 < 5; bi2++) {
        var lx2 = outline[bi2][0], ly2 = outline[bi2][1];
        var bx2 = wx + lx2 * perpX - (thick * 0.5) * dx;
        var bz2 = wz + lx2 * perpZ - (thick * 0.5) * dz;
        proj.push(project3D(bx2, shieldY + ly2, bz2));
      }

      var silverC = "rgba(225,230,245,0.95)";
      var silverD = "#778";
      var faces = [
        {v:[0,1,2,3,4], c:silverC, stroke:"rgba(0,0,0,0.3)", lw:1.5},
        {v:[5,9,8,7,6], c:darkenColor(silverD, 0.5), stroke:"rgba(0,0,0,0.3)", lw:1},
        {v:[0,5,6,1], c:darkenColor(silverD, 0.7), stroke:"rgba(0,0,0,0.3)", lw:1},
        {v:[1,6,7,2], c:darkenColor(silverD, 0.6), stroke:"rgba(0,0,0,0.3)", lw:1},
        {v:[2,7,8,3], c:darkenColor(silverD, 0.5), stroke:"rgba(0,0,0,0.3)", lw:1},
        {v:[3,8,9,4], c:darkenColor(silverD, 0.4), stroke:"rgba(0,0,0,0.3)", lw:1},
        {v:[4,9,5,0], c:darkenColor(silverD, 0.6), stroke:"rgba(0,0,0,0.3)", lw:1},
      ];
      draw3DFaces(faces, proj);

      // 4. 金色边框
      ctx.strokeStyle = goldC;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(proj[0].x, proj[0].y);
      for (var gi = 1; gi < 5; gi++) ctx.lineTo(proj[gi].x, proj[gi].y);
      ctx.closePath();
      ctx.stroke();

      // 5. 中央铆钉
      var bossOff = thick * 0.5 + 0.01;
      draw3DBox(
        wx + dx * bossOff, wz + dz * bossOff,
        0.10, 0.10, 0.08,
        goldC, goldD,
        shieldY + shieldH * 0.35
      );
    }

    function drawIconKing(){
      // 城堡塔楼造型：城墙底座 + 塔楼 + 城垛 + 顶部十字宝石
      var r = 0.24;
      // 底座（略宽）
      ctx.fillStyle = "#daa520";
      ctx.strokeStyle = "#8b6914";
      ctx.lineWidth = 0.018;
      ctx.beginPath();
      ctx.moveTo(-r*0.85, r*0.85);
      ctx.lineTo(r*0.85, r*0.85);
      ctx.lineTo(r*0.7, r*0.55);
      ctx.lineTo(-r*0.7, r*0.55);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // 塔楼主体
      ctx.fillStyle = "#ffd700";
      ctx.beginPath();
      ctx.moveTo(-r*0.6, r*0.55);
      ctx.lineTo(r*0.6, r*0.55);
      ctx.lineTo(r*0.6, -r*0.15);
      ctx.lineTo(-r*0.6, -r*0.15);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // 城垛（顶部齿状）
      ctx.fillStyle = "#ffd700";
      var mw = r*0.2, gap = r*0.1;
      for(var i=0; i<3; i++){
        var mx = -r*0.6 + i*(mw*2+gap);
        ctx.beginPath();
        ctx.moveTo(mx, -r*0.15);
        ctx.lineTo(mx+mw, -r*0.15);
        ctx.lineTo(mx+mw, -r*0.35);
        ctx.lineTo(mx, -r*0.35);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      // 城门
      ctx.fillStyle = "#5a3e08";
      ctx.beginPath();
      ctx.moveTo(-r*0.15, r*0.55);
      ctx.lineTo(-r*0.15, r*0.3);
      ctx.arc(0, r*0.3, r*0.15, Math.PI, 0);
      ctx.lineTo(r*0.15, r*0.55);
      ctx.closePath();
      ctx.fill();
      // 顶部十字 + 宝石
      ctx.strokeStyle = "#ff4444";
      ctx.lineWidth = 0.035;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, -r*0.35); ctx.lineTo(0, -r*0.75);
      ctx.moveTo(-r*0.12, -r*0.55); ctx.lineTo(r*0.12, -r*0.55);
      ctx.stroke();
      ctx.fillStyle = "#ff2244";
      ctx.beginPath(); ctx.arc(0, -r*0.78, r*0.08, 0, 6.283); ctx.fill();
      // 高光
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(-r*0.55, -r*0.12, r*0.2, r*0.6);
    }

    function drawIconLaser(orientation){
      // 圆柱炮台造型：底座圆环 + 镜筒 + 发射口光晕
      ctx.save();
      ctx.rotate(orientation * Math.PI / 2);
      var r = 0.22;
      // 底座圆环
      ctx.fillStyle = "#2a2a3e";
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 0.02;
      ctx.beginPath(); ctx.arc(0, r*0.2, r*0.7, 0, 6.283); ctx.fill(); ctx.stroke();
      // 镜筒（矩形炮管）
      ctx.fillStyle = "#3a3a4e";
      ctx.strokeStyle = "#666";
      ctx.lineWidth = 0.018;
      ctx.beginPath();
      ctx.moveTo(-r*0.2, -r*0.6);
      ctx.lineTo(r*0.2, -r*0.6);
      ctx.lineTo(r*0.2, r*0);
      ctx.lineTo(-r*0.2, r*0);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // 发射口光晕
      var g = ctx.createRadialGradient(0, -r*0.6, 0, 0, -r*0.6, r*0.35);
      g.addColorStop(0, "rgba(255,255,200,1)");
      g.addColorStop(0.5, "rgba(255,180,50,0.6)");
      g.addColorStop(1, "rgba(255,100,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, -r*0.6, r*0.35, 0, 6.283); ctx.fill();
      // 发射口核心
      ctx.fillStyle = "#fffbe6";
      ctx.beginPath(); ctx.arc(0, -r*0.6, r*0.1, 0, 6.283); ctx.fill();
      // 方向箭头
      ctx.strokeStyle = "rgba(255,225,77,0.9)";
      ctx.lineWidth = 0.03;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, -r*0.7); ctx.lineTo(0, -r*0.95);
      ctx.moveTo(-r*0.08, -r*0.85); ctx.lineTo(0, -r*0.95); ctx.lineTo(r*0.08, -r*0.85);
      ctx.stroke();
      ctx.restore();
    }

    function drawIconShield(orientation){
      // 盾牌造型：弧面盾 + 加厚防面 + 中心铆钉
      ctx.save();
      ctx.rotate(orientation * Math.PI / 2);
      var r = 0.22;
      // 盾牌主体
      ctx.fillStyle = "rgba(220,225,240,0.92)";
      ctx.strokeStyle = "rgba(40,50,70,0.8)";
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      ctx.moveTo(-r*0.75, -r*0.55);
      ctx.lineTo(r*0.75, -r*0.55);
      ctx.lineTo(r*0.75, r*0.2);
      ctx.quadraticCurveTo(r*0.75, r*0.7, 0, r*0.8);
      ctx.quadraticCurveTo(-r*0.75, r*0.7, -r*0.75, r*0.2);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // 加厚防护面（顶部条带，表示挡面方向）
      ctx.fillStyle = "rgba(60,80,120,0.85)";
      ctx.beginPath();
      ctx.moveTo(-r*0.75, -r*0.55);
      ctx.lineTo(r*0.75, -r*0.55);
      ctx.lineTo(r*0.75, -r*0.3);
      ctx.lineTo(-r*0.75, -r*0.3);
      ctx.closePath();
      ctx.fill();
      // 防护面铆钉
      ctx.fillStyle = "rgba(180,200,230,0.9)";
      for(var i=0; i<3; i++){
        ctx.beginPath();
        ctx.arc(-r*0.45+i*r*0.45, -r*0.42, r*0.05, 0, 6.283);
        ctx.fill();
      }
      // 中心十字纹章
      ctx.strokeStyle = "rgba(60,80,120,0.7)";
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.moveTo(0, -r*0.2); ctx.lineTo(0, r*0.4);
      ctx.moveTo(-r*0.25, r*0.1); ctx.lineTo(r*0.25, r*0.1);
      ctx.stroke();
      // 高光
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.beginPath();
      ctx.moveTo(-r*0.65, -r*0.5);
      ctx.lineTo(-r*0.3, -r*0.5);
      ctx.lineTo(-r*0.3, r*0.3);
      ctx.quadraticCurveTo(-r*0.5, r*0.5, -r*0.65, r*0.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function drawIconMirror(orientation){
      // 三棱镜造型：直角三角形，斜边为镜面（亮银色+反光线），其余两边为暗背板
      var r = 0.24;
      var TL={x:-r,y:-r}, TR={x:r,y:-r}, BL={x:-r,y:r}, BR={x:r,y:r};
      var tri, m1, m2, dark1, dark2;
      // orientation 0,2 = "/" 镜面 (BL→TR)
      // orientation 1,3 = "\" 镜面 (TL→BR)
      if(orientation===0){ // "/" 厚端在SE(BR)
        tri=[BL,TR,BR]; m1=BL; m2=TR; dark1=[BL,BR]; dark2=[BR,TR];
      } else if(orientation===1){ // "\" 厚端在SW(BL)
        tri=[TL,BR,BL]; m1=TL; m2=BR; dark1=[TL,BL]; dark2=[BL,BR];
      } else if(orientation===2){ // "/" 厚端在NW(TL)
        tri=[BL,TR,TL]; m1=BL; m2=TR; dark1=[BL,TL]; dark2=[TL,TR];
      } else { // "\" 厚端在NE(TR)
        tri=[TL,BR,TR]; m1=TL; m2=BR; dark1=[TL,TR]; dark2=[TR,BR];
      }
      // 暗背板填充
      ctx.fillStyle = "rgba(35,40,55,0.92)";
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 0.018;
      ctx.beginPath();
      ctx.moveTo(tri[0].x, tri[0].y);
      ctx.lineTo(tri[1].x, tri[1].y);
      ctx.lineTo(tri[2].x, tri[2].y);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // 镜面（斜边）：亮银色粗线 + 反光高亮
      ctx.strokeStyle = "rgba(180,230,255,0.95)";
      ctx.lineWidth = 0.08;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(m1.x,m1.y); ctx.lineTo(m2.x,m2.y); ctx.stroke();
      // 镜面高光线（内侧细线）
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 0.03;
      ctx.beginPath(); ctx.moveTo(m1.x,m1.y); ctx.lineTo(m2.x,m2.y); ctx.stroke();
      // 反光斜线（3条短斜线表示镜面光泽）
      var dx = m2.x-m1.x, dy = m2.y-m1.y;
      var len = Math.sqrt(dx*dx+dy*dy);
      var nx = -dy/len, ny = dx/len; // 法线方向
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 0.015;
      for(var i=1; i<=3; i++){
        var t = i*0.25;
        var px = m1.x+dx*t, py = m1.y+dy*t;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - nx*r*0.12, py - ny*r*0.12);
        ctx.stroke();
      }
    }

    function drawIconSwitch(orientation){
      // 双面镜造型：菱形，两条对角线均为镜面
      var r = 0.22;
      var slash = (orientation%2===0); // true="/", false="\"
      // 菱形外形
      ctx.fillStyle = "rgba(60,70,90,0.85)";
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 0.018;
      ctx.beginPath();
      ctx.moveTo(0, -r*1.1);
      ctx.lineTo(r*1.1, 0);
      ctx.lineTo(0, r*1.1);
      ctx.lineTo(-r*1.1, 0);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // 两条镜面线（双面反射）
      ctx.strokeStyle = "rgba(180,230,255,0.95)";
      ctx.lineWidth = 0.07;
      ctx.lineCap = "round";
      if(slash){
        // "/" 方向
        ctx.beginPath();
        ctx.moveTo(-r*0.9, r*0.5); ctx.lineTo(r*0.9, -r*0.5);
        ctx.stroke();
      } else {
        // "\" 方向
        ctx.beginPath();
        ctx.moveTo(-r*0.9, -r*0.5); ctx.lineTo(r*0.9, r*0.5);
        ctx.stroke();
      }
      // 镜面高光
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 0.025;
      if(slash){
        ctx.beginPath();
        ctx.moveTo(-r*0.9, r*0.5); ctx.lineTo(r*0.9, -r*0.5);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(-r*0.9, -r*0.5); ctx.lineTo(r*0.9, r*0.5);
        ctx.stroke();
      }
      // 双面标识：两侧各画短反光线
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 0.012;
      var pts = slash ? [[-r*0.4,r*0.2],[r*0.4,-r*0.2]] : [[-r*0.4,-r*0.2],[r*0.4,r*0.2]];
      for(var i=0; i<pts.length; i++){
        var px = pts[i][0], py = pts[i][1];
        ctx.beginPath();
        ctx.arc(px, py, r*0.06, 0, 6.283);
        ctx.stroke();
      }
    }

    /* -------------------- 3D 棋子渲染 -------------------- */
    function drawPieces3D(){
      var drawList = [];
      for(var i=0;i<G.pieces.length;i++){
        var p = G.pieces[i];
        if(!p.alive) continue;
        var pose = visualPose(p);
        var wx = pose.col - (COLS-1)/2;
        var wz = pose.row - (ROWS-1)/2;
        var proj = project3D(wx, pose.height, wz);
        drawList.push({ piece:p, pose:pose, depth:proj.z });
      }
      drawList.sort(function(a,b){ return b.depth - a.depth; });
      for(var j=0;j<drawList.length;j++){
        drawPiece3D(drawList[j].piece, drawList[j].pose);
      }
    }

    function visualPose(piece){
      var pose = {
        row:piece.row, col:piece.col, height:0,
        orientation:piece.orientation
      };
      var sample = sampleAiAnimation(G.aiAnim);
      var pi = G.pieces.indexOf(piece);
      if(sample && sample.poses && sample.poses[pi]) return sample.poses[pi];
      return pose;
    }

    function drawPiece3D(p, pose){
      pose = pose || visualPose(p);
      var wx = pose.col - (COLS-1)/2;
      var wz = pose.row - (ROWS-1)/2;
      var pw = 0.72, pd = 0.72;
      var ph = pieceHeight(p.type);
      var base = ownerColor(p.owner, false);
      var lite = ownerColor(p.owner, true);

      drawShadow3D(wx, wz, pw, pd);
      pieceDrawPose = {
        x:wx, z:wz, height:pose.height,
        angle:(pose.orientation - p.orientation) * Math.PI / 2
      };

      try {
        // 镜子和双面镜使用3D棱柱造型
        if(p.type === MIRROR){
        drawMirrorPrism3D(wx, wz, p.orientation, base, lite);
        return;
        }
        if(p.type === SWITCH){
        drawSwitchPrism3D(wx, wz, p.orientation, base, lite);
        return;
        }
        // 激光使用圆柱炮台造型
        if(p.type === LASER){
        drawLaserCylinder3D(wx, wz, p.orientation, base, lite);
        return;
        }
        // 国王使用3D塔楼造型（立起来）
        if(p.type === KING){
        drawKingTower3D(wx, wz, base, lite);
        return;
        }
        // 护盾使用3D墙壁造型（立起来）
        if(p.type === SHIELD){
        drawShieldBlock3D(wx, wz, p.orientation, base, lite);
        return;
        }
      } finally {
        pieceDrawPose = null;
      }
    }

    /* -------------------- 3D 激光束渲染 -------------------- */
    function beamTurns(path){
      if(!Array.isArray(path) || path.length < 3) return [];
      var turns = [];
      for(var i=1;i<path.length-1;i++){
        var prev = path[i-1], curr = path[i], next = path[i+1];
        if(!isBeamPoint(prev) || !isBeamPoint(curr) || !isBeamPoint(next)) return [];
        var dr1 = curr.r - prev.r, dc1 = curr.c - prev.c;
        var dr2 = next.r - curr.r, dc2 = next.c - curr.c;
        if((dr1 === 0 && dc1 === 0) || (dr2 === 0 && dc2 === 0)) continue;
        dr1 /= Math.abs(dr1) || 1; dc1 /= Math.abs(dc1) || 1;
        dr2 /= Math.abs(dr2) || 1; dc2 /= Math.abs(dc2) || 1;
        if(dr1 !== dr2 || dc1 !== dc2) turns.push({r:curr.r, c:curr.c});
      }
      return turns;
    }
    function isBeamPoint(point){
      return !!point && typeof point.r === "number" && typeof point.c === "number" &&
        isFinite(point.r) && isFinite(point.c);
    }

    function drawBeam3D(){
      if(!G.path || !Array.isArray(G.path) || G.path.length < 2) return;
      var prog = G.animT || 0;
      var n = G.path.length;
      var total = n - 1;
      var upto = prog * total;
      if(!isFinite(upto)) return;
      var beamH = 0.35;
      var pts = [];
      for(var i=0;i<n;i++){
        var wx = G.path[i].c - (COLS-1)/2;
        var wz = G.path[i].r - (ROWS-1)/2;
        pts.push(project3D(wx, beamH, wz));
      }
      ctx.save();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      var pulse = 0.88 + Math.sin(G.beamPulseT * 14) * 0.12;
      var glowW = Math.max(4, Math.min(6, 5 * pulse));
      var energyW = Math.max(2, Math.min(3, glowW * 0.55));
      ctx.globalAlpha = 0.22 * pulse;
      ctx.shadowColor = "rgba(255,130,40,0.8)"; ctx.shadowBlur = 8;
      ctx.strokeStyle = "#ff8a35"; ctx.lineWidth = glowW;
      beamPath3D(pts, upto); ctx.stroke();
      ctx.globalAlpha = 0.95 * pulse;
      ctx.shadowBlur = 0; ctx.strokeStyle = "#ffe14d"; ctx.lineWidth = energyW;
      beamPath3D(pts, upto); ctx.stroke();
      ctx.globalAlpha = 1; ctx.strokeStyle = "#fffbe6"; ctx.lineWidth = Math.max(1, Math.min(1.5, energyW * 0.5));
      beamPath3D(pts, upto); ctx.stroke();
      var head = beamHead3D(pts, upto);
      if(head){
        ctx.fillStyle = "#ffe14d";
        ctx.beginPath(); ctx.arc(head.x, head.y, Math.max(2, energyW * 1.2), 0, 6.283); ctx.fill();
        ctx.fillStyle = "#fffbe6";
        ctx.beginPath(); ctx.arc(head.x, head.y, Math.max(1, energyW * 0.55), 0, 6.283); ctx.fill();
      }
      drawBeamTurns3D(pts, beamTurns(G.path), upto, pulse, energyW);
      ctx.restore();
    }
    function beamHead3D(pts, upto){
      var idx = Math.floor(Math.max(0, Math.min(pts.length - 1, upto)));
      if(idx >= pts.length - 1) return pts[pts.length - 1];
      var frac = upto - idx, a = pts[idx], b = pts[idx+1];
      return {x:a.x + (b.x-a.x)*frac, y:a.y + (b.y-a.y)*frac};
    }
    function drawBeamTurns3D(pts, turns, upto, pulse, energyW){
      var life = Math.max(0, Math.min(1, upto - Math.floor(upto)));
      for(var i=0;i<turns.length;i++){
        var turn = turns[i], index = -1;
        for(var j=1;j<pts.length-1;j++){
          if(G.path[j].r === turn.r && G.path[j].c === turn.c){ index = j; break; }
        }
        if(index < 0 || upto < index) continue;
        var p = pts[index], alpha = Math.max(0, 1 - (upto - index) * 2) * pulse;
        if(alpha <= 0) continue;
        ctx.globalAlpha = alpha * 0.7;
        ctx.strokeStyle = "#ffe14d"; ctx.lineWidth = 1; ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.arc(p.x, p.y, energyW * (1.4 + life), 0, 6.283); ctx.stroke();
        for(var s=0;s<4;s++){
          var angle = s * Math.PI / 2 + G.beamPulseT * 9;
          ctx.beginPath(); ctx.moveTo(p.x + Math.cos(angle) * energyW, p.y + Math.sin(angle) * energyW);
          ctx.lineTo(p.x + Math.cos(angle) * energyW * 2.2, p.y + Math.sin(angle) * energyW * 2.2); ctx.stroke();
        }
      }
    }
    function beamPath3D(pts, upto){
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for(var i=0;i<pts.length-1;i++){
        if(upto >= i+1){
          ctx.lineTo(pts[i+1].x, pts[i+1].y);
        } else if(upto > i){
          var f = upto - i;
          ctx.lineTo(pts[i].x+(pts[i+1].x-pts[i].x)*f, pts[i].y+(pts[i+1].y-pts[i].y)*f);
          break;
        } else break;
      }
    }

    /* -------------------- 3D 闪烁特效 -------------------- */
    function drawFlash3D(){
      if(!G.flashPiece) return;
      if(G.flashN % 2 === 0){
        drawCellQuad3D(G.flashPiece.row, G.flashPiece.col, 0.006, "rgba(255,90,110,0.6)", null, 0);
      }
    }

    /* -------------------- 3D 粒子爆炸特效 -------------------- */
    function spawnExplosion3D(piece){
      var wx = piece.col - (COLS-1)/2;
      var wz = piece.row - (ROWS-1)/2;
      var ph = pieceHeight(piece.type) * 0.5;
      G.particles = [];
      var colors = ["#ffe14d","#ff6b3a","#ff4a4a","#fffbe6"];
      var n = 8;
      for(var i=0;i<n;i++){
        var theta = (i/n)*Math.PI*2 + Math.random()*0.5;
        var phi = Math.random()*Math.PI*0.5 + 0.2;
        var speed = 0.6 + Math.random()*0.8;
        G.particles.push({
          x: wx, y: ph, z: wz,
          vx: Math.cos(theta)*Math.sin(phi)*speed,
          vy: Math.cos(phi)*speed + 0.5,
          vz: Math.sin(theta)*Math.sin(phi)*speed,
          life: 0.3 + Math.random()*0.15,
          maxLife: 0.45,
          size: 1.5 + Math.random()*1.5,
          color: colors[Math.floor(Math.random()*colors.length)]
        });
      }
      // 中心闪光环（小）
      G.particles.push({
        x: wx, y: ph, z: wz, vx:0, vy:0, vz:0,
        life: 0.2, maxLife: 0.2, size: 12, color: "#fffbe6", ring: true
      });
      G.particleT = Date.now();
    }

    function updateParticles(dt){
      if(!G.particles || G.particles.length === 0) return;
      for(var i=G.particles.length-1;i>=0;i--){
        var p = G.particles[i];
        p.life -= dt;
        if(p.life <= 0){ G.particles.splice(i,1); continue; }
        if(!p.ring){
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          p.vy -= 4.0 * dt; // 重力
          p.vx *= 0.96;
          p.vz *= 0.96;
        }
      }
    }

    function drawParticles3D(){
      if(!G.particles || G.particles.length === 0) return;
      ctx.save();
      for(var i=0;i<G.particles.length;i++){
        var p = G.particles[i];
        var proj = project3D(p.x, Math.max(0, p.y), p.z);
        var alpha = Math.max(0, p.life / p.maxLife);
        if(p.ring){
          // 扩散光环
          var ringR = p.size * (1 - alpha) * 3 + p.size * 0.5;
          var g = ctx.createRadialGradient(proj.x, proj.y, 0, proj.x, proj.y, ringR);
          g.addColorStop(0, "rgba(255,251,230," + (alpha*0.8) + ")");
          g.addColorStop(0.5, "rgba(255,225,77," + (alpha*0.4) + ")");
          g.addColorStop(1, "rgba(255,90,58,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, ringR, 0, 6.283);
          ctx.fill();
        } else {
          // 粒子点
          var sz = p.size * proj.s * 0.8;
          sz = Math.max(1.5, sz);
          var g2 = ctx.createRadialGradient(proj.x, proj.y, 0, proj.x, proj.y, sz*2);
          g2.addColorStop(0, p.color);
          g2.addColorStop(0.4, p.color);
          g2.addColorStop(1, "rgba(255,100,50,0)");
          ctx.globalAlpha = alpha;
          ctx.fillStyle = g2;
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, sz*2, 0, 6.283);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, sz*0.6, 0, 6.283);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    /* -------------------- 按钮系统 -------------------- */
    var BUTTONS = [];
    var ONBOARD = [];
    function addBtn(label, fn, style, weight){
      BUTTONS.push({label:label, fn:fn, style:style||"", weight:Math.max(0.5,weight||1)});
    }
    function layoutButtons(){
      var areaY = SH - SAFE_BOT - btnAreaH;
      var rows = [], row = [];
      for(var i=0;i<BUTTONS.length;i++){
        row.push(BUTTONS[i]);
        if(row.length >= 4){ rows.push(row); row = []; }
      }
      if(row.length) rows.push(row);
      var y = areaY;
      for(var r=0;r<rows.length;r++){
        var n = rows[r].length;
        var totalW = SW - 24;
        var usableW = totalW - BTN_GAP*(n-1), totalWeight = 0;
        for(var wi=0;wi<n;wi++) totalWeight += rows[r][wi].weight || 1;
        var x = 12;
        for(var c=0;c<n;c++){
          var bw = usableW * (rows[r][c].weight || 1) / totalWeight;
          rows[r][c].x = x; rows[r][c].y = y; rows[r][c].w = bw; rows[r][c].h = BTN_H;
          x += bw + BTN_GAP;
        }
        y += BTN_H + BTN_GAP;
      }
    }
    function hitButton(x, y){
      for(var i=0;i<BUTTONS.length;i++){
        var b = BUTTONS[i];
        if(x>=b.x && x<=b.x+b.w && y>=b.y && y<=b.y+b.h) return b;
      }
      return null;
    }
    function drawButton(b){
      var fill = "#222b48", stroke = "#2e3a5e", txt = "#e8ecf5";
      if(b.style === "primary"){ fill = "#3da9fc"; stroke = "#3da9fc"; txt = "#06101f"; }
      if(b.style === "danger"){ fill = "#ff5a6e"; stroke = "#ff5a6e"; txt = "#2a0610"; }
      if(b.style === "ghost"){ fill = "rgba(34,43,72,0.6)"; }
      if(b.style === "turnEnd"){ fill = "rgba(245,216,110,0.12)"; stroke = "#f5d86e"; txt = "#f5d86e"; }
      if(b.style === "matchPrimary"){
        var actionBeam=ctx.createLinearGradient(b.x,b.y,b.x+b.w,b.y);
        actionBeam.addColorStop(0,"#e9f0ed");actionBeam.addColorStop(.72,"#dce9ea");actionBeam.addColorStop(1,"#bdeaff");
        ctx.fillStyle=actionBeam;ctx.beginPath();
        ctx.moveTo(b.x,b.y);ctx.lineTo(b.x+b.w-10,b.y);ctx.lineTo(b.x+b.w,b.y+10);
        ctx.lineTo(b.x+b.w,b.y+b.h);ctx.lineTo(b.x+10,b.y+b.h);ctx.lineTo(b.x,b.y+b.h-10);ctx.closePath();ctx.fill();
        ctx.strokeStyle="#f8ffff";ctx.lineWidth=1;ctx.stroke();
        ctx.fillStyle=ownerColor(G.current,true);ctx.fillRect(b.x,b.y,3,b.h);
        ctx.fillStyle="#0b151b";ctx.font="700 14px 'PingFang SC', sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
        ctx.fillText(b.label,b.x+b.w/2,b.y+b.h/2+1);
        return;
      }
      if(b.style === "matchGhost" || b.style === "matchTurnEnd"){
        ctx.fillStyle=b.style === "matchTurnEnd" ? "rgba(245,216,110,.10)" : "rgba(16,27,34,.92)";
        ctx.fillRect(b.x,b.y,b.w,b.h);
        ctx.strokeStyle=b.style === "matchTurnEnd" ? "#f5d86e" : "#415761";
        ctx.lineWidth=1;ctx.strokeRect(b.x+.5,b.y+.5,b.w-1,b.h-1);
        ctx.fillStyle=b.style === "matchTurnEnd" ? "#f5d86e" : "#b9c7ca";
        ctx.font="600 13px 'PingFang SC', sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
        ctx.fillText(b.label,b.x+b.w/2,b.y+b.h/2+1);
        return;
      }
      if(b.style === "setupGhost"){
        ctx.fillStyle = "rgba(15,23,28,0.94)";
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = "#52666f"; ctx.lineWidth = 1; ctx.strokeRect(b.x+0.5,b.y+0.5,b.w-1,b.h-1);
        ctx.fillStyle = "#b7c3c8"; ctx.font = "600 12px 'PingFang SC', sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(b.label, b.x+b.w/2, b.y+b.h/2+1);
        return;
      }
      if(b.style === "setupPrimary"){
        var cut = 11;
        var beam = ctx.createLinearGradient(b.x, b.y, b.x+b.w, b.y);
        beam.addColorStop(0, "#dce7e9"); beam.addColorStop(0.72, "#eef4f3"); beam.addColorStop(1, "#b8e8fb");
        ctx.fillStyle = beam; ctx.beginPath();
        ctx.moveTo(b.x,b.y);ctx.lineTo(b.x+b.w-cut,b.y);ctx.lineTo(b.x+b.w,b.y+cut);
        ctx.lineTo(b.x+b.w,b.y+b.h);ctx.lineTo(b.x+cut,b.y+b.h);ctx.lineTo(b.x,b.y+b.h-cut);ctx.closePath();ctx.fill();
        ctx.strokeStyle = "#f7ffff";ctx.lineWidth = 1;ctx.stroke();
        ctx.fillStyle = "#ff4d45";ctx.fillRect(b.x,b.y,3,b.h);
        ctx.fillStyle = "#55727e";ctx.font = "600 7px 'Arial Narrow', sans-serif";ctx.textAlign="left";ctx.textBaseline="middle";
        ctx.fillText(b.meta||"CALIBRATED",b.x+14,b.y+13);
        ctx.fillStyle = "#0d1519";ctx.font = "700 13px 'PingFang SC', sans-serif";ctx.textBaseline="middle";
        ctx.fillText(b.label,b.x+14,b.y+30);
        ctx.strokeStyle="#147daf";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(b.x+b.w-19,b.y+b.h/2-4);ctx.lineTo(b.x+b.w-14,b.y+b.h/2);ctx.lineTo(b.x+b.w-19,b.y+b.h/2+4);ctx.stroke();
        return;
      }
      ctx.fillStyle = fill;
      roundRect(b.x, b.y, b.w, b.h, 10); ctx.fill();
      ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = txt;
      ctx.font = "600 15px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(b.label, b.x + b.w/2, b.y + b.h/2 + 1);
    }

    /* -------------------- 棋盘上旋转按钮（3D投影位置） -------------------- */
    function buildOnBoardButtons3D(){
      ONBOARD = [];
      if(G.phase !== "move" || G.sel < 0 || G.busy || G.over) return;
      var p = G.pieces[G.sel];
      if(!p || !p.alive) return;
      var wx = p.col - (COLS-1)/2;
      var wz = p.row - (ROWS-1)/2;
      var ph = pieceHeight(p.type);
      var proj = project3D(wx, ph + 0.2, wz);
      var btnR = 20, spread = 34, offset = 38;
      if(p.type === LASER){
        ONBOARD.push({ cx:proj.x, cy:proj.y-offset, r:btnR, label:"\u21BB", fn:doLaserToggle });
      } else {
        ONBOARD.push({ cx:proj.x-spread, cy:proj.y-offset, r:btnR, label:"\u21BA", fn:function(){ doRotate(3); } });
        ONBOARD.push({ cx:proj.x+spread, cy:proj.y-offset, r:btnR, label:"\u21BB", fn:function(){ doRotate(1); } });
      }
    }
    function drawOnBoardButtons3D(){
      for(var i=0;i<ONBOARD.length;i++){
        var b = ONBOARD[i];
        var glow = ctx.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, b.r*1.8);
        glow.addColorStop(0, "rgba(108,193,255,0.4)");
        glow.addColorStop(1, "rgba(108,193,255,0)");
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(b.cx, b.cy, b.r*1.8, 0, 6.283); ctx.fill();
        ctx.fillStyle = "rgba(61,169,252,0.92)";
        ctx.strokeStyle = "#6bc1ff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(b.cx, b.cy, b.r, 0, 6.283); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.beginPath(); ctx.arc(b.cx-b.r*0.3, b.cy-b.r*0.3, b.r*0.4, 0, 6.283); ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "700 22px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(b.label, b.cx, b.cy + 1);
      }
    }
    function hitOnBoard3D(x, y){
      for(var i=0;i<ONBOARD.length;i++){
        var b = ONBOARD[i];
        var dx = x-b.cx, dy = y-b.cy;
        if(dx*dx+dy*dy <= (b.r+6)*(b.r+6)) return b;
      }
      return null;
    }

    /* -------------------- 主渲染 -------------------- */
    function render(){
      try {
        BUTTONS = [];
        ONBOARD = [];
        ctx.fillStyle = "#0a0e1a";
        ctx.fillRect(0, 0, SW, SH);

        if(G.screen === "setup"){
          renderSetup();
          if(G.modal) drawModal();
          return;
        }

        updateMatchCameraFit();
        drawBackground3D();
        drawTopBar();
        var webglDrawn = drawWebGLBoard();
        if(!webglDrawn){
          drawBoard3D();
          drawPieces3D();
          drawAiActionOverlay();
          if(G.flashN > 0 && G.flashPiece) drawFlash3D();
          if(G.particles && G.particles.length > 0) drawParticles3D();
          if(G.path && G.path.length > 1) drawBeam3D();
        } else if(G.actionNotice){
          ctx.fillStyle = "#ffe14d";
          ctx.font = "700 14px sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "top";
          ctx.fillText(G.actionNotice, SW/2, boardAreaTop + 4);
        }
        drawMatchBoardFrame();
        buildOnBoardButtons3D();
        drawOnBoardButtons3D();
        drawStatus();
        if(!G.modal){
          buildActionButtons();
          layoutButtons();
          for(var i=0;i<BUTTONS.length;i++) drawButton(BUTTONS[i]);
        }
        if(G.modal) drawModal();
      } catch(e) {
        console.error("3D渲染错误:", e);
      }
    }

    var SETUP_LAYOUT_HITS = [];
    var SETUP_DIFF_HITS = [];

    function drawSetupBackground(){
      var bg = ctx.createLinearGradient(0, 0, 0, SH);
      bg.addColorStop(0, "#11151b");
      bg.addColorStop(0.48, "#0d1117");
      bg.addColorStop(1, "#090c10");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, SW, SH);

      ctx.save();
      ctx.strokeStyle = "rgba(174,197,209,0.055)"; ctx.lineWidth = 1;
      for(var gx=16;gx<SW;gx+=24){ ctx.beginPath();ctx.moveTo(gx,0);ctx.lineTo(gx,SH);ctx.stroke(); }
      for(var gy=SAFE_TOP;gy<SH;gy+=24){ ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(SW,gy);ctx.stroke(); }
      ctx.restore();
    }

    function drawSetupHeader(){
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#a9c6d3"; ctx.font = "600 9px 'Arial Narrow', sans-serif";
      ctx.fillText("OPTICAL ARRAY / PRE-MATCH CALIBRATION", 16, SAFE_TOP + 8);
      ctx.fillStyle = "#f2eee5"; ctx.font = "800 24px 'PingFang SC', sans-serif";
      ctx.fillText("激光镭射象棋", 16, SAFE_TOP + 36);
      ctx.fillStyle = "#8998a1"; ctx.font = "11px 'PingFang SC', sans-serif";
      ctx.fillText("校准阵型与对手强度", 16, SAFE_TOP + 54);

      var railY = SAFE_TOP + 65, mid = SW * 0.58;
      var rail = ctx.createLinearGradient(16, railY, SW - 16, railY);
      rail.addColorStop(0, "#ff4d45"); rail.addColorStop(0.48, "#ff4d45");
      rail.addColorStop(0.52, "#62c8ff"); rail.addColorStop(1, "#62c8ff");
      ctx.strokeStyle = rail; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(16,railY); ctx.lineTo(SW-16,railY); ctx.stroke();
      ctx.fillStyle = "#f2eee5"; ctx.beginPath();
      ctx.moveTo(mid,railY-5);ctx.lineTo(mid+5,railY);ctx.lineTo(mid,railY+5);ctx.lineTo(mid-5,railY);ctx.closePath();ctx.fill();
      ctx.fillStyle = "#ff766f";ctx.font = "600 8px 'Arial Narrow', sans-serif";ctx.fillText("RED",16,railY-5);
      ctx.fillStyle = "#77d3ff";ctx.textAlign = "right";ctx.fillText("BLUE",SW-16,railY-5);
    }

    function drawPreviewFrame(setupY){
      var x=10, y=SAFE_TOP+75, w=SW-20, h=setupY-y-10;
      ctx.fillStyle = "rgba(12,18,23,0.64)"; roundRect(x,y,w,h,8);ctx.fill();
      ctx.strokeStyle = "rgba(124,159,174,0.46)";ctx.lineWidth=1;ctx.stroke();
      ctx.strokeStyle = "#dce5e7";ctx.lineWidth=1.5;
      var c=12;
      ctx.beginPath();ctx.moveTo(x,y+c);ctx.lineTo(x,y);ctx.lineTo(x+c,y);
      ctx.moveTo(x+w-c,y);ctx.lineTo(x+w,y);ctx.lineTo(x+w,y+c);
      ctx.moveTo(x,y+h-c);ctx.lineTo(x,y+h);ctx.lineTo(x+c,y+h);
      ctx.moveTo(x+w-c,y+h);ctx.lineTo(x+w,y+h);ctx.lineTo(x+w,y+h-c);ctx.stroke();
      ctx.fillStyle="rgba(8,12,16,0.78)";ctx.fillRect(x+1,y+1,112,18);
      ctx.fillStyle="#a9c6d3";ctx.font="600 8px 'Arial Narrow', sans-serif";ctx.textAlign="left";ctx.textBaseline="middle";
      ctx.fillText("LIVE FORMATION",x+8,y+10);
      ctx.fillStyle="#77d3ff";ctx.textAlign="right";ctx.fillText("BLUE VIEW",x+w-8,y+10);
    }

    function drawFormationRail(setupY){
      SETUP_LAYOUT_HITS = [];
      var L=LAYOUTS[G.layoutIdx], x0=24, x1=SW-24, railY=setupY+63;
      ctx.textAlign="left";ctx.textBaseline="alphabetic";
      ctx.fillStyle="#f2eee5";ctx.font="700 14px 'PingFang SC', sans-serif";
      ctx.fillText(L.name+" · "+L.en,16,setupY+14);
      ctx.fillStyle="#8998a1";ctx.font="10px 'PingFang SC', sans-serif";ctx.fillText(L.desc,16,setupY+30);
      ctx.fillStyle="#f2eee5";ctx.font="600 10px 'PingFang SC', sans-serif";ctx.fillText("选择阵型",16,setupY+48);
      ctx.fillStyle="#6f828b";ctx.font="600 8px 'Arial Narrow', sans-serif";ctx.fillText("FORMATION",70,setupY+48);
      ctx.textAlign="right";ctx.fillStyle="#66747d";ctx.fillText((G.layoutIdx+1)+" / "+LAYOUTS.length,SW-16,setupY+48);

      var beam=ctx.createLinearGradient(x0,railY,x1,railY);
      beam.addColorStop(0,"#ff4d45");beam.addColorStop(1,"#62c8ff");
      ctx.strokeStyle="rgba(125,151,163,0.44)";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(x0,railY);ctx.lineTo(x1,railY);ctx.stroke();
      ctx.strokeStyle=beam;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x0,railY);ctx.lineTo(x1,railY);ctx.stroke();
      for(var i=0;i<LAYOUTS.length;i++){
        var px=x0+(x1-x0)*i/(LAYOUTS.length-1), active=i===G.layoutIdx;
        SETUP_LAYOUT_HITS.push({x:px-28,y:railY-20,w:56,h:43,index:i});
        ctx.fillStyle=active?"#f5d86e":"#152027";ctx.strokeStyle=active?"#fff1ad":"#78909b";ctx.lineWidth=active?2:1;
        ctx.beginPath();
        if(active){ctx.moveTo(px,railY-7);ctx.lineTo(px+7,railY);ctx.lineTo(px,railY+7);ctx.lineTo(px-7,railY);ctx.closePath();}
        else ctx.arc(px,railY,3.5,0,6.283);
        ctx.fill();ctx.stroke();
        ctx.fillStyle=active?"#f2eee5":"#82919a";ctx.font=(active?"700 ":"500 ")+"10px 'PingFang SC', sans-serif";ctx.textAlign="center";ctx.textBaseline="top";
        ctx.fillText(LAYOUTS[i].name,px,railY+11);
      }
    }

    function drawDifficultySelector(setupY){
      SETUP_DIFF_HITS = [];
      var top=setupY+94, margin=16, gap=4, w=(SW-margin*2-gap*2)/3, h=34;
      ctx.fillStyle="#f2eee5";ctx.font="600 10px 'PingFang SC', sans-serif";ctx.textAlign="left";ctx.textBaseline="alphabetic";
      ctx.fillText("选择难度",margin,top);
      ctx.fillStyle="#6f828b";ctx.font="600 8px 'Arial Narrow', sans-serif";ctx.fillText("COMPUTER",70,top);
      ctx.fillStyle="#66747d";ctx.textAlign="right";ctx.fillText("开局后锁定",SW-margin,top);
      for(var i=0;i<DIFFICULTY_ORDER.length;i++){
        var level=DIFFICULTY_ORDER[i], x=margin+i*(w+gap), y=top+9, active=level===G.difficulty;
        SETUP_DIFF_HITS.push({x:x,y:y,w:w,h:h,level:level});
        ctx.fillStyle=active?"#dce7e9":"rgba(19,29,35,0.88)";ctx.fillRect(x,y,w,h);
        ctx.strokeStyle=active?"#f2eee5":"#344750";ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,w-1,h-1);
        ctx.fillStyle=active?"#0d1519":"#91a0a8";ctx.font=(active?"700 ":"500 ")+"12px 'PingFang SC', sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
        ctx.fillText(DIFFICULTY_LABEL[level],x+w/2,y+h/2+1);
        if(active){ctx.fillStyle=level==="hard"?"#ff4d45":"#39aeea";ctx.fillRect(x,y,w,2);}
      }
      ctx.fillStyle="#84939b";ctx.font="10px 'PingFang SC', sans-serif";ctx.textAlign="left";ctx.textBaseline="alphabetic";
      ctx.fillText(DIFFICULTY_DESC[G.difficulty],margin,top+58);
    }

    function renderSetup(){
      var setupY=Math.round(SH*0.55)+1;
      drawSetupBackground();
      drawSetupHeader();
      drawPreviewFrame(setupY);
      if(!drawWebGLBoard()){
        drawBoard3D();drawPieces3D();
        if(rendererMode==="loading"){
          ctx.fillStyle="rgba(8,12,16,0.82)";ctx.fillRect(12,boardAreaTop,SW-24,24);
          ctx.fillStyle="#a9c6d3";ctx.font="10px 'PingFang SC', sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
          ctx.fillText("正在校准 3D 阵型…",SW/2,boardAreaTop+12);
        }
      }
      drawFormationRail(setupY);
      drawDifficultySelector(setupY);
      var actionY=Math.min(setupY+199,SH-SAFE_BOT-48);
      buildSetupButtons(actionY);
      for(var i=0;i<BUTTONS.length;i++)drawButton(BUTTONS[i]);
    }

    function buildSetupButtons(actionY){
      var margin=16,gap=8,rulesW=104,startW=SW-margin*2-gap-rulesW;
      BUTTONS.push({x:margin,y:actionY,w:rulesW,h:46,label:"规则介绍",fn:openRules,style:"setupGhost"});
      BUTTONS.push({x:margin+rulesW+gap,y:actionY,w:startW,h:46,label:"开始游戏",meta:"CALIBRATION COMPLETE",fn:beginMatch,style:"setupPrimary"});
    }

    function handleDropdownClick(x,y){
      if(G.screen!=="setup")return false;
      for(var i=0;i<SETUP_LAYOUT_HITS.length;i++){
        var a=SETUP_LAYOUT_HITS[i];
        if(x>=a.x&&x<=a.x+a.w&&y>=a.y&&y<=a.y+a.h){selectLayout(a.index);return true;}
      }
      for(var j=0;j<SETUP_DIFF_HITS.length;j++){
        var d=SETUP_DIFF_HITS[j];
        if(x>=d.x&&x<=d.x+d.w&&y>=d.y&&y<=d.y+d.h){selectDifficulty(d.level);return true;}
      }
      return false;
    }

    function drawBackground3D(){
      var g = ctx.createLinearGradient(0, 0, 0, SH);
      g.addColorStop(0, "#111820");
      g.addColorStop(0.52, "#0c1218");
      g.addColorStop(1, "#090e13");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, SW, SH);
      ctx.save();
      ctx.strokeStyle="rgba(174,197,209,.045)";ctx.lineWidth=1;
      for(var gx=16;gx<SW;gx+=24){ctx.beginPath();ctx.moveTo(gx,0);ctx.lineTo(gx,SH);ctx.stroke();}
      for(var gy=SAFE_TOP;gy<SH;gy+=24){ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(SW,gy);ctx.stroke();}
      ctx.restore();
    }

    function drawTopBar(){
      var turnTxt = G.over ? "对局结束" : (G.current===0 ? "红方行动" : "蓝方行动");
      var col = G.over ? "#9aa3bd" : ownerColor(G.current, true);
      var x=14,y=SAFE_TOP+5,w=SW-28;
      ctx.fillStyle="rgba(12,20,26,.90)";ctx.fillRect(x,y,w,TOPBAR_H-10);
      ctx.strokeStyle="rgba(113,145,157,.42)";ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,w-1,TOPBAR_H-11);
      ctx.fillStyle="#76909a";ctx.font="600 8px 'Arial Narrow', sans-serif";ctx.textAlign="left";ctx.textBaseline="alphabetic";
      ctx.fillText("OPTICAL MATCH / LIVE ARRAY",x+10,y+12);
      ctx.fillStyle=col;ctx.font="800 18px 'PingFang SC', sans-serif";ctx.fillText(turnTxt,x+10,y+35);
      ctx.fillStyle="#71868f";ctx.font="600 8px 'Arial Narrow', sans-serif";ctx.textAlign="right";
      ctx.fillText((G.lockedDifficulty ? DIFFICULTY_LABEL[G.lockedDifficulty] : "")+"电脑 · 10 × 8",x+w-10,y+13);
      ctx.fillStyle="#aebdc1";ctx.font="500 10px 'PingFang SC', sans-serif";ctx.fillText(G.busy?"正在计算光路":"拖动棋盘可旋转视角",x+w-10,y+34);
      var railY=y+TOPBAR_H-15,mid=SW/2;
      var rail=ctx.createLinearGradient(x+10,railY,x+w-10,railY);
      rail.addColorStop(0,"#ff514a");rail.addColorStop(.48,"#ff514a");rail.addColorStop(.52,"#5ccbff");rail.addColorStop(1,"#5ccbff");
      ctx.strokeStyle=rail;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x+10,railY);ctx.lineTo(x+w-10,railY);ctx.stroke();
      var markerX=G.current===0?x+w*.27:x+w*.73;
      ctx.fillStyle=G.over?"#9aa3bd":"#e9f0ed";ctx.beginPath();ctx.moveTo(markerX,railY-5);ctx.lineTo(markerX+5,railY);ctx.lineTo(markerX,railY+5);ctx.lineTo(markerX-5,railY);ctx.closePath();ctx.fill();
      ctx.fillStyle="#ff7771";ctx.font="600 7px 'Arial Narrow', sans-serif";ctx.textAlign="left";ctx.fillText("RED",x+10,railY-4);
      ctx.fillStyle="#78d7ff";ctx.textAlign="right";ctx.fillText("BLUE",x+w-10,railY-4);
    }

    function drawMatchBoardFrame(){
      var x=10,y=boardAreaTop+8,w=SW-20,h=boardAreaBot-boardAreaTop-16,c=12;
      ctx.strokeStyle="rgba(207,224,227,.72)";ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(x,y+c);ctx.lineTo(x,y);ctx.lineTo(x+c,y);
      ctx.moveTo(x+w-c,y);ctx.lineTo(x+w,y);ctx.lineTo(x+w,y+c);
      ctx.moveTo(x,y+h-c);ctx.lineTo(x,y+h);ctx.lineTo(x+c,y+h);
      ctx.moveTo(x+w-c,y+h);ctx.lineTo(x+w,y+h);ctx.lineTo(x+w,y+h-c);ctx.stroke();
      ctx.fillStyle="rgba(9,14,19,.78)";ctx.fillRect(x+1,y+1,110,17);ctx.fillRect(x+w-92,y+1,91,17);
      ctx.fillStyle="#9eb2b9";ctx.font="600 7px 'Arial Narrow', sans-serif";ctx.textAlign="left";ctx.textBaseline="middle";
      ctx.fillText("TACTICAL FIELD / 10×8",x+7,y+9);
      ctx.fillStyle="#77d3ff";ctx.textAlign="right";ctx.fillText("BLUE ARRAY",x+w-7,y+9);
    }

    function drawStatus(){
      var y = SH - SAFE_BOT - btnAreaH - STATUS_H;
      var txt = "";
      var phaseLabel="READY";
      if(G.over){txt="本局已结束";phaseLabel="COMPLETE";}
      else if(G.busy){txt="电脑正在计算光路…";phaseLabel="COMPUTE";}
      else if(G.phase==="select"){txt=(G.mode==="pve"&&G.current===G.aiPlayer)?"":"选择棋子，或直接发射";phaseLabel="SELECT";}
      else if(G.phase==="move"){txt="移动到高亮格；棋子上方可旋转";phaseLabel="MOVE";}
      else if(G.phase==="fire"){txt="发射激光，或结束本回合";phaseLabel="FIRE";}
      ctx.fillStyle="rgba(14,23,29,.94)";ctx.fillRect(12,y+3,SW-24,STATUS_H-6);
      ctx.strokeStyle="#31444d";ctx.lineWidth=1;ctx.strokeRect(12.5,y+3.5,SW-25,STATUS_H-7);
      ctx.fillStyle=G.busy?"#f5d86e":ownerColor(G.current,true);ctx.fillRect(12,y+3,3,STATUS_H-6);
      ctx.fillStyle="#708790";ctx.font="600 8px 'Arial Narrow', sans-serif";ctx.textAlign="left";ctx.textBaseline="middle";ctx.fillText(phaseLabel,23,y+STATUS_H/2);
      ctx.fillStyle="#b9c7ca";ctx.font="500 11px 'PingFang SC', sans-serif";ctx.textAlign="right";ctx.fillText(txt,SW-22,y+STATUS_H/2);
    }

    /* -------------------- 按钮构建 -------------------- */
    function buildActionButtons(){
      if(G.screen !== "playing" || G.over || G.busy) return;
      if(G.phase === "move"){
        addBtn("取消选择", function(){ G.phase="select"; G.sel=-1; render(); }, "matchGhost", 1.15);
        addBtn("视角归位", resetView, "matchGhost", 0.85);
      }
      else if(G.phase === "fire"){
        addBtn("\u26A1 发射激光", fireLaser, "matchPrimary", 1.35);
        addBtn("回合结束", skipFire, "matchTurnEnd", 1.1);
        addBtn("撤销操作", undoAction, "matchGhost", 0.9);
        if(G.drawOffer) addBtn("接受平局", declareDraw, "matchGhost", 0.8);
      }
      else if(G.phase === "select" && !G.busy){
        if(!(G.mode==="pve" && G.current===G.aiPlayer)){
          addBtn("\u26A1 直接发射", directFire, "matchPrimary", 1.5);
        }
        addBtn("视角归位", resetView, "matchGhost", 0.85);
      }
    }

    /* -------------------- 移动目标 -------------------- */
    function moveTargets(p){
      var ts = [];
      if(p.type === LASER) return ts;
      for(var i=0;i<DIRS8.length;i++){
        var d = DIRS8[i];
        var nr = p.row + d[0], nc = p.col + d[1];
        if(nr<0 || nr>=ROWS || nc<0 || nc>=COLS) continue;
        if(!isZoneAllowed(nr, nc, p.owner)) continue; // 区域限制
        var t = pieceAt(G.pieces, nr, nc);
        if(!t) ts.push({r:nr, c:nc, swap:false});
        else if(p.type===SWITCH && (t.type===SHIELD || t.type===MIRROR)){
          if(isZoneAllowed(p.row, p.col, t.owner)) ts.push({r:nr, c:nc, swap:true}); // 被换棋子也不能进入禁区
        }
      }
      return ts;
    }

    /* -------------------- 动作执行 -------------------- */
    function enterMove(){ G.phase = "move"; render(); }
    function doRotate(d){
      var p = G.sel >= 0 ? G.pieces[G.sel] : null;
      if(!p) return;
      p.orientation = (p.orientation + d) % 4;
      G.phase = "fire"; render();
    }
    function doLaserToggle(){
      var p = G.sel >= 0 ? G.pieces[G.sel] : null;
      if(!p) return;
      var dirs = LASER_DIRS[p.owner];
      p.orientation = p.orientation === dirs[0] ? dirs[1] : dirs[0];
      G.phase = "fire"; render();
    }
    function skipFire(){
      G.path = null; G.eliminated = null; G.undoSnapshot = null;
      endTurn();
    }
    function directFire(){
      G.undoSnapshot = G.pieces.map(function(pp){ return Object.assign({}, pp); });
      G.phase = "fire";
      fireLaser();
    }
    function undoAction(){
      if(G.undoSnapshot){
        G.pieces = G.undoSnapshot;
        G.undoSnapshot = null;
      }
      G.phase = "select"; G.sel = -1; render();
    }

    /* -------------------- 视角重置 -------------------- */
    function resetView(){
      camAnim = { fy:cam.yaw, fp:cam.pitch, ty:DEFAULT_YAW, tp:DEFAULT_PITCH, t:0, dur:0.5 };
    }

    /* -------------------- 发射激光 -------------------- */
    function fireLaser(){
      if(G.phase !== "fire") return;
      var laser = getLaser(G.pieces, G.current);
      if(!laser){ endTurn(); return; }
      var sim;
      try { sim = simulateLaser(G.pieces, laser); }
      catch(e) { sim = { path:[{r:laser.row, c:laser.col}], eliminated:null }; }
      G.path = sim.path; G.eliminated = sim.eliminated; G.phase = "anim"; G.animT = 0; G.beamPulseT = 0; G.busy = true;
      render();
      var start = Date.now(), dur = Math.max(300, (G.path.length - 1) * 120);
      function step(){
        G.animT = Math.min(1, (Date.now() - start) / dur);
        try { render(); } catch(e) {}
        if(G.animT < 1) _setTrackTimeout(step, 16);
        else finishFire();
      }
      _setTrackTimeout(step, 16);
    }

    var _kingKilled = -1;
    function finishFire(){
      _kingKilled = -1;
      if(G.eliminated){
        G.eliminated.alive = false;
        if(G.eliminated.type === KING) _kingKilled = G.eliminated.owner;
        G.flashPiece = G.eliminated;
        G.flashN = 6;
        spawnExplosion3D(G.eliminated);
        flashLoop();
      } else { afterFire(); }
    }
    function flashLoop(){
      try { render(); } catch(e) {}
      G.flashN--;
      if(G.flashN > 0 || (G.particles && G.particles.length > 0)){
        _setTrackTimeout(flashLoop, 50);
      } else {
        G.flashPiece = null;
        afterFire();
      }
    }
    function afterFire(){
      if(_kingKilled >= 0){
        G.winner = 1 - _kingKilled;
        G.over = true; G.busy = false; G.phase = "over";
        _setTrackTimeout(function(){ G.modal = "win"; render(); }, 420);
        return;
      }
      recordState();
      _setTrackTimeout(function(){ G.path = null; endTurn(); }, 480);
    }
    function endTurn(){
      if(G.mode === "pve" && G.current !== G.aiPlayer){
        if(passiveHumanTurn(G.turnStartPieces,G.pieces,G.current))
          G.playerPassiveTurns=Math.min(3,G.playerPassiveTurns+1);
        else G.playerPassiveTurns=0;
      }
      G.current = 1 - G.current; G.sel = -1; G.phase = "select"; G.busy = false; G.undoSnapshot = null;
      G.turnStartPieces=G.pieces.map(copySnapshotValue);
      render();
      if(G.mode === "pve" && G.current === G.aiPlayer && !G.over) _setTrackTimeout(aiTurn, 360);
    }

    /* -------------------- AI 回合 -------------------- */
    function aiTurn(){
      if(G.over || G.screen !== "playing") return;
      G.busy = true; render();
      _setTrackTimeout(function(){
        var act;
        try { act = aiChoose(G.pieces, G.aiPlayer, G.lockedDifficulty, G.playerPassiveTurns); }
        catch(e) { G.busy = false; endTurn(); return; }
        applyAiAction(act);
      }, 420);
    }

    function boardCellName(row, col){
      return String.fromCharCode(65 + col) + (ROWS - row);
    }

    function commitAiAction(act){
      if(!act || act.kind === "skip") return true;
      var p = G.pieces[act.pi];
      if(!p) return false;
      if(act.kind === "rot") p.orientation = (p.orientation + act.d) % 4;
      else if(act.kind === "laserRot") p.orientation = act.dir;
      else if(act.kind === "move"){ p.row = act.r; p.col = act.c; }
      else if(act.kind === "swap"){
        var t = G.pieces[act.ti];
        if(!t) return false;
        var tr=t.row,tc=t.col;
        t.row=p.row;t.col=p.col; p.row=tr;p.col=tc;
      } else return false;
      return true;
    }

    function createAiAnimation(act){
      if(!act) throw new Error("missing AI action");
      if(act.kind === "skip"){
        return {action:copySnapshotValue(act), kind:"skip", t:0, duration:0.52};
      }
      var p = G.pieces[act.pi];
      if(!p) throw new Error("invalid AI piece");
      var anim = {
        action:copySnapshotValue(act), kind:act.kind, pi:act.pi, t:0,
        fromRow:p.row, fromCol:p.col, toRow:p.row, toCol:p.col,
        fromOrientation:p.orientation, toOrientation:p.orientation
      };
      if(act.kind === "move"){
        anim.toRow=act.r; anim.toCol=act.c; anim.duration=0.74;
      } else if(act.kind === "rot"){
        anim.toOrientation=(p.orientation+act.d)%4; anim.duration=0.68;
      } else if(act.kind === "laserRot"){
        anim.toOrientation=act.dir; anim.duration=0.68;
      } else if(act.kind === "swap"){
        var target = G.pieces[act.ti];
        if(!target) throw new Error("invalid AI swap target");
        anim.ti=act.ti; anim.targetRow=target.row; anim.targetCol=target.col;
        anim.targetOrientation=target.orientation;
        anim.toRow=target.row; anim.toCol=target.col; anim.duration=0.80;
      } else throw new Error("invalid AI action");
      return anim;
    }

    function sampleAiAnimation(anim){
      if(!anim) return null;
      var sample = {poses:{}, lead:false, landing:0};
      if(anim.kind === "skip") return sample;
      var motionEnd = anim.duration - 0.16;
      var mt = Math.max(0, Math.min(1, (anim.t - 0.16) / (motionEnd - 0.16)));
      var e = easeInOut(mt);
      var lift = Math.sin(Math.PI * mt) * 0.34;
      var orientationDelta = anim.toOrientation - anim.fromOrientation;
      if(orientationDelta > 2) orientationDelta -= 4;
      if(orientationDelta < -2) orientationDelta += 4;
      sample.lead = anim.t < 0.16;
      sample.landing = anim.t > motionEnd ?
        Math.max(0, 1 - (anim.t - motionEnd) / 0.16) : 0;
      sample.poses[anim.pi] = {
        row:anim.fromRow + (anim.toRow - anim.fromRow) * e,
        col:anim.fromCol + (anim.toCol - anim.fromCol) * e,
        height:(anim.kind === "move" || anim.kind === "swap") ? lift : 0,
        orientation:anim.fromOrientation + orientationDelta * e
      };
      if(anim.kind === "swap"){
        sample.poses[anim.ti] = {
          row:anim.targetRow + (anim.fromRow - anim.targetRow) * e,
          col:anim.targetCol + (anim.fromCol - anim.targetCol) * e,
          height:lift,
          orientation:anim.targetOrientation
        };
      }
      return sample;
    }

    function finishAiAnimation(anim){
      if(!anim.committed){
        anim.committed = true;
        commitAiAction(anim.action);
      }
      G.aiAnim = null;
      G.phase = "fire";
      try { render(); } catch(e) {}
      fireLaser();
    }

    function updateAiAnimation(dt){
      if(!G.aiAnim) return;
      var anim = G.aiAnim;
      try {
        anim.t += Math.max(0, dt || 0);
        sampleAiAnimation(anim);
        if(anim.t >= anim.duration) finishAiAnimation(anim);
        else render();
      } catch(e) {
        finishAiAnimation(anim);
      }
    }

    function drawAiActionOverlay(){
      var anim = G.aiAnim;
      if(!anim || !G.actionNotice) return;
      var sample = sampleAiAnimation(anim);
      if(anim.kind !== "skip"){
        if(sample.lead){
          drawAiRing(anim.fromRow, anim.fromCol, 0.95, 1);
          if(anim.kind === "swap") drawAiRing(anim.targetRow, anim.targetCol, 0.95, 1);
        }
        if(sample.landing){
          drawAiRing(anim.toRow, anim.toCol, sample.landing, 1.15 + (1-sample.landing)*0.35);
          if(anim.kind === "swap") drawAiRing(anim.fromRow, anim.fromCol,
            sample.landing, 1.15 + (1-sample.landing)*0.35);
        }
      }
      ctx.fillStyle = "#ffe14d";
      ctx.font = "700 14px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(G.actionNotice, SW/2, boardAreaTop + 4);
    }

    function applyAiAction(act){
      G.busy = true; G.sel = -1;
      try {
        G.aiAnim = createAiAnimation(act);
        if(act.kind === "move") G.actionNotice = "电脑移动：" +
          boardCellName(G.aiAnim.fromRow, G.aiAnim.fromCol) + " → " +
          boardCellName(G.aiAnim.toRow, G.aiAnim.toCol);
        else if(act.kind === "rot" || act.kind === "laserRot") G.actionNotice = "电脑旋转棋子";
        else if(act.kind === "swap") G.actionNotice = "电脑互换棋子";
        else G.actionNotice = "电脑选择直接发射";
        render();
      } catch(e) {
        commitAiAction(act);
        G.aiAnim = null; G.phase = "fire";
        fireLaser();
      }
    }

    /* -------------------- 平局 -------------------- */
    function declareDraw(){
      G.over = true; G.winner = -1; G.phase = "over";
      G.modal = "draw"; render();
    }

    /* -------------------- 弹窗 -------------------- */
    var rulesMaxScroll = 0;

    function drawModal(){
      if(G.modal === "rules"){
        drawRulesModal();
        return;
      }
      if(G.modal === "confirmReturn"){
        drawConfirmReturnModal();
        return;
      }
      ctx.fillStyle = "rgba(6,9,20,0.82)";
      ctx.fillRect(0, 0, SW, SH);
      var pw = Math.min(SW - 60, 320);
      var ph = 210;
      var px = (SW - pw) / 2;
      var py = (SH - ph) / 2;
      ctx.fillStyle = "#1a2138";
      roundRect(px, py, pw, ph, 16); ctx.fill();
      ctx.strokeStyle = "#2e3a5e"; ctx.lineWidth = 1; ctx.stroke();
      var title = "", sub = "";
      if(G.modal === "win"){
        title = (G.winner === 0 ? "红方" : "蓝方") + "获胜";
        sub = "激光命中对方国王，游戏结束。";
      } else if(G.modal === "draw"){
        title = "平局";
        sub = "相同局面出现三次，本局以平局结束。";
      } else return;
      ctx.fillStyle = "#e8ecf5";
      ctx.font = "700 22px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(title, px + pw/2, py + 55);
      ctx.fillStyle = "#9aa3bd";
      ctx.font = "14px sans-serif";
      var lines = sub.split("\n");
      for(var i=0;i<lines.length;i++) ctx.fillText(lines[i], px + pw/2, py + 95 + i*22);
      BUTTONS = [];
      BUTTONS.push({
        x: px + 40, y: py + ph - 56, w: pw - 80, h: BTN_H,
        label: "再来一局",
        fn: restartMatch,
        style: "primary"
      });
      for(var j=0;j<BUTTONS.length;j++) drawButton(BUTTONS[j]);
    }

    function drawRulesModal(){
      ctx.fillStyle = "rgba(6,9,20,0.9)";
      ctx.fillRect(0, 0, SW, SH);
      var px = 12, py = SAFE_TOP, pw = SW - 24, ph = SH - SAFE_TOP - SAFE_BOT;
      var bodyTop = py + 54, bodyBot = py + ph - 62;
      ctx.fillStyle = "#151c31";
      roundRect(px, py, pw, ph, 16); ctx.fill();
      ctx.strokeStyle = "#334263"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#f4f7ff";
      ctx.font = "700 20px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("规则介绍", SW/2, py + 28);

      var sections = [
        {title:"胜利条件", lines:["激光命中对方国王即获胜。", "国王被己方激光命中同样判负。"]},
        {title:"回合流程", lines:["每回合移动或旋转一枚己方棋子，", "随后发射激光；也可以直接发射。", "激光结算后轮到另一方行动。"]},
        {title:"五种棋子", lines:["激光炮：固定在角落，可切换发射方向。", "国王：被任意激光命中即结束对局。", "盾牌：正面挡光，其他方向会被消除。", "单面镜：反射正面来光，背面会被消除。", "双面镜：双向反射来光，本身不会被消除。"]},
        {title:"双面镜互换", lines:["双面镜可与相邻盾牌或单面镜互换，", "包括对方棋子。", "互换代替本回合的移动。"]},
        {title:"双方禁区", lines:["蓝方不能进入红色区域；", "红方不能进入白色区域。", "互换时，双面镜与被换棋子的落点", "都必须符合双方禁区规则。"]},
        {title:"三次重复", lines:["相同局面出现三次时，可以宣告平局。", "局面包含棋子位置、方向与当前行动方。"]}
      ];
      var contentH = 10;
      for(var n=0;n<sections.length;n++) contentH += 27 + sections[n].lines.length*21 + 9;
      rulesMaxScroll = Math.max(0, contentH - (bodyBot - bodyTop));
      G.rulesScroll = Math.max(0, Math.min(rulesMaxScroll, G.rulesScroll));

      ctx.save();
      ctx.beginPath();
      ctx.rect(px + 14, bodyTop, pw - 28, bodyBot - bodyTop);
      ctx.clip();
      var y = bodyTop + 10 - G.rulesScroll;
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      for(var i=0;i<sections.length;i++){
        ctx.fillStyle = "#6bc1ff";
        ctx.font = "700 15px sans-serif";
        ctx.fillText(sections[i].title, px + 20, y);
        y += 27;
        ctx.fillStyle = "#c5ccdc";
        ctx.font = "13px sans-serif";
        for(var j=0;j<sections[i].lines.length;j++){
          ctx.fillText(sections[i].lines[j], px + 20, y);
          y += 21;
        }
        y += 9;
      }
      ctx.restore();

      BUTTONS = [{x:px + 20, y:py + ph - 52, w:pw - 40, h:40,
        label:"关闭", fn:closeModal, style:"primary"}];
      drawButton(BUTTONS[0]);
    }

    function drawConfirmReturnModal(){
      ctx.fillStyle = "rgba(6,9,20,0.84)";
      ctx.fillRect(0, 0, SW, SH);
      var pw = Math.min(SW - 40, 340), ph = 220;
      var px = (SW - pw) / 2, py = (SH - ph) / 2;
      ctx.fillStyle = "#1a2138";
      roundRect(px, py, pw, ph, 16); ctx.fill();
      ctx.strokeStyle = "#4b5876"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#f4f7ff";
      ctx.font = "700 21px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("返回设置？", SW/2, py + 54);
      ctx.fillStyle = "#ff9ba7";
      ctx.font = "14px sans-serif";
      ctx.fillText("返回后当前对局进度将丢失。", SW/2, py + 94);
      var gap = 8, margin = 20, w = (pw - margin*2 - gap) / 2;
      BUTTONS = [
        {x:px+margin, y:py+ph-62, w:w, h:42,
          label:"继续对局", fn:closeModal, style:"ghost"},
        {x:px+margin+w+gap, y:py+ph-62, w:w, h:42,
          label:"确认返回", fn:confirmReturnToSetup, style:"danger"}
      ];
      for(var i=0;i<BUTTONS.length;i++) drawButton(BUTTONS[i]);
    }

    /* -------------------- 触摸：单指点击/拖动 + 双指旋转 -------------------- */
    // 单指轻点 = 点击棋子/按钮
    // 单指拖动（超过阈值）= 旋转视角（yaw/pitch）
    // 双指 = 旋转视角（yaw/pitch + 缩放）
    var touchMode = "none"; // "none" | "click" | "camera" | "drag" | "rules"
    var clickStart = { x:0, y:0 };
    var camGesture = { lastDist:0, lastMidY:0 };
    var lastDrag = { x:0, y:0 };
    var DRAG_THRESHOLD = 15; // 单指移动超过此距离判定为拖动视角

    function screenToCell(sx, sy){
      if(rendererMode === "ready" && webglRenderer){
        try { return webglRenderer.pick(sx, sy, webglCamera()); }
        catch(e){
          rendererMode = "fallback";
          webglRenderer.dispose(); webglRenderer = null; webglCanvas = null;
        }
      }
      var bestR = -1, bestC = -1, bestDist = Infinity, bestS = 1;
      for(var r=0;r<ROWS;r++){
        for(var c=0;c<COLS;c++){
          var wx = c - (COLS-1)/2;
          var wz = r - (ROWS-1)/2;
          var p = project3D(wx, 0, wz);
          var dx = sx-p.x, dy = sy-p.y;
          var d = dx*dx+dy*dy;
          if(d < bestDist){ bestDist = d; bestR = r; bestC = c; bestS = p.s; }
        }
      }
      if(Math.sqrt(bestDist) < Math.max(bestS * 0.85, 22)) return { r: bestR, c: bestC };
      return null;
    }

    function _getTouches(e){
      if(!e) return [];
      if(e.touches && e.touches.length) return e.touches;
      if(e.changedTouches && e.changedTouches.length) return e.changedTouches;
      return [];
    }

    function handleTouchStart(e){
      try {
        var ts = _getTouches(e);
        if(G.modal){
          if(ts.length === 1){
            touchMode = G.modal === "rules" ? "rules" : "click";
            clickStart.x = ts[0].clientX;
            clickStart.y = ts[0].clientY;
            lastDrag.x = ts[0].clientX;
            lastDrag.y = ts[0].clientY;
          } else touchMode = "none";
          return;
        }
        if(G.screen === "playing" && ts.length >= 2){
          touchMode = "camera";
          var t1 = ts[0], t2 = ts[1];
          camGesture.lastDist = Math.sqrt((t1.clientX-t2.clientX)*(t1.clientX-t2.clientX)+(t1.clientY-t2.clientY)*(t1.clientY-t2.clientY));
          camGesture.lastMidY = (t1.clientY+t2.clientY)/2;
        } else if(ts.length === 1){
          touchMode = "click";
          clickStart.x = ts[0].clientX;
          clickStart.y = ts[0].clientY;
          lastDrag.x = ts[0].clientX;
          lastDrag.y = ts[0].clientY;
        }
      } catch(err) {}
    }

    function handleTouchMove(e){
      try {
        var ts = _getTouches(e);
        if(touchMode === "rules" && ts.length === 1){
          var rulesDy = ts[0].clientY - lastDrag.y;
          G.rulesScroll = Math.max(0, Math.min(rulesMaxScroll, G.rulesScroll - rulesDy));
          lastDrag.x = ts[0].clientX;
          lastDrag.y = ts[0].clientY;
          render();
        } else if(G.screen === "playing" && touchMode === "camera" && ts.length >= 2){
          var t1 = ts[0], t2 = ts[1];
          var dist = Math.sqrt((t1.clientX-t2.clientX)*(t1.clientX-t2.clientX)+(t1.clientY-t2.clientY)*(t1.clientY-t2.clientY));
          var midY = (t1.clientY+t2.clientY)/2;
          // 双指捏合 → pitch（缩放视野角度）
          var dDist = dist - camGesture.lastDist;
          cam.pitch += dDist * 0.004;
          // 双指上下平移 → pitch
          cam.pitch -= (midY - camGesture.lastMidY) * 0.004;
          // 双指左右旋转 → yaw（用两指连线角度变化）
          var angle = Math.atan2(t2.clientY-t1.clientY, t2.clientX-t1.clientX);
          if(camGesture.lastAngle !== undefined){
            var dA = angle - camGesture.lastAngle;
            // 处理角度跨越π的情况
            if(dA > Math.PI) dA -= 2*Math.PI;
            if(dA < -Math.PI) dA += 2*Math.PI;
            cam.yaw += dA * 1.2;
          }
          camGesture.lastAngle = angle;
          cam.pitch = Math.max(0.2, Math.min(1.5, cam.pitch));
          cam.yaw = Math.max(-1.6, Math.min(1.6, cam.yaw));
          camGesture.lastDist = dist;
          camGesture.lastMidY = midY;
        } else if(touchMode === "click" && ts.length === 1){
          // 单指移动：超过阈值则切换为拖动模式
          var dx = ts[0].clientX - lastDrag.x;
          var dy = ts[0].clientY - lastDrag.y;
          var moveDist = Math.sqrt(dx*dx + dy*dy);
          if(G.screen === "playing" && moveDist > DRAG_THRESHOLD){
            touchMode = "drag";
          }
        } else if(G.screen === "playing" && touchMode === "drag" && ts.length === 1){
          // 单指拖动：旋转相机
          var ddx = ts[0].clientX - lastDrag.x;
          var ddy = ts[0].clientY - lastDrag.y;
          cam.yaw += ddx * 0.006;
          cam.pitch -= ddy * 0.005;
          cam.pitch = Math.max(0.2, Math.min(1.5, cam.pitch));
          cam.yaw = Math.max(-1.6, Math.min(1.6, cam.yaw));
          lastDrag.x = ts[0].clientX;
          lastDrag.y = ts[0].clientY;
        }
      } catch(err) {}
    }

    function handleTouchEnd(e){
      try {
        // 关键修复：直接检查 e.touches（当前屏幕上的活跃触摸点数量）
        var activeCount = (e && e.touches && e.touches.length) ? e.touches.length : 0;
        if(activeCount === 0 && touchMode === "rules"){
          touchMode = "none";
          var ruleTouches = (e && e.changedTouches) ? e.changedTouches : [];
          if(!ruleTouches.length) return;
          var ruleTouch = ruleTouches[0];
          var ruleMove = Math.sqrt((ruleTouch.clientX-clickStart.x)*(ruleTouch.clientX-clickStart.x)+
            (ruleTouch.clientY-clickStart.y)*(ruleTouch.clientY-clickStart.y));
          if(ruleMove <= 10) processClick(ruleTouch.clientX, ruleTouch.clientY);
          return;
        }
        if(activeCount === 0 && (touchMode === "click" || touchMode === "drag")){
          // 所有手指已抬起
          var wasDrag = (touchMode === "drag");
          touchMode = "none";
          if(wasDrag) return; // 拖动结束，不处理点击
          var changed = (e && e.changedTouches) ? e.changedTouches : [];
          if(!changed.length) return;
          var t = changed[0];
          var x = t.clientX, y = t.clientY;
          if(x === undefined || y === undefined) return;
          var move = Math.sqrt((x-clickStart.x)*(x-clickStart.x)+(y-clickStart.y)*(y-clickStart.y));
          if(move > 40) return;
          processClick(x, y);
        } else if(activeCount < 2){
          if(activeCount === 1){
            touchMode = "click";
            clickStart.x = e.touches[0].clientX;
            clickStart.y = e.touches[0].clientY;
            lastDrag.x = e.touches[0].clientX;
            lastDrag.y = e.touches[0].clientY;
            camGesture.lastAngle = undefined;
          } else {
            touchMode = "none";
          }
        }
      } catch(err) { console.error("touchEnd error:", err); }
    }

    // 外部相机控制（供调试页面鼠标右键拖动使用）
    function externalCameraControl(dx, dy){
      if(G.screen !== "playing" || G.modal === "rules") return;
      cam.yaw += dx * 0.006;
      cam.pitch -= dy * 0.005;
      cam.pitch = Math.max(0.2, Math.min(1.5, cam.pitch));
      cam.yaw = Math.max(-1.6, Math.min(1.6, cam.yaw));
    }

    function processClick(x, y){
      if(handleDropdownClick(x, y)) return;
      var btn = hitButton(x, y);
      if(btn && btn.fn){ btn.fn(); return; }
      if(G.modal || G.screen !== "playing") return;
      if(G.over || G.busy) return;
      if(G.mode === "pve" && G.current === G.aiPlayer) return;

      var ob = hitOnBoard3D(x, y);
      if(ob && ob.fn){ ob.fn(); return; }

      var cell = screenToCell(x, y);
      if(!cell) return;
      var r = cell.r, c = cell.c;

      if(G.phase === "select"){
        var p = pieceAt(G.pieces, r, c);
        if(p && p.owner === G.current){
          G.undoSnapshot = G.pieces.map(function(pp){ return Object.assign({}, pp); });
          G.sel = G.pieces.indexOf(p);
          G.phase = "move";
          render();
        }
      }
      else if(G.phase === "move"){
        var selP = G.pieces[G.sel];
        if(!selP){ G.phase = "select"; render(); return; }
        var tg = null;
        var targets = moveTargets(selP);
        for(var i=0;i<targets.length;i++){
          if(targets[i].r===r && targets[i].c===c){ tg = targets[i]; break; }
        }
        if(tg){
          if(tg.swap){ var tp = pieceAt(G.pieces, r, c); var tr2=tp.row,tc2=tp.col; tp.row=selP.row;tp.col=selP.col; selP.row=tr2;selP.col=tc2; }
          else { selP.row = r; selP.col = c; }
          G.phase = "fire"; render();
        } else {
          var np = pieceAt(G.pieces, r, c);
          if(np && np.owner === G.current && np !== selP){
            G.sel = G.pieces.indexOf(np);
            render();
          } else if(!np){ G.phase = "select"; G.sel = -1; render(); }
        }
      }
    }

    /* -------------------- 启动 -------------------- */
    enterSetup();
    initWebGLRenderer();

    /* -------------------- 模块接口 -------------------- */
    return {
      update: function(dt){
        G.beamPulseT += Math.max(0, dt || 0);
        if(camAnim){
          camAnim.t += dt / camAnim.dur;
          if(camAnim.t >= 1){
            cam.yaw = camAnim.ty;
            cam.pitch = camAnim.tp;
            camAnim = null;
          } else {
            var e = easeInOut(camAnim.t);
            cam.yaw = camAnim.fy + (camAnim.ty - camAnim.fy) * e;
            cam.pitch = camAnim.fp + (camAnim.tp - camAnim.fp) * e;
          }
        }
        updateAiAnimation(dt);
        updateParticles(dt);
      },
      render: function(){ render(); },
      onTouchStart: function(e){ handleTouchStart(e); },
      onTouchMove: function(e){ handleTouchMove(e); },
      onTouchEnd: function(e){ handleTouchEnd(e); },
      onBack: function(){
        if(G.screen !== "playing") return false;
        requestReturnToSetup();
        return true;
      },
      showBack: function(){
        return G.screen === "playing";
      },
      cameraControl: function(dx, dy){ externalCameraControl(dx, dy); },
      _debugAI: {
        choose: function(pieces, player, level, passiveTurns){ return aiChoose(pieces, player, level, passiveTurns); },
        config: function(level){ return Object.assign({}, AI_LEVELS[level] || AI_LEVELS.normal); },
        actions: function(pieces, player){ return generateActions(pieces, player); },
        resolve: function(pieces, player, action){ return resolveTurn(pieces, player, action); },
        initialPieces: function(layoutIndex){ return makeInitialPieces(layoutIndex); },
        getDifficulty: function(){ return G.difficulty; },
        passiveTurn: function(before,after,player){ return passiveHumanTurn(before,after,player); }
      },
      _debugGame: {
        snapshot: function(){
          return {
            screen:G.screen, layoutIdx:G.layoutIdx, difficulty:G.difficulty,
            lockedLayoutIdx:G.lockedLayoutIdx, lockedDifficulty:G.lockedDifficulty,
            rulesScroll:G.rulesScroll, modal:G.modal, busy:G.busy, actionNotice:G.actionNotice,
            current:G.current, phase:G.phase, sel:G.sel, mode:G.mode, aiPlayer:G.aiPlayer,
            animT:G.animT, over:G.over, winner:G.winner, drawOffer:G.drawOffer,
            flashN:G.flashN, particleT:G.particleT, playerPassiveTurns:G.playerPassiveTurns,
            rendererMode:rendererMode,
            camera:{yaw:cam.yaw, pitch:cam.pitch},
            webglCamera:webglCamera(),
            pieces:G.pieces.map(copySnapshotValue),
            aiAnim:copySnapshotValue(G.aiAnim)
          };
        },
        selectLayout: selectLayout,
        selectDifficulty: selectDifficulty,
        beginMatch: beginMatch,
        openRules: openRules,
        closeModal: closeModal,
        requestReturn: requestReturnToSetup,
        confirmReturn: confirmReturnToSetup
      },
      _debugEffects: {
        beamTurns: function(path){ return beamTurns(path).map(copySnapshotValue); },
        beginAiAction: applyAiAction,
        setPieces: function(pieces){ G.pieces = pieces.map(copySnapshotValue); },
        snapshot: function(){ return {
          pieces:G.pieces.map(copySnapshotValue),
          aiAnim:copySnapshotValue(G.aiAnim),
          actionNotice:G.actionNotice, busy:G.busy, phase:G.phase,
          timeoutCount:_timeouts.length
        }; }
      },
      exit: function(){
        rendererAlive = false;
        if(webglRenderer) webglRenderer.dispose();
        webglRenderer = null; webglCanvas = null;
        clearMatchVisualState();
      }
    };
  }
};
