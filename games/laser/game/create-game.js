// ============================================================
// 激光镭射象棋 Laser Chess —— 3D版
// 游戏合集模块包装版，3D透视渲染
// 棋盘 10×8，每方13枚棋子，5种官方阵型
// 手指拖动调整视角，游戏居中，安全区域适配
// ============================================================
var WebGLRenderer = require("../webgl-renderer.js");
var Constants = require("../config/constants.js");
var Formations = require("../config/formations.js");
var Rules = require("../core/rules.js");
var AI = require("../core/ai.js");
var Online = require("../online.js");

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
    var _sysInfo = null;
    try { _sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch(e) {}
    if(!_sysInfo){ try { _sysInfo = wx.getSystemInfoSync(); } catch(e2) {} }
    var _safeTop = 20, _safeBot = 0;
    if(_sysInfo){
      var _saTop = (_sysInfo.safeArea && typeof _sysInfo.safeArea.top === "number") ? _sysInfo.safeArea.top : 0;
      var _sbH = (typeof _sysInfo.statusBarHeight === "number") ? _sysInfo.statusBarHeight : 0;
      _safeTop = Math.max(_saTop, _sbH, 20);
      if(_sysInfo.safeArea){
        _safeBot = Math.max((_sysInfo.screenHeight || SH) - (_sysInfo.safeArea.bottom || SH), 0);
      }
    }
    // 微信菜单按钮（右上角胶囊）位置是最可靠的安全区域来源
    try {
      var _menuBtn = wx.getMenuButtonBoundingClientRect();
      if(_menuBtn && typeof _menuBtn.bottom === "number"){
        _safeTop = Math.max(_safeTop, _menuBtn.bottom + 4);
        console.log("[SafeArea] menuBtn.bottom=" + _menuBtn.bottom + " -> SAFE_TOP=" + _safeTop);
      }
    } catch(e) {}
    console.log("[SafeArea] safeArea.top=" + (_saTop||0) + " statusBarH=" + (_sbH||0) + " -> SAFE_TOP=" + _safeTop + " SAFE_BOT=" + _safeBot);
    var SAFE_TOP = _safeTop;
    var SAFE_BOT = Math.max(_safeBot, 0);
    var TOPBAR_H = 62;
    var BTN_H = 46;
    var BTN_GAP = 8;
    var STATUS_H = 34;
    var btnAreaH = BTN_H + 12;
    var boardAreaTop = SAFE_TOP + TOPBAR_H;
    var boardAreaBot = SH - SAFE_BOT - btnAreaH - STATUS_H;

    /* -------------------- 常量与方向 -------------------- */
    var COLS = Constants.BOARD.cols, ROWS = Constants.BOARD.rows;
    var UP = Constants.DIRECTION.UP, RIGHT = Constants.DIRECTION.RIGHT;
    var DOWN = Constants.DIRECTION.DOWN, LEFT = Constants.DIRECTION.LEFT;
    var DX = Constants.DX, DY = Constants.DY, DIRS8 = Constants.DIRS8;
    var LASER = Constants.PIECE.LASER, KING = Constants.PIECE.KING;
    var SHIELD = Constants.PIECE.SHIELD, MIRROR = Constants.PIECE.MIRROR;
    var SWITCH = Constants.PIECE.SWITCH;
    var RED_ZONES = Constants.ZONE_LOOKUP.red;
    var BLUE_ZONES = Constants.ZONE_LOOKUP.blue;
    var LASER_DIRS = Constants.LASER_DIRECTIONS;
    var AI_LEVELS = Constants.AI_LEVELS;
    var LAYOUTS = Formations.FORMATIONS;
    var makeInitialPieces = Formations.makeInitialPieces;
    var laserHit = Rules.laserHit;
    var pieceAt = Rules.pieceAt;
    var getLaser = Rules.getLaser;
    var simulateLaser = Rules.simulateLaser;
    var generateActions = Rules.generateActions;
    var applyAction = Rules.applyAction;
    var resolveTurn = Rules.resolveTurn;
    var isZoneAllowed = Rules.isZoneAllowed;
    var aiChoose = AI.choose;
    var passiveHumanTurn = AI.passiveTurn;

    /* -------------------- 3D 投影系统 -------------------- */
    // pitch=0 水平直视，pitch=π/2 正上方俯视
    // 0.95 ≈ 55°，匹配桌游图片的斜俯视角度
    // yaw=0 正对棋盘，无偏转
    var DEFAULT_YAW = 0;
    var DEFAULT_PITCH = 0.95;
    // 在线对战蓝方的主视角：棋盘绕Y轴旋转180°
    var homeYaw = DEFAULT_YAW;
    var SETUP_PITCH = 1.08;
    var MIN_MATCH_PITCH = 0.50;
    var MAX_MATCH_PITCH = 1.50;
    var MIN_MATCH_ZOOM = 0.72;
    var MAX_MATCH_ZOOM = 1.48;
    var cam = {
      yaw: DEFAULT_YAW,
      pitch: DEFAULT_PITCH,
      zoom: 1,
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
        var poseScale=Number.isFinite(pieceDrawPose.scale)?pieceDrawPose.scale:1;
        x = pieceDrawPose.x + (pdx * pcos - pdz * psin)*poseScale;
        z = pieceDrawPose.z + (pdx * psin + pdz * pcos)*poseScale;
        y = y*poseScale + pieceDrawPose.height;
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

    /* 规则、阵型与 AI 已拆分至 core/ 与 config/，此处仅负责编排。 */
    /* -------------------- 游戏状态 -------------------- */
    var DIFFICULTY_ORDER = Constants.DIFFICULTY.order;
    var DIFFICULTY_LABEL = Constants.DIFFICULTY.labels;
    var DIFFICULTY_DESC = Constants.DIFFICULTY.descriptions;
    var G = {
      pieces:[], current:0, phase:"select", sel:-1, mode:"pve", aiPlayer:1,
      difficulty:"normal", screen:"setup", lockedLayoutIdx:null, lockedDifficulty:null,
      rulesScroll:0, aiAnim:null, actionNotice:null,
      path:null, animT:0, beamPulseT:0, over:false, winner:-1, busy:false,
      history:{}, drawOffer:false, modal:null, flashN:0, flashPiece:null,
      eliminated:null, layoutIdx:0, undoSnapshot:null,
      particles:[], particleT:0, dropdownOpen:false, diffDropdownOpen:false,
      playerPassiveTurns:0, turnStartPieces:null, killAnim:null, resultAnim:null,
      onlineDisconnectReason:null,
      online:null, lastAction:null, onlinePendingFire:null,
      rpsMyChoice:null, rpsOpponentChoice:null, rpsResult:null,
      formationIdx:0
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
      var visualPose=copySnapshotValue(sampleAiAnimation(G.aiAnim));
      var killPose=sampleKillAnimation();
      if(killPose){
        if(!visualPose) visualPose={poses:{}};
        if(!visualPose.poses) visualPose.poses={};
        visualPose.poses[killPose.index]=killPose.pose;
      }
      return {
        pieces:G.pieces.map(copySnapshotValue),
        selected:G.sel,
        targets:targets.map(copySnapshotValue),
        path:G.path ? G.path.map(copySnapshotValue) : null,
        beamProgress:G.animT,
        beamPulse:G.beamPulseT,
        aiPose:visualPose,
        camera:webglCamera(),
        setup:(G.screen === "setup" || G.screen === "formation_select"),
        zoneCells:WebGLRenderer.zoneCells()
      };
    }

    function webglCamera(){
      var cos=Math.abs(Math.cos(cam.yaw)), sin=Math.abs(Math.sin(cam.yaw));
      var halfWidth=cos*5.65+sin*4.65;
      var referenceAspect=375/667;
      var screenAspect=SW/Math.max(SH,1);
      var tallScreenScale=Math.max(1,referenceAspect/screenAspect);
      var setupDistance=27*tallScreenScale;
      var matchBaseDistance=26*tallScreenScale;
      var matchDistance=Math.max(matchBaseDistance,matchBaseDistance*halfWidth/5.65);
      var isSetup = G.screen === "setup" || G.screen === "formation_select";
      var zoom=G.screen === "playing" ? Math.max(.72,Math.min(1.48,cam.zoom||1)) : 1;
      return {
        yaw:cam.yaw,
        pitch:cam.pitch,
        distance:isSetup ? setupDistance : matchDistance/zoom,
        offsetY:isSetup ? -90 : (boardAreaTop+boardAreaBot-SH)/2-7
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
      G.killAnim=null;
      G.resultAnim=null;
      ONBOARD=[];CONTROL_DOCK=null;
      G.undoSnapshot=null; G.particles=[]; G.particleT=0;
      G.aiAnim=null; G.actionNotice=null; camAnim=null;
      clearOnlineWatchdog();
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
      cam.yaw = 0; cam.pitch = SETUP_PITCH; cam.zoom=1;
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
      cam.yaw = homeYaw; cam.pitch = DEFAULT_PITCH; cam.zoom=1;
      cam.cx = SW / 2; cam.cy = (boardAreaTop + boardAreaBot) / 2;
      updateMatchCameraFit();
    }

    function constrainMatchCamera(){
      cam.zoom=Math.max(MIN_MATCH_ZOOM,Math.min(MAX_MATCH_ZOOM,cam.zoom||1));
      // A zoomed-out board needs a steeper minimum pitch; otherwise its plane
      // collapses into a thin strip and distant rows become visually hidden.
      var minimumPitch=MIN_MATCH_PITCH+Math.max(0,1-cam.zoom)*.30;
      cam.pitch=Math.max(minimumPitch,Math.min(MAX_MATCH_PITCH,cam.pitch));
      // 手势旋转限制在主视角±1.6rad内；蓝方主视角为π，同样可自由环视
      // 相机动画期间不钳制，避免开局180°旋转被边界截断
      if(!camAnim) cam.yaw=Math.max(homeYaw-1.6,Math.min(homeYaw+1.6,cam.yaw));
    }

    function updateMatchCameraFit(){
      constrainMatchCamera();
      var cos=Math.abs(Math.cos(cam.yaw)), sin=Math.abs(Math.sin(cam.yaw));
      var halfWidth=cos*5.65+sin*4.65;
      var base=Math.min(SW*.72,(boardAreaBot-boardAreaTop)*1.18)*cam.dist/10;
      cam.cx=SW/2; cam.cy=(boardAreaTop+boardAreaBot)/2;
      cam.focal=base*Math.min(1,5.65/halfWidth)*cam.zoom;
    }

    function enterSetup(){
      clearMatchVisualState();
      G.screen = "setup";
      G.lockedLayoutIdx = null;
      G.lockedDifficulty = null;
      G.dropdownOpen = false;
      G.diffDropdownOpen = false;
      rulesLongPress.active=false; rulesLongPress.triggered=false;
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
      homeYaw = DEFAULT_YAW;
      setMatchCamera();
      render();
    }

    function restartMatch(){
      if(G.screen !== "playing") return;
      resetMatchState(makeInitialPieces(G.lockedLayoutIdx));
      homeYaw = DEFAULT_YAW;
      setMatchCamera();
      render();
    }

    function selectLayout(index){
      if((G.screen !== "setup" && G.screen !== "formation_select") || typeof index !== "number" || index % 1 !== 0 || index < 0 || index >= LAYOUTS.length) return;
      G.layoutIdx = index;
      G.formationIdx = index;
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
      if(G.mode === "online"){
        if(!(G.online && G.online.simulated)){ try{ Online.leaveRoom(); }catch(e){} }
        G.online = null; G.mode = "pve";
      }
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
      var dying=sampleKillAnimation();
      if(dying && dying.index===pi) return dying.pose;
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
        angle:(pose.orientation - p.orientation) * Math.PI / 2,
        scale:Number.isFinite(pose.scale)?pose.scale:1
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
      var pulse = 0.94 + Math.sin(G.beamPulseT * 14) * 0.06;
      var glowW = Math.max(4, Math.min(5, 4.5 * pulse));
      var energyW = Math.max(2, Math.min(2.7, glowW * 0.54));
      ctx.globalAlpha = 0.10 * pulse;
      ctx.shadowColor = "rgba(101,217,255,0.72)"; ctx.shadowBlur = 12;
      ctx.strokeStyle = "#65d9ff"; ctx.lineWidth = glowW * 2.1;
      beamPath3D(pts, upto); ctx.stroke();
      ctx.globalAlpha = 0.34 * pulse;
      ctx.shadowColor = "rgba(255,72,39,0.78)"; ctx.shadowBlur = 6;
      ctx.strokeStyle = "#ff4727"; ctx.lineWidth = glowW;
      beamPath3D(pts, upto); ctx.stroke();
      ctx.globalAlpha = 0.94 * pulse;
      ctx.shadowBlur = 0; ctx.strokeStyle = "#ffb51f"; ctx.lineWidth = energyW;
      beamPath3D(pts, upto); ctx.stroke();
      ctx.globalAlpha = 1; ctx.strokeStyle = "#fffff1"; ctx.lineWidth = Math.max(1, Math.min(1.35, energyW * 0.46));
      beamPath3D(pts, upto); ctx.stroke();
      var head = beamHead3D(pts, upto);
      if(head){
        drawBeamHead3D(head,energyW,pulse);
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
    function drawBeamHead3D(head,energyW,pulse){
      var radius=Math.max(2.8,energyW*1.55)*pulse;
      var glow=ctx.createRadialGradient(head.x,head.y,0,head.x,head.y,radius*3);
      glow.addColorStop(0,"rgba(255,253,242,1)");
      glow.addColorStop(.18,"rgba(255,211,78,.98)");
      glow.addColorStop(.48,"rgba(255,71,39,.48)");
      glow.addColorStop(1,"rgba(101,217,255,0)");
      ctx.globalAlpha=1;ctx.fillStyle=glow;
      ctx.beginPath();ctx.arc(head.x,head.y,radius*3,0,6.283);ctx.fill();
      ctx.fillStyle="#fffff1";ctx.beginPath();ctx.arc(head.x,head.y,Math.max(1,radius*.28),0,6.283);ctx.fill();
    }
    function drawBeamAccents3D(){
      if(!G.path || G.path.length<2) return;
      var upto=(G.animT||0)*(G.path.length-1),pts=[],camera=webglCamera();
      for(var i=0;i<G.path.length;i++){
        if(!isBeamPoint(G.path[i])) return;
        pts.push(WebGLRenderer.projectPoint(G.path[i].r,G.path[i].c,.34,SW,SH,camera));
      }
      var pulse=.92+Math.sin(G.beamPulseT*15)*.08;
      ctx.save();ctx.lineCap="round";ctx.lineJoin="round";
      var head=webglBeamHead(G.path,G.animT,camera);
      if(head) drawBeamHead3D(head,2.4,pulse);
      drawBeamTurns3D(pts,beamTurns(G.path),upto,pulse,2.6);
      ctx.restore();
    }
    function webglBeamHead(path,progress,camera){
      if(!Array.isArray(path) || path.length<2) return null;
      for(var i=0;i<path.length;i++) if(!isBeamPoint(path[i])) return null;
      progress=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
      var upto=progress*(path.length-1);
      var index=Math.min(path.length-2,Math.floor(upto));
      var fraction=index===path.length-2 && upto>=path.length-1?1:upto-index;
      var a=path[index],b=path[index+1];
      return WebGLRenderer.projectPoint(
        a.r+(b.r-a.r)*fraction,a.c+(b.c-a.c)*fraction,.34,
        SW,SH,camera||webglCamera()
      );
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
        var radius=energyW*(2.2+life*.35);
        var glow=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,radius);
        glow.addColorStop(0,"rgba(255,255,241,"+(alpha*.96)+")");
        glow.addColorStop(.22,"rgba(255,181,31,"+(alpha*.78)+")");
        glow.addColorStop(.58,"rgba(255,71,39,"+(alpha*.32)+")");
        glow.addColorStop(1,"rgba(101,217,255,0)");
        ctx.globalAlpha=1;ctx.fillStyle=glow;ctx.shadowBlur=0;
        ctx.beginPath();ctx.arc(p.x,p.y,radius,0,6.283);ctx.fill();
        ctx.globalAlpha=alpha*.72;ctx.strokeStyle="#fff3b0";ctx.lineWidth=.8;
        ctx.beginPath();ctx.arc(p.x,p.y,energyW*(.72+life*.16),0,6.283);ctx.stroke();
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
      var ownerColor=piece.owner===0?"#ff4655":"#65d9ff";
      var colors = ["#ffd34e","#ff5a36",ownerColor,"#fffdf2"];
      var n = 14;
      for(var i=0;i<n;i++){
        var theta = (i/n)*Math.PI*2 + Math.random()*0.5;
        var phi = Math.random()*Math.PI*0.5 + 0.2;
        var speed = 0.6 + Math.random()*0.8;
        G.particles.push({
          x: wx, y: ph, z: wz,
          vx: Math.cos(theta)*Math.sin(phi)*speed,
          vy: Math.cos(phi)*speed + 0.5,
          vz: Math.sin(theta)*Math.sin(phi)*speed,
          life: 0.42 + Math.random()*0.2,
          maxLife: 0.62,
          size: 1.4 + Math.random()*1.8,
          color: colors[Math.floor(Math.random()*colors.length)]
        });
      }
      // 中心闪光环（小）
      G.particles.push({
        x: wx, y: ph, z: wz, vx:0, vy:0, vz:0,
        life: 0.34, maxLife: 0.34, size: 10, color: "#fffdf2", ring: true
      });
      G.particles.push({
        x: wx, y: ph, z: wz, vx:0, vy:0, vz:0,
        life: 0.55, maxLife: 0.55, size: 15, color: ownerColor, ring: true
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

    function startEliminationAnimation(piece){
      if(!piece) return;
      var index=G.pieces.indexOf(piece);
      G.killAnim={pieceIndex:index,row:piece.row,col:piece.col,owner:piece.owner,t:0,duration:.70};
      G.flashPiece=piece;G.flashN=6;
      spawnExplosion3D(piece);
    }

    function updateKillAnimation(dt){
      if(!G.killAnim) return;
      G.killAnim.t=Math.min(G.killAnim.duration,G.killAnim.t+Math.max(0,dt||0));
    }

    function sampleKillAnimation(){
      var anim=G.killAnim;
      if(!anim || anim.pieceIndex<0 || !G.pieces[anim.pieceIndex]) return null;
      var piece=G.pieces[anim.pieceIndex];
      var t=Math.max(0,Math.min(1,anim.t/anim.duration));
      var collapse=Math.max(0,Math.min(1,(t-.14)/.68));
      var eased=collapse*collapse*(3-2*collapse);
      return {index:anim.pieceIndex,progress:t,pose:{
        row:piece.row,col:piece.col,orientation:piece.orientation+.12*eased,
        height:.18*Math.sin(Math.PI*t)+.12*eased,
        scale:1-.92*eased
      }};
    }

    function drawEliminationImpact3D(){
      var sampled=sampleKillAnimation();
      if(!sampled) return;
      var anim=G.killAnim,t=sampled.progress;
      var center=project3D(anim.col-(COLS-1)/2,.48,anim.row-(ROWS-1)/2);
      var envelope=Math.sin(Math.PI*Math.min(1,t/.82));
      var owner=anim.owner===0?"255,70,85":"101,217,255";
      var radius=10+34*t;
      ctx.save();ctx.globalCompositeOperation="lighter";
      var glow=ctx.createRadialGradient(center.x,center.y,0,center.x,center.y,radius);
      glow.addColorStop(0,"rgba(255,253,242,"+(0.78*envelope)+")");
      glow.addColorStop(.28,"rgba(255,211,78,"+(0.52*envelope)+")");
      glow.addColorStop(.68,"rgba("+owner+","+(0.28*envelope)+")");
      glow.addColorStop(1,"rgba("+owner+",0)");
      ctx.fillStyle=glow;ctx.beginPath();ctx.arc(center.x,center.y,radius,0,6.283);ctx.fill();
      ctx.strokeStyle="rgba("+owner+","+(0.85*(1-t))+")";ctx.lineWidth=1.5;
      ctx.beginPath();ctx.arc(center.x,center.y,7+25*t,0,6.283);ctx.stroke();
      ctx.strokeStyle="rgba(255,253,242,"+(0.9*envelope)+")";ctx.lineWidth=1;
      for(var i=0;i<4;i++){
        var a=i*Math.PI/2+t*2.2,inner=5+8*t,outer=12+20*t;
        ctx.beginPath();ctx.moveTo(center.x+Math.cos(a)*inner,center.y+Math.sin(a)*inner);
        ctx.lineTo(center.x+Math.cos(a)*outer,center.y+Math.sin(a)*outer);ctx.stroke();
      }
      ctx.restore();
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
    var CONTROL_DOCK = null;
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
      if(b.style === "resultPrimary"){
        var resultBeam=ctx.createLinearGradient(b.x,b.y,b.x+b.w,b.y+b.h);
        resultBeam.addColorStop(0,"#f4fcff");resultBeam.addColorStop(.62,"#d8f5ff");resultBeam.addColorStop(1,"#ffd34e");
        ctx.shadowColor="rgba(101,217,255,.42)";ctx.shadowBlur=12;
        ctx.fillStyle=resultBeam;roundRect(b.x,b.y,b.w,b.h,12);ctx.fill();
        ctx.shadowBlur=0;ctx.shadowColor="rgba(0,0,0,0)";ctx.strokeStyle="#ffffff";ctx.lineWidth=1;ctx.stroke();
        ctx.fillStyle="#09151b";ctx.font="700 14px 'PingFang SC',sans-serif";
        ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(b.label,b.x+b.w/2,b.y+b.h/2+1);
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
      if(b.style === "setupOnline"){
        ctx.fillStyle = "rgba(99,201,255,0.10)";
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = "#63c9ff"; ctx.lineWidth = 1; ctx.strokeRect(b.x+0.5,b.y+0.5,b.w-1,b.h-1);
        ctx.fillStyle = "#63c9ff"; ctx.fillRect(b.x, b.y, b.w, 2);
        ctx.fillStyle = "#63c9ff"; ctx.font = "600 7px 'Arial Narrow', sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText("ONLINE", b.x+10, b.y+12);
        ctx.fillStyle = "#d4f0ff"; ctx.font = "700 13px 'PingFang SC', sans-serif"; ctx.textBaseline = "middle";
        ctx.fillText(b.label, b.x+b.w/2, b.y+b.h/2+3);
        return;
      }
      if(b.style === "rps"){
        var rpsGrad = ctx.createLinearGradient(b.x, b.y, b.x, b.y+b.h);
        rpsGrad.addColorStop(0, "rgba(99,201,255,0.16)");
        rpsGrad.addColorStop(1, "rgba(45,90,130,0.12)");
        ctx.fillStyle = rpsGrad;
        roundRect(b.x, b.y, b.w, b.h, 14); ctx.fill();
        ctx.strokeStyle = "rgba(99,201,255,0.5)"; ctx.lineWidth = 1.5; ctx.stroke();
        if(b.icon){
          ctx.fillStyle = "#d4f0ff"; ctx.font = "32px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(b.icon, b.x+b.w/2, b.y+b.h/2-8);
        }
        ctx.fillStyle = "#a9c6d3"; ctx.font = "600 13px 'PingFang SC', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(b.label, b.x+b.w/2, b.y+b.h-14);
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

    /* -------------------- 棋盘上旋转舵盘（自动避让移动位置） -------------------- */
    function projectBoardPoint(row,col,height){
      if(rendererMode === "ready" && webglRenderer){
        var projected=WebGLRenderer.projectPoint(row,col,height||0,SW,SH,webglCamera());
        if(projected) return projected;
      }
      return project3D(col-(COLS-1)/2,height||0,row-(ROWS-1)/2);
    }

    function dockClearance(rect,targets){
      if(rect.x<8 || rect.x+rect.w>SW-8 || rect.y<boardAreaTop+26 || rect.y+rect.h>boardAreaBot-8)
        return -1000000;
      var nearest=Infinity;
      for(var i=0;i<targets.length;i++){
        var dx=Math.max(rect.x-targets[i].x,0,targets[i].x-(rect.x+rect.w));
        var dy=Math.max(rect.y-targets[i].y,0,targets[i].y-(rect.y+rect.h));
        nearest=Math.min(nearest,dx*dx+dy*dy);
      }
      return nearest===Infinity?100000:nearest;
    }

    function buildOnBoardButtons3D(){
      // 旋转操作已移至底部按钮栏，棋盘上不再显示浮动控制面板
      ONBOARD = [];
      CONTROL_DOCK = null;
    }
    function drawTurnGlyph(b){
      var clockwise=b.direction!=="left",radius=8;
      var start=-Math.PI*.78,end=Math.PI*.58;
      ctx.save();
      ctx.translate(b.cx,b.cy-4);
      ctx.scale(clockwise?1:-1,1);
      ctx.strokeStyle="#f4fcff";ctx.lineWidth=2.2;ctx.lineCap="round";
      ctx.beginPath();ctx.arc(0,0,radius,start,end,false);ctx.stroke();
      var tx=Math.cos(end)*radius,ty=Math.sin(end)*radius;
      var tangent=end+Math.PI/2,tangentX=Math.cos(tangent),tangentY=Math.sin(tangent);
      var baseX=tx-tangentX*5.5,baseY=ty-tangentY*5.5;
      var normalX=-tangentY*3.4,normalY=tangentX*3.4;
      ctx.fillStyle="#f4fcff";ctx.beginPath();ctx.moveTo(tx,ty);
      ctx.lineTo(baseX+normalX,baseY+normalY);
      ctx.lineTo(baseX-normalX,baseY-normalY);ctx.closePath();ctx.fill();
      ctx.restore();
    }
    function drawOnBoardButtons3D(){
      if(!CONTROL_DOCK) return;
      var d=CONTROL_DOCK;
      ctx.save();
      // 引导线从棋子指向底部控制面板
      ctx.strokeStyle="rgba(101,217,255,.30)";ctx.lineWidth=1;
      ctx.setLineDash([3,3]);
      ctx.beginPath();ctx.moveTo(d.anchor.x,d.anchor.y);ctx.lineTo(d.cx,d.y);ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowColor="rgba(101,217,255,.30)";ctx.shadowBlur=10;
      var panel=ctx.createLinearGradient(d.x,d.y,d.x+d.w,d.y+d.h);
      panel.addColorStop(0,"rgba(10,20,29,.96)");panel.addColorStop(1,"rgba(18,40,51,.96)");
      ctx.fillStyle=panel;roundRect(d.x,d.y,d.w,d.h,12);ctx.fill();
      ctx.shadowBlur=0;ctx.strokeStyle="rgba(101,217,255,.62)";ctx.lineWidth=1;ctx.stroke();
      ctx.fillStyle="#87a6b2";ctx.font="600 7px 'Arial Narrow',sans-serif";
      ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(d.title,d.cx,d.y+9);
      for(var i=0;i<ONBOARD.length;i++){
        var b = ONBOARD[i];
        var isLeft=b.direction==="left";
        var isToggle=b.direction==="toggle";
        var glow=ctx.createRadialGradient(b.cx,b.cy,0,b.cx,b.cy,b.r*1.55);
        glow.addColorStop(0,isLeft?"rgba(126,229,255,.38)":(isToggle?"rgba(255,206,84,.38)":"rgba(70,190,255,.38)"));
        glow.addColorStop(1,"rgba(101,217,255,0)");
        ctx.fillStyle=glow;ctx.beginPath();ctx.arc(b.cx,b.cy,b.r*1.55,0,6.283);ctx.fill();
        var face=ctx.createLinearGradient(b.cx-b.r,b.cy-b.r,b.cx+b.r,b.cy+b.r);
        if(isLeft){face.addColorStop(0,"#1d5d73");face.addColorStop(1,"#0b2633");}
        else if(isToggle){face.addColorStop(0,"#4a3d18");face.addColorStop(1,"#2a2208");}
        else{face.addColorStop(0,"#12374f");face.addColorStop(1,"#0a2030");}
        ctx.fillStyle=face;
        ctx.strokeStyle=isLeft?"#8be9ff":(isToggle?"#ffd34e":"#4dc4ff");ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.arc(b.cx, b.cy, b.r, 0, 6.283); ctx.fill(); ctx.stroke();
        drawTurnGlyph(b);
        if(!isToggle){
          ctx.strokeStyle=isLeft?"#8be9ff":"#4dc4ff";ctx.lineWidth=2.2;ctx.beginPath();
          var railX=b.cx+(isLeft?-b.r+4:b.r-4);
          ctx.moveTo(railX,b.cy-7);ctx.lineTo(railX,b.cy+7);ctx.stroke();
        }
        ctx.fillStyle=isToggle?"#ffd34e":"#d9f7ff";ctx.font="700 7px 'Arial Narrow',sans-serif";
        ctx.fillText(b.angleLabel||b.label,b.cx,b.cy+9);
        if(b.angleLabel){
          ctx.fillStyle="#9fc7d4";ctx.font="600 7px 'PingFang SC',sans-serif";
          ctx.fillText(b.label,b.cx,d.y+d.h-7);
        }
      }
      ctx.restore();
    }
    function hitOnBoard3D(x, y){
      for(var i=0;i<ONBOARD.length;i++){
        var b = ONBOARD[i];
        var dx = x-b.cx, dy = y-b.cy;
        if(dx*dx+dy*dy <= (b.r+10)*(b.r+10)) return b;
      }
      return null;
    }

    /* -------------------- 主渲染 -------------------- */
    function render(){
      try {
        BUTTONS = [];
        ONBOARD = [];
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.shadowColor = "rgba(0,0,0,0)";
        ctx.fillStyle = "#0a0e1a";
        ctx.fillRect(0, 0, SW, SH);

        if(G.screen === "setup"){
          renderSetup();
          if(G.modal) drawModal();
          return;
        }
        if(G.screen === "online_wait"){
          drawOnlineWaitScreen();
          if(G.modal) drawModal();
          return;
        }
        if(G.screen === "online_join"){
          drawOnlineJoinScreen();
          if(G.modal) drawModal();
          return;
        }
        if(G.screen === "rps"){
          drawRpsScreen();
          if(G.modal) drawModal();
          return;
        }
        if(G.screen === "formation_select"){
          drawFormationSelectScreen();
          if(G.modal) drawModal();
          return;
        }
        if(G.screen === "formation_wait"){
          drawFormationWaitScreen();
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
        } else {
          if(G.path && G.path.length > 1) drawBeamAccents3D();
          if(G.particles && G.particles.length > 0) drawParticles3D();
          if(G.actionNotice){
            ctx.fillStyle = "#ffd34e";
            ctx.font = "700 14px sans-serif";
            ctx.textAlign = "center"; ctx.textBaseline = "top";
            ctx.fillText(G.actionNotice, SW/2, boardAreaTop + 4);
          }
        }
        if(G.killAnim) drawEliminationImpact3D();
        drawMatchBoardFrame();
        buildOnBoardButtons3D();
        drawOnBoardButtons3D();
        drawStatus();
        drawTurnBanner();
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
      ctx.fillStyle = "#f2eee5"; ctx.font = "800 24px 'PingFang SC', sans-serif";
      ctx.fillText("来桌游", 16, SAFE_TOP + 36);
      ctx.fillStyle = "#8998a1"; ctx.font = "11px 'PingFang SC', sans-serif";

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
      if(G.online && G.online.isHost && G.online.state === "waiting"){
        var mbW = SW - 32, mbH = 36, mbX = 16, mbY = actionY - mbH - 6;
        ctx.fillStyle = "rgba(99,201,255,0.10)"; roundRect(mbX, mbY, mbW, mbH, 8); ctx.fill();
        ctx.strokeStyle = "#63c9ff"; ctx.lineWidth = 1; ctx.strokeRect(mbX+0.5, mbY+0.5, mbW-1, mbH-1);
        ctx.fillStyle = "#63c9ff"; ctx.fillRect(mbX, mbY, 3, mbH);
        var pulse = 0.5 + 0.5 * Math.sin(Date.now() / 500);
        ctx.globalAlpha = pulse;
        ctx.fillStyle = "#63c9ff"; ctx.beginPath(); ctx.arc(mbX + 18, mbY + mbH/2, 4, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#d4f0ff"; ctx.font = "600 12px 'PingFang SC', sans-serif";
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText("在线匹配中", mbX + 30, mbY + mbH/2);
        ctx.fillStyle = "#7ab5ff"; ctx.font = "10px 'PingFang SC', sans-serif";
        ctx.fillText("好友加入后自动开始对战", mbX + 100, mbY + mbH/2);
        BUTTONS.push({ x:mbX+mbW-80, y:mbY+4, w:72, h:mbH-8, label:"取消匹配", fn:cancelOnline, style:"ghost" });
      }
      for(var i=0;i<BUTTONS.length;i++)drawButton(BUTTONS[i]);
    }

    function buildSetupButtons(actionY){
      var margin=16,gap=8;
      var totalW=SW-margin*2-gap;
      var rulesW=Math.floor(totalW*0.30);
      var startW=totalW-rulesW;
      var rulesBtn={x:margin,y:actionY,w:rulesW,h:46,label:"规则",fn:openRules,style:"setupGhost"};
      rulesLongPress.hitArea={x:rulesBtn.x,y:rulesBtn.y,w:rulesBtn.w,h:rulesBtn.h};
      BUTTONS.push(rulesBtn);
      BUTTONS.push({x:margin+rulesW+gap,y:actionY,w:startW,h:46,label:"开始游戏",meta:"CALIBRATION COMPLETE",fn:beginMatch,style:"setupPrimary"});
    }

    function handleDropdownClick(x,y){
      if(G.screen!=="setup" && G.screen!=="formation_select")return false;
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
      var isOnline = G.mode === "online" && G.online;
      var myTurn = isOnline && G.current === G.online.myPlayer;
      var sideName = G.current===0 ? "红方" : "蓝方";
      var turnTxt, col;
      if(G.over){ turnTxt = "对局结束"; col = "#9aa3bd"; }
      else if(isOnline){
        turnTxt = myTurn ? "你的回合 · "+sideName : "对方回合 · "+sideName;
        col = ownerColor(G.current, true);
      }
      else { turnTxt = sideName+"行动"; col = ownerColor(G.current, true); }
      var x=14,y=SAFE_TOP+5,w=SW-28;
      ctx.fillStyle="rgba(12,20,26,.90)";ctx.fillRect(x,y,w,TOPBAR_H-10);
      ctx.strokeStyle="rgba(113,145,157,.42)";ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,w-1,TOPBAR_H-11);
      // 在线模式：整条顶栏描边用当前行动方颜色，强化"谁的回合"
      if(isOnline && !G.over){
        ctx.strokeStyle=col;ctx.lineWidth=myTurn?2.5:1.5;
        ctx.globalAlpha=myTurn?0.95:0.45;
        ctx.strokeRect(x+.5,y+.5,w-1,TOPBAR_H-11);
        ctx.globalAlpha=1;
      }
      var padL = 56; // 避开左上角返回按钮
      ctx.fillStyle="#76909a";ctx.font="600 8px 'Arial Narrow', sans-serif";ctx.textAlign="left";ctx.textBaseline="alphabetic";
      ctx.fillText("OPTICAL MATCH / LIVE ARRAY",x+padL,y+12);
      // 行动方色点 + 加大加粗回合文案
      var dotX = x+padL+6, txtX = x+padL+18;
      if(isOnline && !G.over){
        var pulse = 0.5 + 0.5*Math.sin(G.beamPulseT*5);
        ctx.fillStyle=col;
        ctx.beginPath();
        ctx.arc(dotX, y+30, myTurn ? 6+pulse*3 : 5, 0, Math.PI*2);
        ctx.fill();
        if(myTurn){
          ctx.globalAlpha=0.35+0.4*pulse;
          ctx.beginPath();
          ctx.arc(dotX, y+30, 10+pulse*3, 0, Math.PI*2);
          ctx.fill();
          ctx.globalAlpha=1;
        }
      } else { txtX = x+padL; }
      ctx.fillStyle=col;ctx.font="800 19px 'PingFang SC', sans-serif";
      ctx.globalAlpha = (isOnline && !myTurn && !G.over) ? 0.8 : 1;
      ctx.fillText(turnTxt,txtX,y+36);
      ctx.globalAlpha=1;
      ctx.fillStyle="#71868f";ctx.font="600 8px 'Arial Narrow', sans-serif";ctx.textAlign="right";
      var modeTxt = isOnline
        ? "在线对战 · 你执"+(G.online.myPlayer===0?"红":"蓝")
        : (G.lockedDifficulty ? DIFFICULTY_LABEL[G.lockedDifficulty] : "")+"电脑";
      ctx.fillText(modeTxt+" · 10 × 8",x+w-10,y+13);
      ctx.fillStyle="#aebdc1";ctx.font="500 10px 'PingFang SC', sans-serif";ctx.fillText(G.busy&&G.phase!=="anim"?"等待对手…":"拖动棋盘可旋转视角",x+w-10,y+34);
      var railY=y+TOPBAR_H-15,mid=SW/2;
      var rail=ctx.createLinearGradient(x+10,railY,x+w-10,railY);
      rail.addColorStop(0,"#ff514a");rail.addColorStop(.48,"#ff514a");rail.addColorStop(.52,"#5ccbff");rail.addColorStop(1,"#5ccbff");
      ctx.strokeStyle=rail;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x+10,railY);ctx.lineTo(x+w-10,railY);ctx.stroke();
      // 在线模式：行动方一侧半轨高亮
      if(isOnline && !G.over){
        ctx.strokeStyle=col;ctx.lineWidth=3;
        ctx.beginPath();
        if(G.current===0){ctx.moveTo(x+10,railY);ctx.lineTo(mid-4,railY);}
        else{ctx.moveTo(mid+4,railY);ctx.lineTo(x+w-10,railY);}
        ctx.stroke();
      }
      var markerX=G.current===0?x+w*.27:x+w*.73;
      ctx.fillStyle=G.over?"#9aa3bd":"#e9f0ed";ctx.beginPath();ctx.moveTo(markerX,railY-5);ctx.lineTo(markerX+5,railY);ctx.lineTo(markerX,railY+5);ctx.lineTo(markerX-5,railY);ctx.closePath();ctx.fill();
      ctx.fillStyle="#ff7771";ctx.font="600 7px 'Arial Narrow', sans-serif";ctx.textAlign="left";ctx.fillText("RED",x+10,railY-4);
      ctx.fillStyle="#78d7ff";ctx.textAlign="right";ctx.fillText("BLUE",x+w-10,railY-4);
    }

    function drawMatchBoardFrame(){
      var x=10,y=boardAreaTop+8,w=SW-20,h=boardAreaBot-boardAreaTop-16,c=12;
      // 在线模式：棋盘边框以行动方颜色脉动，提示"谁的回合"
      if(G.mode==="online" && G.online && !G.over){
        var pulse = 0.5+0.5*Math.sin(G.beamPulseT*3);
        var col = ownerColor(G.current,true);
        var myTurn = G.current === G.online.myPlayer;
        ctx.save();
        ctx.globalAlpha = (myTurn ? 0.30 : 0.12) + (myTurn ? 0.30 : 0.08) * pulse;
        ctx.strokeStyle=col;ctx.lineWidth=myTurn?4:2.5;
        roundRect(x-2,y-2,w+4,h+4,14);ctx.stroke();
        ctx.restore();
      }
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
      var isOnline = G.mode === "online" && G.online;
      var myTurn = isOnline && G.current === G.online.myPlayer;
      var txt = "";
      var phaseLabel="READY";
      var accent = G.busy ? "#f5d86e" : ownerColor(G.current,true);
      if(G.over){txt="本局已结束";phaseLabel="COMPLETE";}
      else if(G.phase==="anim"){txt="激光发射中…";phaseLabel="LASER";accent="#f5d86e";}
      else if(G.busy){
        if(G.mode==="online"){
          var dots = ".".repeat(1 + Math.floor(G.beamPulseT*2) % 3);
          txt="等待对手行动"+dots;phaseLabel="WAITING";accent="#f5d86e";
        }
        else{txt="电脑正在计算光路…";phaseLabel="COMPUTE";accent="#f5d86e";}
      }
      else if(G.phase==="select"){
        if(G.mode==="pve"&&G.current===G.aiPlayer) txt="";
        else if(isOnline&&!myTurn) txt="";
        else txt="选择棋子，或直接发射";
        phaseLabel="SELECT";
      }
      else if(G.phase==="move"){txt="移动到高亮格；棋子上方可旋转";phaseLabel="MOVE";}
      else if(G.phase==="fire"){txt="发射激光，或结束本回合";phaseLabel="FIRE";}
      ctx.fillStyle="rgba(14,23,29,.94)";ctx.fillRect(12,y+3,SW-24,STATUS_H-6);
      ctx.strokeStyle= isOnline && !G.over ? accent : "#31444d";
      ctx.globalAlpha = isOnline && !G.over ? (myTurn && !G.busy ? 0.9 : 0.4) : 1;
      ctx.lineWidth = isOnline && !G.over && myTurn && !G.busy ? 1.8 : 1;
      ctx.strokeRect(12.5,y+3.5,SW-25,STATUS_H-7);
      ctx.globalAlpha=1;
      // 左侧色条加宽，行动等待用琥珀色
      ctx.fillStyle=accent;ctx.fillRect(12,y+3,4,STATUS_H-6);
      // 脉动效果：我的回合时提示更抓眼
      var pulse = 0.5+0.5*Math.sin(G.beamPulseT*4);
      if(isOnline && myTurn && !G.busy && !G.over){
        ctx.globalAlpha=0.25+0.3*pulse;
        ctx.fillStyle=accent;ctx.fillRect(12,y+3,4,STATUS_H-6);
        ctx.globalAlpha=1;
      }
      ctx.fillStyle= isOnline && myTurn && !G.busy ? accent : "#708790";
      ctx.font="700 9px 'Arial Narrow', sans-serif";ctx.textAlign="left";ctx.textBaseline="middle";
      ctx.fillText(phaseLabel,24,y+STATUS_H/2);
      ctx.fillStyle = txt && (isOnline && (myTurn || G.busy)) ? "#f2f7f5" : "#b9c7ca";
      ctx.font="700 12.5px 'PingFang SC', sans-serif";ctx.textAlign="right";
      ctx.fillText(txt,SW-22,y+STATUS_H/2);
    }

    /* -------------------- 按钮构建 -------------------- */
    function buildActionButtons(){
      if(G.screen !== "playing" || G.over || G.busy) return;
      if(G.phase === "move"){
        var selP = G.sel >= 0 ? G.pieces[G.sel] : null;
        if(selP && selP.alive){
          if(selP.type === LASER){
            addBtn("换向", doLaserToggle, "matchTurnEnd", 1);
          } else if(selP.type !== KING){
            addBtn("⟲ 左转", function(){ doRotate(3); }, "matchGhost", 0.95);
            addBtn("⟳ 右转", function(){ doRotate(1); }, "matchGhost", 0.95);
          }
        }
        addBtn("取消选择", function(){ G.phase="select"; G.sel=-1; render(); }, "matchGhost", 1);
        addBtn("视角归位", resetView, "matchGhost", 0.7);
      }
      else if(G.phase === "fire"){
        addBtn("\u26A1 发射激光", fireLaser, "matchPrimary", 1.35);
        addBtn("回合结束", skipFire, "matchTurnEnd", 1.1);
        addBtn("撤销操作", undoAction, "matchGhost", 0.9);
        if(G.drawOffer) addBtn("接受平局", declareDraw, "matchGhost", 0.8);
      }
      else if(G.phase === "select" && !G.busy){
        var _canAct = !(G.mode==="pve" && G.current===G.aiPlayer) &&
                      !(G.mode==="online" && G.online && G.current!==G.online.myPlayer);
        if(_canAct){
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
      G.lastAction = { kind:"rot", pi:G.sel, d:d };
      G.phase = "fire"; render();
    }
    function doLaserToggle(){
      var p = G.sel >= 0 ? G.pieces[G.sel] : null;
      if(!p) return;
      var dirs = LASER_DIRS[p.owner];
      var newDir = p.orientation === dirs[0] ? dirs[1] : dirs[0];
      p.orientation = newDir;
      G.lastAction = { kind:"laserRot", pi:G.sel, dir:newDir };
      G.phase = "fire"; render();
    }
    function skipFire(){
      if(G.mode === "online") sendOnlineTurnAction(false);
      G.path = null; G.eliminated = null; G.undoSnapshot = null;
      endTurn();
    }
    function directFire(){
      G.undoSnapshot = G.pieces.map(function(pp){ return Object.assign({}, pp); });
      G.phase = "fire";
      if(G.mode === "online") G.lastAction = null;
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
      camAnim = {fy:cam.yaw,fp:cam.pitch,fz:cam.zoom,ty:homeYaw,tp:DEFAULT_PITCH,tz:1,t:0,dur:0.5};
    }

    /* -------------------- 发射激光 -------------------- */
    function fireLaser(){
      if(G.phase !== "fire") return;
      if(G.mode === "online" && G.online && G.current === G.online.myPlayer) sendOnlineTurnAction(true);
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
        if(G.eliminated.type === KING) _kingKilled = G.eliminated.owner;
        startEliminationAnimation(G.eliminated);
        flashLoop();
      } else { afterFire(); }
    }
    function finalizeElimination(){
      if(G.eliminated) G.eliminated.alive=false;
      G.killAnim=null;G.flashPiece=null;G.flashN=0;
    }
    function flashLoop(){
      try { render(); } catch(e) {}
      G.flashN=Math.max(0,G.flashN-1);
      if(G.flashN > 0 || (G.particles && G.particles.length > 0) ||
         (G.killAnim && G.killAnim.t < G.killAnim.duration)){
        _setTrackTimeout(flashLoop, 50);
      } else {
        finalizeElimination();
        afterFire();
      }
    }
    function afterFire(){
      if(_kingKilled >= 0){
        G.winner = 1 - _kingKilled;
        G.over = true; G.busy = false; G.phase = "over";
        if(G.mode === "pve") AI.updateProfile(null,null,0, G.winner===G.aiPlayer ? "loss" : "win");
        _setTrackTimeout(function(){startResultModal("win");},420);
        return;
      }
      recordState();
      _setTrackTimeout(function(){ G.path = null; endTurn(); }, 480);
    }
    function endTurn(){
      if(G.mode === "pve" && G.current !== G.aiPlayer){
        AI.updateProfile(G.turnStartPieces,G.pieces,G.current);
        if(passiveHumanTurn(G.turnStartPieces,G.pieces,G.current))
          G.playerPassiveTurns=Math.min(3,G.playerPassiveTurns+1);
        else G.playerPassiveTurns=0;
      }
      G.current = 1 - G.current; G.sel = -1; G.phase = "select"; G.undoSnapshot = null;
      G.turnStartPieces=G.pieces.map(copySnapshotValue);
      if(G.mode === "online" && G.online && G.current !== G.online.myPlayer){
        G.busy = true;
      } else {
        G.busy = false;
      }
      if(G.mode === "online" && G.online && !G.over && G.current === G.online.myPlayer)
        showTurnBanner("轮到你了 · " + (G.current === 0 ? "红方行动" : "蓝方行动"));
      render();
      if(G.mode === "pve" && G.current === G.aiPlayer && !G.over) _setTrackTimeout(aiTurn, 360);
      if(G.mode === "online" && G.online && G.online.simulated && G.current !== G.online.myPlayer && !G.over)
        _setTrackTimeout(simulatedOpponentTurn, 600);
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
    var PIECE_NAMES = {laser:"激光炮", king:"国王", shield:"盾牌", mirror:"单面镜", switch:"双面镜"};
    function pieceNameOf(pi){
      var p = G.pieces[pi];
      return p ? (PIECE_NAMES[p.type] || "棋子") : "棋子";
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
      if(anim.online){
        finishOnlineActionTurn();
      } else {
        finishAiActionTurn();
      }
    }

    function aiCanEliminateOpponent(){
      try {
        var laser = getLaser(G.pieces, G.aiPlayer);
        if(!laser) return false;
        var simulation = simulateLaser(G.pieces, laser);
        return !!(simulation.eliminated && simulation.eliminated.owner !== G.aiPlayer);
      } catch(e) {
        return false;
      }
    }

    function finishAiActionTurn(){
      G.phase = "fire";
      if(aiCanEliminateOpponent()){
        try { render(); } catch(e) {}
        fireLaser();
        return;
      }
      G.path = null;
      G.eliminated = null;
      G.undoSnapshot = null;
      endTurn();
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
        var pName = pieceNameOf(act.pi);
        if(act.kind === "move") G.actionNotice = "电脑移动：" + pName;
        else if(act.kind === "rot" || act.kind === "laserRot") G.actionNotice = "电脑旋转：" + pName;
        else if(act.kind === "swap") G.actionNotice = "电脑互换：" + pName + " ↔ " + pieceNameOf(act.ti);
        else G.actionNotice = "电脑结束回合";
        render();
      } catch(e) {
        commitAiAction(act);
        G.aiAnim = null;
        finishAiActionTurn();
      }
    }

    /* -------------------- 平局 -------------------- */
    function declareDraw(){
      G.over = true; G.winner = -1; G.phase = "over";
      startResultModal("draw");
    }

    function startResultModal(kind){
      G.modal=kind;G.resultAnim={kind:kind,t:0,duration:1.05};render();
    }

    function updateResultAnimation(dt){
      if(!G.resultAnim) return;
      G.resultAnim.t=Math.min(G.resultAnim.duration,G.resultAnim.t+Math.max(0,dt||0));
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
      if(G.modal === "onlineDisconnect"){
        drawOnlineDisconnectModal();
        return;
      }
      if(G.modal === "onlineUnavailable"){
        drawOnlineUnavailableModal();
        return;
      }
      var rt=G.resultAnim?Math.max(0,Math.min(1,G.resultAnim.t/G.resultAnim.duration)):1;
      var cardT=Math.max(0,Math.min(1,(rt-.08)/.46));cardT=1-Math.pow(1-cardT,3);
      var detailT=Math.max(0,Math.min(1,(rt-.38)/.42));
      ctx.fillStyle = "rgba(4,8,13,"+(0.88*Math.min(1,rt*2.4))+")";
      ctx.fillRect(0, 0, SW, SH);
      var pw = Math.min(SW - 40, 336);
      var ph = 258;
      var px = (SW - pw) / 2;
      var py = (SH - ph) / 2;
      var winnerColor=G.winner===0?"#ff4655":"#65d9ff";
      var title="",sub="",eyebrow="MATCH COMPLETE";
      if(G.modal === "win"){
        var playerWon;
        if(G.mode==="online") playerWon=G.online&&G.winner===G.online.myPlayer;
        else playerWon=G.winner!==G.aiPlayer;
        if(G.mode==="online"){
          title=G.winner===0?"红方获胜":"蓝方获胜";
          sub=playerWon?"你的激光成功命中国王":"对手激光突破防线并命中国王";
          eyebrow=playerWon?"ONLINE VICTORY":"ONLINE DEFEAT";
        } else {
          title=playerWon?"光路胜利":"防线失守";
          sub=playerWon?"你的激光成功命中国王":"电脑激光突破防线并命中国王";
          eyebrow=playerWon?"OPTICAL VICTORY":"SYSTEM DEFEAT";
        }
      } else if(G.modal === "draw"){
        title="光路僵持";sub="相同局面出现三次，本局判定为平局";winnerColor="#ffd34e";
        eyebrow="TACTICAL DRAW";
      } else return;
      ctx.save();ctx.translate(SW/2,SH/2);ctx.scale(.92+.08*cardT,.92+.08*cardT);ctx.translate(-SW/2,-SH/2);
      ctx.globalAlpha=.2+.8*cardT;
      var aura=ctx.createRadialGradient(SW/2,py+92,0,SW/2,py+92,pw*.52);
      aura.addColorStop(0,winnerColor);aura.addColorStop(.18,"rgba(255,255,255,.16)");aura.addColorStop(1,"rgba(0,0,0,0)");
      ctx.globalAlpha=.18*cardT;ctx.fillStyle=aura;ctx.beginPath();ctx.arc(SW/2,py+92,pw*.52,0,6.283);ctx.fill();
      ctx.globalAlpha=.96*cardT;
      var card=ctx.createLinearGradient(px,py,px+pw,py+ph);
      card.addColorStop(0,"rgba(11,23,31,.98)");card.addColorStop(.62,"rgba(8,17,24,.98)");card.addColorStop(1,"rgba(18,35,42,.98)");
      ctx.fillStyle=card;roundRect(px,py,pw,ph,20);ctx.fill();
      ctx.strokeStyle="rgba(177,231,248,.46)";ctx.lineWidth=1;ctx.stroke();
      ctx.fillStyle=winnerColor;ctx.fillRect(px,py,4,ph);
      ctx.globalAlpha=detailT;
      ctx.strokeStyle=winnerColor;ctx.lineWidth=1.5;
      for(var ring=0;ring<3;ring++){
        ctx.globalAlpha=detailT*(.58-ring*.13);ctx.beginPath();ctx.arc(SW/2,py+76,20+ring*9+Math.sin(rt*12+ring)*2,0,6.283);ctx.stroke();
      }
      ctx.globalAlpha=detailT;ctx.fillStyle="#f4fcff";ctx.beginPath();
      ctx.moveTo(SW/2,py+56);ctx.lineTo(SW/2+17,py+76);ctx.lineTo(SW/2,py+96);ctx.lineTo(SW/2-17,py+76);ctx.closePath();ctx.fill();
      ctx.fillStyle=winnerColor;ctx.beginPath();ctx.arc(SW/2,py+76,7,0,6.283);ctx.fill();
      ctx.fillStyle="#88a5af";ctx.font="600 8px 'Arial Narrow',sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.fillText(eyebrow,SW/2,py+119);
      ctx.fillStyle="#f4fcff";ctx.font="700 25px 'PingFang SC',sans-serif";ctx.fillText(title,SW/2,py+145);
      ctx.fillStyle="#9db0b7";ctx.font="500 12px 'PingFang SC',sans-serif";ctx.fillText(sub,SW/2,py+172);
      var sweep=Math.max(0,Math.min(1,rt/.5));
      ctx.globalAlpha=(1-sweep)*.9;ctx.strokeStyle="#fffdf2";ctx.lineWidth=2;ctx.shadowColor=winnerColor;ctx.shadowBlur=12;
      var sweepX=px-30+(pw+60)*sweep;ctx.beginPath();ctx.moveTo(sweepX-26,py+ph);ctx.lineTo(sweepX+26,py);ctx.stroke();ctx.shadowBlur=0;
      ctx.restore();
      BUTTONS = [];
      if(rt>.58){
        if(G.mode==="online"){
          var bw2=(pw-88-BTN_GAP)/2;
          BUTTONS.push({x:px+44,y:py+ph-58,w:bw2,h:BTN_H,label:"再来一局",fn:function(){
            var frame={phase:"rematch"};
            if(!(G.online&&G.online.simulated)){
              Online.sendFrame(frame);
              startOnlineWatchdog(frame);
            }
            rematchOnline();
          },style:"resultPrimary"});
          BUTTONS.push({x:px+44+bw2+BTN_GAP,y:py+ph-58,w:bw2,h:BTN_H,label:"返回设置",fn:function(){
            if(!(G.online&&G.online.simulated)){try{Online.leaveRoom();}catch(e){}}
            G.online=null;G.mode="pve";enterSetup();
          },style:"matchGhost"});
        } else {
          BUTTONS.push({x:px+44,y:py+ph-58,w:pw-88,h:BTN_H,label:"再来一局",fn:restartMatch,style:"resultPrimary"});
        }
      }
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
    var camGesture = { lastDist:0, lastMidY:0, lastAngle:undefined };
    var lastDrag = { x:0, y:0 };
    var DRAG_THRESHOLD = 15; // 单指移动超过此距离判定为拖动视角

    var rulesLongPress = { active:false, startTime:0, triggered:false, hitArea:null };
    var RULES_LONGPRESS_MS = 3000;

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

    function hitPiece3D(sx,sy,owner){
      var best=null,bestScore=Infinity;
      for(var i=0;i<G.pieces.length;i++){
        var piece=G.pieces[i];
        if(!piece.alive || (owner!==undefined && piece.owner!==owner)) continue;
        var center=projectBoardPoint(piece.row,piece.col,pieceHeight(piece.type)*.42);
        var neighborCol=piece.col<COLS-1?piece.col+1:piece.col-1;
        var neighbor=projectBoardPoint(piece.row,neighborCol,pieceHeight(piece.type)*.42);
        var cellSpan=Math.hypot(neighbor.x-center.x,neighbor.y-center.y);
        var radius=Math.max(27,Math.min(43,cellSpan*.58+9));
        var dx=sx-center.x,dy=sy-center.y,score=(dx*dx+dy*dy)/(radius*radius);
        if(score<=1 && score<bestScore){bestScore=score;best=piece;}
      }
      return best;
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
          camGesture.lastAngle = Math.atan2(t2.clientY-t1.clientY,t2.clientX-t1.clientX);
        } else if(ts.length === 1){
          touchMode = "click";
          clickStart.x = ts[0].clientX;
          clickStart.y = ts[0].clientY;
          lastDrag.x = ts[0].clientX;
          lastDrag.y = ts[0].clientY;
          if(G.screen === "setup" && rulesLongPress.hitArea){
            var ha=rulesLongPress.hitArea;
            if(ts[0].clientX>=ha.x && ts[0].clientX<=ha.x+ha.w &&
               ts[0].clientY>=ha.y && ts[0].clientY<=ha.y+ha.h){
              rulesLongPress.active=true;
              rulesLongPress.startTime=Date.now();
              rulesLongPress.triggered=false;
            }
          }
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
          // 双指捏合直接调整棋盘缩放，不再用俯仰角伪装缩放。
          if(camGesture.lastDist>1) cam.zoom*=dist/camGesture.lastDist;
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
          constrainMatchCamera();
          camGesture.lastDist = dist;
          camGesture.lastMidY = midY;
          render();
        } else if(touchMode === "click" && ts.length === 1){
          // 单指移动：超过阈值则切换为拖动模式
          var dx = ts[0].clientX - lastDrag.x;
          var dy = ts[0].clientY - lastDrag.y;
          var moveDist = Math.sqrt(dx*dx + dy*dy);
          if(rulesLongPress.active && moveDist > DRAG_THRESHOLD){
            rulesLongPress.active = false;
          }
          if(G.screen === "playing" && moveDist > DRAG_THRESHOLD){
            touchMode = "drag";
          }
        } else if(G.screen === "playing" && touchMode === "drag" && ts.length === 1){
          // 单指拖动：旋转相机
          var ddx = ts[0].clientX - lastDrag.x;
          var ddy = ts[0].clientY - lastDrag.y;
          cam.yaw += ddx * 0.006;
          cam.pitch -= ddy * 0.005;
          constrainMatchCamera();
          lastDrag.x = ts[0].clientX;
          lastDrag.y = ts[0].clientY;
          render();
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
          var wasTriggered = rulesLongPress.triggered;
          rulesLongPress.active = false;
          rulesLongPress.triggered = false;
          if(wasTriggered) return; // 长按已触发在线对战，不处理点击
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
      constrainMatchCamera();
    }

    function processClick(x, y){
      if(handleDropdownClick(x, y)) return;
      var btn = hitButton(x, y);
      if(btn && btn.fn){ btn.fn(); return; }
      if(G.modal || G.screen !== "playing") return;
      if(G.over || G.busy) return;
      if(G.mode === "pve" && G.current === G.aiPlayer) return;
      if(G.mode === "online" && G.online && G.current !== G.online.myPlayer) return;

      var ob = hitOnBoard3D(x, y);
      if(ob && ob.fn){ ob.fn(); return; }

      var cell = screenToCell(x, y);
      var touchedPiece=hitPiece3D(x,y);

      if(G.phase === "select"){
        var p=touchedPiece && touchedPiece.owner===G.current?touchedPiece:
          (cell?pieceAt(G.pieces,cell.r,cell.c):null);
        if(p && p.owner === G.current){
          G.undoSnapshot = G.pieces.map(function(pp){ return Object.assign({}, pp); });
          G.sel = G.pieces.indexOf(p);
          G.lastAction = null;
          G.phase = "move";
          render();
        }
      }
      else if(G.phase === "move"){
        var selP = G.pieces[G.sel];
        if(!selP){ G.phase = "select"; render(); return; }
        var tg = null;
        var targets = moveTargets(selP);
        var targetRow=cell?cell.r:-1,targetCol=cell?cell.c:-1;
        if(touchedPiece){
          for(var ti=0;ti<targets.length;ti++) if(targets[ti].r===touchedPiece.row && targets[ti].c===touchedPiece.col){
            targetRow=touchedPiece.row;targetCol=touchedPiece.col;break;
          }
        }
        for(var i=0;i<targets.length;i++){
          if(targets[i].r===targetRow && targets[i].c===targetCol){ tg = targets[i]; break; }
        }
        if(tg){
          if(tg.swap){ var tp = pieceAt(G.pieces,targetRow,targetCol); var tr2=tp.row,tc2=tp.col; tp.row=selP.row;tp.col=selP.col; selP.row=tr2;selP.col=tc2; G.lastAction={kind:"swap",pi:G.sel,ti:G.pieces.indexOf(tp)}; }
          else { selP.row=targetRow;selP.col=targetCol; G.lastAction={kind:"move",pi:G.sel,r:targetRow,c:targetCol}; }
          G.phase = "fire"; render();
        } else {
          var np=touchedPiece && touchedPiece.owner===G.current?touchedPiece:
            (cell?pieceAt(G.pieces,cell.r,cell.c):null);
          if(np && np.owner === G.current && np !== selP){
            G.sel = G.pieces.indexOf(np);
            render();
          } else if(!np){ G.phase = "select"; G.sel = -1; render(); }
        }
      }
    }

    /* -------------------- 在线对战 -------------------- */

    function startOnlineMatch(){
      if(!Online.isAvailable()){
        G.modal = "onlineUnavailable";
        render();
        return;
      }
      G.screen = "online_wait";
      G.online = { state:"login", isHost:true, myPlayer:-1, accessInfo:null, shared:false };
      render();
      Online.login(function(err){
        if(err){ G.online.state="error"; G.online.errorMsg="登录游戏服务失败"; render(); return; }
        G.online.state = "creating";
        render();
        Online.createRoom(function(err2, accessInfo){
          if(err2){ G.online.state="error"; G.online.errorMsg="创建房间失败："+(err2.errMsg||err2.message||""); render(); return; }
          G.online.accessInfo = accessInfo;
          G.online.state = "waiting";
          render();
          Online.shareInvite(accessInfo);
          Online.onRoomInfoChange(function(roomInfo){
            var members = (roomInfo && roomInfo.memberList) || [];
            if(members.length >= 2 && G.online && G.online.state === "waiting"){
              G.online.state = "starting";
              clearMatchVisualState();
              setupFrameSync();
              Online.startGame(function(err3){
                if(err3){ G.online.state="error"; G.online.errorMsg="开始游戏失败"; render(); return; }
                startRps();
              });
            }
          });
        });
      });
    }

    function joinOnlineMatch(accessInfo){
      if(!Online.isAvailable()){
        G.modal = "onlineUnavailable";
        render();
        return;
      }
      G.screen = "online_join";
      G.online = { state:"login", isHost:false, myPlayer:-1, accessInfo:accessInfo };
      render();
      Online.login(function(err){
        if(err){ G.online.state="error"; G.online.errorMsg="登录游戏服务失败"; render(); return; }
        G.online.state = "joining";
        render();
        Online.joinRoom(accessInfo, function(err2){
          if(err2){ G.online.state="error"; G.online.errorMsg="加入房间失败："+(err2.errMsg||err2.message||""); render(); return; }
          G.online.state = "starting";
          render();
          setupFrameSync();
          Online.startGame(function(err3){
            if(err3){ G.online.state="error"; G.online.errorMsg="开始游戏失败"; render(); return; }
            startRps();
          });
        });
      });
    }

    var onlineWatchdog = null;
    var ONLINE_WATCHDOG_MS = 5000;
    var ONLINE_MAX_RETRIES = 3;

    function startOnlineWatchdog(frameData){
      clearOnlineWatchdog();
      var retries = 0;
      function retry(){
        retries++;
        if(retries > ONLINE_MAX_RETRIES){
          console.log("[Online] watchdog exhausted, showing disconnect");
          clearOnlineWatchdog();
          if(G.screen === "playing" || G.screen === "rps" || G.screen === "formation_select" || G.screen === "formation_wait"){
            G.modal = "onlineDisconnect";
            G.onlineDisconnectReason = "timeout";
            render();
          }
          return;
        }
        console.log("[Online] watchdog retry " + retries + " for:", JSON.stringify(frameData));
        if(!(G.online && G.online.simulated)) Online.sendFrame(frameData);
        onlineWatchdog = _setTrackTimeout(retry, ONLINE_WATCHDOG_MS);
      }
      onlineWatchdog = _setTrackTimeout(retry, ONLINE_WATCHDOG_MS);
    }

    function clearOnlineWatchdog(){
      if(onlineWatchdog){
        clearTimeout(onlineWatchdog);
        onlineWatchdog = null;
      }
    }

    function setupFrameSync(){
      var playScreens = {"playing":1,"rps":1,"formation_select":1,"formation_wait":1};
      Online.onFrame(function(data){
        clearOnlineWatchdog();
        handleOnlineFrame(data);
      });
      Online.onDisconnect(function(){
        if(playScreens[G.screen]){
          G.modal = "onlineDisconnect";
          G.onlineDisconnectReason = "network";
          render();
        }
      });
      Online.onRoomInfoChange(function(roomInfo){
        var members = (roomInfo && roomInfo.memberList) || [];
        if(members.length < 2 && playScreens[G.screen]){
          G.modal = "onlineDisconnect";
          G.onlineDisconnectReason = "left";
          render();
        }
      });
    }

    /* -------------------- 石头剪刀布 -------------------- */

    function startRps(){
      G.screen = "rps";
      G.rpsMyChoice = null;
      G.rpsOpponentChoice = null;
      G.rpsResult = null;
      render();
    }

    function handleRpsChoice(choice){
      if(G.rpsMyChoice) return;
      G.rpsMyChoice = choice;
      console.log("[RPS] my choice:", choice, "simulated:", !!(G.online && G.online.simulated));
      var frame = { phase:"rps", choice:choice };
      if(!(G.online && G.online.simulated)){
        Online.sendFrame(frame);
        startOnlineWatchdog(frame);
      }
      render();
      checkRpsResult();
      if(G.online && G.online.simulated && !G.rpsOpponentChoice){
        _setTrackTimeout(function(){
          G.rpsOpponentChoice = ["rock","scissors","paper"][Math.floor(Math.random()*3)];
          checkRpsResult();
        }, 800 + Math.random()*700);
      }
    }

    function checkRpsResult(){
      if(!G.rpsMyChoice || !G.rpsOpponentChoice) return;
      var my = G.rpsMyChoice, opp = G.rpsOpponentChoice;
      if(my === opp){
        G.rpsResult = "tie";
        render();
        _setTrackTimeout(function(){
          G.rpsMyChoice = null;
          G.rpsOpponentChoice = null;
          G.rpsResult = null;
          render();
        }, 2000);
        return;
      }
      var win = (my === "rock" && opp === "scissors") ||
                (my === "scissors" && opp === "paper") ||
                (my === "paper" && opp === "rock");
      if(win){
        G.online.myPlayer = 0;
        G.rpsResult = "win";
      } else {
        G.online.myPlayer = 1;
        G.rpsResult = "lose";
      }
      render();
      _setTrackTimeout(function(){
        if(G.online.myPlayer === 0){
          G.screen = "formation_select";
          G.formationIdx = 0;
          G.layoutIdx = 0;
          G.pieces = makeInitialPieces(0);
          setSetupCamera();
          render();
        } else {
          G.screen = "formation_wait";
          render();
          if(G.online.simulated){
            _setTrackTimeout(function(){
              var idx = Math.floor(Math.random() * LAYOUTS.length);
              beginOnlineMatch(idx);
            }, 1500);
          }
        }
      }, 2500);
    }

    function beginOnlineMatch(layoutIdx){
      G.mode = "online";
      G.screen = "playing";
      G.lockedLayoutIdx = (layoutIdx !== undefined) ? layoutIdx : G.layoutIdx;
      G.lockedDifficulty = G.difficulty;
      resetMatchState(makeInitialPieces(G.lockedLayoutIdx));
      // 蓝方主视角：棋盘旋转180°，动画过渡
      homeYaw = (G.online && G.online.myPlayer === 1) ? Math.PI : DEFAULT_YAW;
      if(Math.abs(homeYaw - cam.yaw) > 0.01){
        camAnim = {fy:cam.yaw,fp:cam.pitch,fz:cam.zoom||1,ty:homeYaw,tp:DEFAULT_PITCH,tz:1,t:0,dur:0.9};
      } else {
        setMatchCamera();
      }
      if(G.online.myPlayer !== G.current) G.busy = true;
      else showTurnBanner("轮到你了 · " + (G.current === 0 ? "红方先手" : "蓝方先手"));
      render();
      if(G.online && G.online.simulated && G.online.myPlayer !== G.current)
        _setTrackTimeout(simulatedOpponentTurn, 800);
    }

    function rematchOnline(){
      G.modal = null;
      G.over = false; G.winner = -1; G.busy = false;
      G.resultAnim = null;
      resetMatchState(makeInitialPieces(G.lockedLayoutIdx));
      homeYaw = (G.online && G.online.myPlayer === 1) ? Math.PI : DEFAULT_YAW;
      setMatchCamera();
      if(G.online.myPlayer !== G.current) G.busy = true;
      else showTurnBanner("再来一局 · " + (G.current === 0 ? "红方先手" : "蓝方先手"));
      render();
      if(G.online && G.online.simulated && G.online.myPlayer !== G.current)
        _setTrackTimeout(simulatedOpponentTurn, 800);
    }

    /* -------------------- 回合横幅 -------------------- */

    var turnBanner = { text: "", t: -1 };

    function showTurnBanner(text){
      turnBanner.text = text;
      turnBanner.t = 0;
    }

    function updateTurnBanner(dt){
      if(turnBanner.t < 0) return;
      turnBanner.t += dt || 0;
      if(turnBanner.t > 2.2) turnBanner.t = -1;
    }

    function drawTurnBanner(){
      if(turnBanner.t < 0 || !turnBanner.text) return;
      var t = turnBanner.t;
      var alpha = t < 0.25 ? t / 0.25 : (t > 1.6 ? Math.max(0, 1 - (t - 1.6) / 0.6) : 1);
      var y = boardAreaTop + (boardAreaBot - boardAreaTop) * 0.42;
      var rise = (1 - Math.min(1, t / 0.25)) * 18;
      var col = ownerColor(G.current, true);
      ctx.save();
      ctx.globalAlpha = alpha;
      var fs = 26;
      ctx.font = "800 " + fs + "px 'PingFang SC', sans-serif";
      var tw = ctx.measureText(turnBanner.text).width;
      var bw = tw + 44, bh = 52;
      var bx = SW / 2 - bw / 2, by = y - bh / 2 + rise;
      ctx.fillStyle = "rgba(8,13,20,.88)";
      roundRect(bx, by, bw, bh, 12);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      roundRect(bx, by, bw, bh, 12);
      ctx.stroke();
      var pulse = 0.5 + 0.5 * Math.sin(G.beamPulseT * 6);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(bx + 18, by + bh / 2, 5 + pulse * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#eef4f2";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(turnBanner.text, bx + 32, by + bh / 2 + 1);
      ctx.restore();
    }

    /* -------------------- 在线帧处理 -------------------- */

    function handleOnlineFrame(data){
      if(!data) return;
      console.log("[Online] handleOnlineFrame:", JSON.stringify(data));
      if(data.phase === "rps"){
        if(G.rpsOpponentChoice) return;
        console.log("[RPS] opponent choice received:", data.choice);
        G.rpsOpponentChoice = data.choice;
        checkRpsResult();
        return;
      }
      if(data.phase === "turn"){
        applyOnlineAction(data);
        return;
      }
      if(data.phase === "rematch"){
        if(G.screen === "playing" && !G.over) return;
        console.log("[Online] rematch request received");
        rematchOnline();
        return;
      }
      if(data.phase === "formation"){
        if(G.screen !== "formation_wait") return;
        console.log("[Online] formation received:", data.index);
        beginOnlineMatch(data.index);
        return;
      }
    }

    function applyOnlineAction(data){
      if(G.screen !== "playing" || G.over) return;
      if(G.current !== G.online.myPlayer) return;
      G.busy = true;
      G.sel = -1;
      G.onlinePendingFire = data.fire;
      if(data.action && data.action.kind !== "skip"){
        try {
          G.aiAnim = createAiAnimation(data.action);
          G.aiAnim.online = true;
          if(data.action.kind === "move"){
            G.actionNotice = "对手移动：" + pieceNameOf(data.action.pi);
          } else if(data.action.kind === "rot" || data.action.kind === "laserRot"){
            G.actionNotice = "对手旋转：" + pieceNameOf(data.action.pi);
          } else if(data.action.kind === "swap"){
            G.actionNotice = "对手互换：" + pieceNameOf(data.action.pi) + " ↔ " + pieceNameOf(data.action.ti);
          }
          render();
        } catch(e){
          commitAiAction(data.action);
          G.aiAnim = null;
          finishOnlineActionTurn();
        }
      } else {
        G.aiAnim = null;
        G.actionNotice = data.fire ? "对手发射激光" : "对手结束回合";
        G.phase = "fire";
        render();
        _setTrackTimeout(function(){
          if(data.fire) fireLaser();
          else {
            G.path = null;
            G.eliminated = null;
            G.undoSnapshot = null;
            endTurn();
          }
        }, 500);
      }
    }

    function finishOnlineActionTurn(){
      G.phase = "fire";
      if(G.onlinePendingFire){
        G.onlinePendingFire = null;
        fireLaser();
      } else {
        G.onlinePendingFire = null;
        G.path = null;
        G.eliminated = null;
        G.undoSnapshot = null;
        endTurn();
      }
    }

    function sendOnlineTurnAction(fire){
      if(G.mode !== "online") return;
      var frame = { phase:"turn", action:G.lastAction, fire:fire };
      if(!(G.online && G.online.simulated)){
        Online.sendFrame(frame);
        startOnlineWatchdog(frame);
      }
      G.lastAction = null;
    }

    function cancelOnline(){
      clearOnlineWatchdog();
      if(G.online && G.online.simulated){
        G.online = null;
        G.mode = "pve";
        enterSetup();
        return;
      }
      Online.leaveRoom();
      G.online = null;
      G.mode = "pve";
      enterSetup();
    }

    function startSimulatedOnline(){
      G.online = { state:"simulated", isHost:true, myPlayer:-1, simulated:true };
      startRps();
    }

    function simulatedOpponentTurn(){
      if(G.over || G.screen !== "playing") return;
      var opp = G.current;
      var act;
      try { act = aiChoose(G.pieces, opp, G.lockedDifficulty || "normal", 0); }
      catch(e) { act = { kind:"skip" }; }
      var fire = false;
      if(act && act.kind !== "skip"){
        var snap = G.pieces.map(function(p){ return Object.assign({}, p); });
        commitAiAction(act);
        try {
          var laser = getLaser(G.pieces, opp);
          if(laser){
            var sim = simulateLaser(G.pieces, laser);
            fire = !!(sim.eliminated && sim.eliminated.owner !== opp);
          }
        } catch(e2) {}
        G.pieces = snap;
      }
      applyOnlineAction({ phase:"turn", action:act, fire:fire });
    }

    /* -------------------- 在线对战屏幕渲染 -------------------- */

    function drawOnlineWaitScreen(){
      var bg = ctx.createLinearGradient(0, 0, 0, SH);
      bg.addColorStop(0, "#11151b"); bg.addColorStop(1, "#090c10");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, SW, SH);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var stateLabels = {
        login: { label:"正在登录", sub:"连接游戏服务" },
        creating: { label:"正在创建房间", sub:"准备对战房间" },
        waiting: { label:G.online.shared ? "等待好友加入" : "房间已创建", sub:G.online.shared ? "已发送邀请，等待对方加入" : "点击下方按钮邀请好友" },
        starting: { label:"对手已加入", sub:"正在同步对局" },
        error: { label:"出错", sub:G.online.errorMsg || "未知错误" }
      };
      var info = stateLabels[G.online.state] || { label:"", sub:"" };
      var cardW = Math.min(SW-40, 300), cardH = 240;
      var cardX = (SW-cardW)/2, cardY = SH/2 - cardH/2 - 20;
      ctx.fillStyle = "#151c31"; roundRect(cardX, cardY, cardW, cardH, 16); ctx.fill();
      ctx.strokeStyle = "#334263"; ctx.lineWidth = 1; ctx.stroke();
      if(G.online.state === "error") ctx.strokeStyle = "#ff5a6e";
      else if(G.online.state === "waiting") ctx.strokeStyle = "#63c9ff";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cardX+16, cardY); ctx.lineTo(cardX+cardW-16, cardY);
      ctx.strokeStyle = G.online.state === "error" ? "#ff5a6e" : "#63c9ff";
      ctx.lineWidth = 2; ctx.stroke();
      if(G.online.state === "waiting"){
        var pulse = 0.5 + 0.5 * Math.sin(Date.now() / 600);
        ctx.globalAlpha = 0.15 + 0.25 * pulse;
        ctx.fillStyle = "#63c9ff";
        ctx.fillRect(cardX+16, cardY, cardW-32, 3);
        ctx.globalAlpha = 1;
      }
      var iconY = cardY + 50;
      if(G.online.state === "error"){
        ctx.fillStyle = "#ff5a6e"; ctx.font = "32px sans-serif";
        ctx.fillText("✕", SW/2, iconY);
      } else if(G.online.state === "waiting"){
        var dotR = 6, dotSpacing = 18;
        for(var di = 0; di < 3; di++){
          var dp = 0.3 + 0.7 * Math.max(0, Math.sin(Date.now() / 300 - di * 0.6));
          ctx.globalAlpha = dp;
          ctx.fillStyle = "#63c9ff";
          ctx.beginPath(); ctx.arc(SW/2 - dotSpacing + di * dotSpacing, iconY, dotR, 0, Math.PI*2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else {
        var sp = 0.4 + 0.6 * Math.abs(Math.sin(Date.now() / 500));
        ctx.globalAlpha = sp;
        ctx.fillStyle = "#5ccbff"; ctx.font = "28px sans-serif";
        ctx.fillText("◌", SW/2, iconY);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "#f4f7ff"; ctx.font = "700 18px 'PingFang SC', sans-serif";
      ctx.fillText(info.label, SW/2, cardY + 100);
      ctx.fillStyle = "#8998a1"; ctx.font = "12px 'PingFang SC', sans-serif";
      ctx.fillText(info.sub, SW/2, cardY + 128);
      if(G.online.state === "waiting" && G.online.accessInfo){
        if(!G.online.shared){
          BUTTONS.push({ x:SW/2-80, y:cardY+cardH-58, w:160, h:42, label:"邀请好友", fn:function(){
            G.online.shared = true;
            Online.triggerShare(G.online.accessInfo);
            render();
          }, style:"setupOnline" });
        } else {
          ctx.fillStyle = "rgba(16,27,34,0.6)"; roundRect(SW/2-80, cardY+cardH-58, 160, 42, 8); ctx.fill();
          ctx.strokeStyle = "#2a3a4a"; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = "#5a6a74"; ctx.font = "600 13px 'PingFang SC', sans-serif";
          ctx.fillText("等待好友加入...", SW/2, cardY+cardH-37);
          BUTTONS.push({ x:SW/2-80, y:cardY+cardH-58, w:160, h:42, label:"", fn:function(){
            Online.triggerShare(G.online.accessInfo);
          }, style:"ghost" });
        }
      }
      if(G.online.state === "error"){
        BUTTONS.push({ x:SW/2-60, y:cardY+cardH-52, w:120, h:40, label:"返回", fn:cancelOnline, style:"ghost" });
      } else {
        BUTTONS.push({ x:SW/2-70, y:SH-SAFE_BOT-48, w:140, h:40, label:"返回首页", fn:function(){
          G.screen = "setup";
          render();
        }, style:"ghost" });
      }
      for(var i=0;i<BUTTONS.length;i++) drawButton(BUTTONS[i]);
    }

    function drawOnlineJoinScreen(){
      var bg = ctx.createLinearGradient(0, 0, 0, SH);
      bg.addColorStop(0, "#11151b"); bg.addColorStop(1, "#090c10");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, SW, SH);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var label = "", sub = "";
      if(G.online){
        if(G.online.state === "login"){ label = "正在登录..."; sub = "连接游戏服务"; }
        else if(G.online.state === "joining"){ label = "正在加入房间..."; sub = "连接对手"; }
        else if(G.online.state === "starting"){ label = "准备开始..."; sub = "同步对局"; }
        else if(G.online.state === "error"){ label = "出错"; sub = G.online.errorMsg || "未知错误"; }
      }
      ctx.fillStyle = "#f2eee5"; ctx.font = "700 20px 'PingFang SC', sans-serif";
      ctx.fillText(label, SW/2, SH/2 - 30);
      ctx.fillStyle = "#8998a1"; ctx.font = "12px 'PingFang SC', sans-serif";
      ctx.fillText(sub, SW/2, SH/2 + 2);
      if(G.online && G.online.state !== "error"){
        var dots = ".".repeat(Math.floor(Date.now() / 400) % 4);
        ctx.fillStyle = "#5ccbff"; ctx.font = "14px sans-serif";
        ctx.fillText(dots, SW/2, SH/2 + 30);
      }
      BUTTONS.push({ x:SW/2-60, y:SH-SAFE_BOT-50, w:120, h:42, label:"取消", fn:cancelOnline, style:"ghost" });
      for(var i=0;i<BUTTONS.length;i++) drawButton(BUTTONS[i]);
    }

    function drawRpsScreen(){
      var bg = ctx.createLinearGradient(0, 0, 0, SH);
      bg.addColorStop(0, "#11151b"); bg.addColorStop(0.5, "#0d1117"); bg.addColorStop(1, "#090c10");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, SW, SH);
      ctx.save();
      ctx.strokeStyle = "rgba(174,197,209,0.055)"; ctx.lineWidth = 1;
      for(var gx=16;gx<SW;gx+=24){ ctx.beginPath();ctx.moveTo(gx,0);ctx.lineTo(gx,SH);ctx.stroke(); }
      for(var gy=SAFE_TOP;gy<SH;gy+=24){ ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(SW,gy);ctx.stroke(); }
      ctx.restore();
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#a9c6d3"; ctx.font = "600 9px 'Arial Narrow', sans-serif";
      ctx.fillText("ROCK · PAPER · SCISSORS", SW/2, SAFE_TOP + 20);
      ctx.fillStyle = "#f2eee5"; ctx.font = "800 24px 'PingFang SC', sans-serif";
      ctx.fillText("石头·剪刀·布", SW/2, SAFE_TOP + 52);
      ctx.fillStyle = "#8998a1"; ctx.font = "11px 'PingFang SC', sans-serif";
      ctx.fillText("胜者执红方，先手行动", SW/2, SAFE_TOP + 74);
      var railY = SAFE_TOP + 88;
      var rail = ctx.createLinearGradient(16, railY, SW-16, railY);
      rail.addColorStop(0, "#ff4d45"); rail.addColorStop(0.48, "#ff4d45");
      rail.addColorStop(0.52, "#62c8ff"); rail.addColorStop(1, "#62c8ff");
      ctx.strokeStyle = rail; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(16, railY); ctx.lineTo(SW-16, railY); ctx.stroke();
      if(G.rpsResult) drawRpsResult();
      else if(G.rpsMyChoice) drawRpsWaiting();
      else drawRpsButtons();
    }

    function drawRpsButtons(){
      var choices = [
        { key:"rock", label:"石头", icon:"\u270A" },
        { key:"scissors", label:"剪刀", icon:"\u270C" },
        { key:"paper", label:"布", icon:"\u270B" }
      ];
      var margin = 20, gap = 12;
      var w = (SW - margin*2 - gap*2) / 3;
      var h = 80;
      var y = SH/2 - h/2;
      for(var i=0;i<choices.length;i++){
        var x = margin + i*(w+gap);
        var c = choices[i];
        BUTTONS.push({
          x:x, y:y, w:w, h:h, label:c.label, icon:c.icon,
          fn:(function(choice){ return function(){ handleRpsChoice(choice); }; })(c.key),
          style:"rps"
        });
      }
      ctx.fillStyle = "#8998a1"; ctx.font = "12px 'PingFang SC', sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText("选择你的手势", SW/2, y + h + 24);
      for(var j=0;j<BUTTONS.length;j++) drawButton(BUTTONS[j]);
    }

    function drawRpsWaiting(){
      var labels = { rock:"石头", scissors:"剪刀", paper:"布" };
      var icons = { rock:"\u270A", scissors:"\u270C", paper:"\u270B" };
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#f2eee5"; ctx.font = "48px sans-serif";
      ctx.fillText(icons[G.rpsMyChoice], SW/2, SH/2 - 20);
      ctx.fillStyle = "#8998a1"; ctx.font = "14px 'PingFang SC', sans-serif";
      ctx.fillText("你选择了 " + labels[G.rpsMyChoice], SW/2, SH/2 + 30);
      var dots = ".".repeat(Math.floor(Date.now() / 400) % 4);
      ctx.fillStyle = "#5ccbff"; ctx.font = "12px 'PingFang SC', sans-serif";
      ctx.fillText("等待对方选择" + dots, SW/2, SH/2 + 56);
    }

    function drawRpsResult(){
      var labels = { rock:"石头", scissors:"剪刀", paper:"布" };
      var icons = { rock:"\u270A", scissors:"\u270C", paper:"\u270B" };
      var cy = SH/2 - 30;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = G.rpsResult === "win" ? "#ff4a4a" : "#3a8aff";
      ctx.font = "36px sans-serif";
      ctx.fillText(icons[G.rpsMyChoice], SW*0.3, cy);
      ctx.fillStyle = "#8998a1"; ctx.font = "11px 'PingFang SC', sans-serif";
      ctx.fillText("你", SW*0.3, cy + 30);
      ctx.fillStyle = "#66747d"; ctx.font = "700 16px sans-serif";
      ctx.fillText("VS", SW/2, cy);
      ctx.fillStyle = G.rpsResult === "win" ? "#3a8aff" : "#ff4a4a";
      ctx.font = "36px sans-serif";
      ctx.fillText(icons[G.rpsOpponentChoice], SW*0.7, cy);
      ctx.fillStyle = "#8998a1"; ctx.font = "11px 'PingFang SC', sans-serif";
      ctx.fillText("对手", SW*0.7, cy + 30);
      if(G.rpsResult === "win"){
        ctx.fillStyle = "#ff4a4a"; ctx.font = "700 18px 'PingFang SC', sans-serif";
        ctx.fillText("你赢了！你是红方，先手", SW/2, cy + 70);
      } else if(G.rpsResult === "lose"){
        ctx.fillStyle = "#3a8aff"; ctx.font = "700 18px 'PingFang SC', sans-serif";
        ctx.fillText("你输了！你是蓝方，后手", SW/2, cy + 70);
      } else {
        ctx.fillStyle = "#ffd34e"; ctx.font = "700 18px 'PingFang SC', sans-serif";
        ctx.fillText("平局！再来一次", SW/2, cy + 70);
      }
    }

    function drawFormationSelectScreen(){
      G.layoutIdx = G.formationIdx;
      if(!G.pieces || G.pieces.length === 0) G.pieces = makeInitialPieces(G.layoutIdx);
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
      var hintTop=setupY+94, margin=16;
      ctx.fillStyle="#f2eee5";ctx.font="600 10px 'PingFang SC', sans-serif";ctx.textAlign="left";ctx.textBaseline="alphabetic";
      ctx.fillText("你赢得了先手选择权",margin,hintTop);
      ctx.fillStyle="#6f828b";ctx.font="600 8px 'Arial Narrow', sans-serif";ctx.fillText("PRIORITY PICK",margin+96,hintTop);
      ctx.fillStyle="#63c9ff";ctx.font="10px 'PingFang SC', sans-serif";
      ctx.fillText("选择阵型后点击开始对战，对手将等待你的决定",margin,hintTop+16);
      var actionY=Math.min(setupY+199,SH-SAFE_BOT-48);
      BUTTONS.push({
        x:margin, y:actionY, w:SW-margin*2, h:46,
        label:"开始对战 · " + LAYOUTS[G.formationIdx].name,
        meta:"FORMATION SELECT",
        fn:function(){
          var frame = { phase:"formation", index:G.formationIdx };
          if(!(G.online && G.online.simulated)){
            Online.sendFrame(frame);
            startOnlineWatchdog(frame);
          }
          beginOnlineMatch(G.formationIdx);
        }, style:"setupOnline"
      });
      for(var j=0;j<BUTTONS.length;j++) drawButton(BUTTONS[j]);
    }

    function drawFormationWaitScreen(){
      var bg = ctx.createLinearGradient(0, 0, 0, SH);
      bg.addColorStop(0, "#11151b"); bg.addColorStop(1, "#090c10");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, SW, SH);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var cardW = Math.min(SW-40, 300), cardH = 200;
      var cardX = (SW-cardW)/2, cardY = SH/2 - cardH/2 - 20;
      ctx.fillStyle = "#151c31"; roundRect(cardX, cardY, cardW, cardH, 16); ctx.fill();
      ctx.strokeStyle = "#334263"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#63c9ff"; ctx.fillRect(cardX+16, cardY, cardW-32, 3);
      var dotR = 6, dotSpacing = 18, dotY = cardY + 56;
      for(var di = 0; di < 3; di++){
        var dp = 0.3 + 0.7 * Math.max(0, Math.sin(Date.now() / 300 - di * 0.6));
        ctx.globalAlpha = dp;
        ctx.fillStyle = "#63c9ff";
        ctx.beginPath(); ctx.arc(SW/2 - dotSpacing + di * dotSpacing, dotY, dotR, 0, Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#f4f7ff"; ctx.font = "700 18px 'PingFang SC', sans-serif";
      ctx.fillText("等待对手选择阵型", SW/2, cardY + 100);
      ctx.fillStyle = "#8998a1"; ctx.font = "12px 'PingFang SC', sans-serif";
      ctx.fillText("对方正在选择对战阵型...", SW/2, cardY + 128);
      BUTTONS.push({ x:SW/2-60, y:SH-SAFE_BOT-48, w:120, h:40, label:"取消", fn:cancelOnline, style:"ghost" });
      for(var j=0;j<BUTTONS.length;j++) drawButton(BUTTONS[j]);
    }

    function drawOnlineDisconnectModal(){
      ctx.fillStyle = "rgba(6,9,20,0.88)"; ctx.fillRect(0, 0, SW, SH);
      var pw = Math.min(SW-40, 320), ph = 200;
      var px = (SW-pw)/2, py = (SH-ph)/2;
      ctx.fillStyle = "#1a2138"; roundRect(px, py, pw, ph, 16); ctx.fill();
      ctx.strokeStyle = "#4b5876"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#f4f7ff"; ctx.font = "700 20px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var isLeft = G.onlineDisconnectReason === "left";
      var isTimeout = G.onlineDisconnectReason === "timeout";
      ctx.fillText(isLeft ? "对手已退出" : (isTimeout ? "连接超时" : "对手断线"), SW/2, py + 54);
      ctx.fillStyle = "#ff9ba7"; ctx.font = "14px sans-serif";
      ctx.fillText(isLeft ? "对方离开了房间，对局结束。" : (isTimeout ? "多次重试未能同步，对局结束。" : "对方已断开连接，对局结束。"), SW/2, py + 94);
      BUTTONS = [{
        x:px+20, y:py+ph-56, w:pw-40, h:42,
        label:"返回设置", fn:function(){
          G.modal = null;
          try{Online.leaveRoom();}catch(e){}
          G.online = null;
          G.mode = "pve";
          enterSetup();
        }, style:"primary"
      }];
      drawButton(BUTTONS[0]);
    }

    function drawOnlineUnavailableModal(){
      ctx.fillStyle = "rgba(6,9,20,0.88)"; ctx.fillRect(0, 0, SW, SH);
      var pw = Math.min(SW-40, 320), ph = 220;
      var px = (SW-pw)/2, py = (SH-ph)/2;
      ctx.fillStyle = "#1a2138"; roundRect(px, py, pw, ph, 16); ctx.fill();
      ctx.strokeStyle = "#4b5876"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#f4f7ff"; ctx.font = "700 18px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("在线服务不可用", SW/2, py + 48);
      ctx.fillStyle = "#9db0b7"; ctx.font = "13px 'PingFang SC', sans-serif";
      ctx.fillText("帧同步需要在真机预览环境下使用。", SW/2, py + 78);
      ctx.fillText("可使用模拟模式测试在线对战流程。", SW/2, py + 98);
      BUTTONS = [
        { x:px+20, y:py+ph-56, w:(pw-52)/2, h:42, label:"返回",
          fn:function(){ G.modal=null; enterSetup(); }, style:"ghost" },
        { x:px+pw/2+6, y:py+ph-56, w:(pw-52)/2, h:42, label:"模拟测试",
          fn:function(){ G.modal=null; startSimulatedOnline(); }, style:"primary" }
      ];
      for(var i=0;i<BUTTONS.length;i++) drawButton(BUTTONS[i]);
    }

    /* -------------------- 启动 -------------------- */
    enterSetup();
    initWebGLRenderer();

    if (platform && platform.launchOptions) {
      var _roomInfo = Online.getLaunchRoomInfo(platform.launchOptions);
      if (_roomInfo) joinOnlineMatch(_roomInfo);
    }

    /* -------------------- 模块接口 -------------------- */
    return {
      update: function(dt){
        G.beamPulseT += Math.max(0, dt || 0);
        updateTurnBanner(dt);
        if(camAnim){
          camAnim.t += dt / camAnim.dur;
          if(camAnim.t >= 1){
            cam.yaw = camAnim.ty;
            cam.pitch = camAnim.tp;
            cam.zoom = camAnim.tz;
            camAnim = null;
          } else {
            var e = easeInOut(camAnim.t);
            cam.yaw = camAnim.fy + (camAnim.ty - camAnim.fy) * e;
            cam.pitch = camAnim.fp + (camAnim.tp - camAnim.fp) * e;
            cam.zoom = camAnim.fz + (camAnim.tz - camAnim.fz) * e;
          }
        }
        updateAiAnimation(dt);
        updateParticles(dt);
        updateKillAnimation(dt);
        updateResultAnimation(dt);
        if(rulesLongPress.active && !rulesLongPress.triggered &&
           Date.now()-rulesLongPress.startTime >= RULES_LONGPRESS_MS){
          rulesLongPress.triggered=true;
          rulesLongPress.active=false;
          startOnlineMatch();
        }
      },
      render: function(){ render(); },
      onTouchStart: function(e){ handleTouchStart(e); },
      onTouchMove: function(e){ handleTouchMove(e); },
      onTouchEnd: function(e){ handleTouchEnd(e); },
      onBack: function(){
        if(G.screen === "online_wait" || G.screen === "online_join" || G.screen === "rps"){
          cancelOnline();
          return true;
        }
        if(G.screen !== "playing") return false;
        requestReturnToSetup();
        return true;
      },
      onShow: function(options){
        if(G.online) return;
        var query = (options && options.query) || {};
        if(!query.online){
          try {
            var enterOpts = wx.getEnterOptionsSync ? wx.getEnterOptionsSync() : null;
            if(enterOpts && enterOpts.query) query = enterOpts.query;
          } catch(e) {}
        }
        if(query.online === "1" || query.online === 1){
          var room = query.room ? decodeURIComponent(query.room) : null;
          if(room){
            if(G.screen === "playing" || G.screen === "setup"){
              clearMatchVisualState();
            }
            joinOnlineMatch(room);
          }
        }
      },
      showBack: function(){
        return G.screen === "playing" || G.screen === "online_wait" ||
               G.screen === "online_join" || G.screen === "rps";
      },
      cameraControl: function(dx, dy){ externalCameraControl(dx, dy); },
      exit: function(){
        if(G.online || G.mode === "online"){
          try { Online.leaveRoom(); } catch(e) {}
          G.online = null;
          G.mode = "pve";
        }
        rendererAlive = false;
        for(var i=0;i<_timeouts.length;i++) clearTimeout(_timeouts[i]);
        _timeouts = [];
        if(webglRenderer){ try { webglRenderer.dispose(); } catch(e) {} }
      },
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
            killAnim:copySnapshotValue(G.killAnim),killPose:copySnapshotValue(sampleKillAnimation()),
            resultAnim:copySnapshotValue(G.resultAnim),
            rendererMode:rendererMode,
            camera:{yaw:cam.yaw,pitch:cam.pitch,zoom:cam.zoom},
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
        webglBeamHead: function(path,progress){ return copySnapshotValue(webglBeamHead(path,progress)); },
        projectBoardPoint: function(row,col,height){return copySnapshotValue(projectBoardPoint(row,col,height));},
        hitPiece: function(x,y,owner){var p=hitPiece3D(x,y,owner);return p?G.pieces.indexOf(p):-1;},
        moveTargets: function(index){return G.pieces[index]?moveTargets(G.pieces[index]).map(copySnapshotValue):[];},
        showResult: function(kind,winner){G.over=true;G.winner=winner;G.phase="over";startResultModal(kind);},
        beginAiAction: function(action){ G.current=G.aiPlayer; applyAiAction(action); },
        beginElimination: function(index){
          if(index>=0 && index<G.pieces.length){G.eliminated=G.pieces[index];startEliminationAnimation(G.eliminated);}
        },
        completeElimination: finalizeElimination,
        setPieces: function(pieces){ G.pieces = pieces.map(copySnapshotValue); },
        snapshot: function(){ return {
          pieces:G.pieces.map(copySnapshotValue),
          aiAnim:copySnapshotValue(G.aiAnim),
          actionNotice:G.actionNotice, busy:G.busy, phase:G.phase,
          killAnim:copySnapshotValue(G.killAnim),killPose:copySnapshotValue(sampleKillAnimation()),
          particleCount:G.particles.length,
          controlDock:copySnapshotValue(CONTROL_DOCK),
          onboard:ONBOARD.map(function(b){return {cx:b.cx,cy:b.cy,r:b.r,direction:b.direction,label:b.label};}),
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
