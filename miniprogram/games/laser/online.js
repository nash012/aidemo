"use strict";

/**
 * 在线对战网络模块
 * 封装微信小游戏 GameServerManager，提供房间创建、加入、帧同步等能力
 * 通过分享链接实现 A 邀请 B 的流程
 */

var Online = {
  _manager: null,
  _connected: false,
  _clientId: null,
  _accessInfo: null,
  _onFrameCb: null,
  _onDisconnectCb: null,
  _onStartCb: null,

  isAvailable: function() {
    try {
      return typeof wx !== "undefined" && typeof wx.getGameServerManager === "function";
    } catch (e) {
      return false;
    }
  },

  _getManager: function() {
    if (!this._manager) {
      this._manager = wx.getGameServerManager();
    }
    return this._manager;
  },

  login: function(callback) {
    if (!this.isAvailable()) {
      callback(new Error("GameServerManager 不可用"));
      return;
    }
    var self = this;
    var mgr = this._getManager();
    mgr.login().then(function() {
      callback(null);
    }).catch(function(err) {
      callback(err || new Error("登录失败"));
    });
  },

  createRoom: function(callback) {
    var self = this;
    var mgr = this._getManager();
    if (!mgr) { callback(new Error("无 GameServerManager")); return; }
    mgr.createRoom({
      maxMemberNum: 2,
      startPercent: 100,
      needUserInfo: false,
      success: function(res) {
        var data = (res && res.data) ? res.data : res;
        self._accessInfo = data.accessInfo;
        self._clientId = data.clientId;
        callback(null, data.accessInfo);
      },
      fail: function(err) {
        console.error("[Online] createRoom fail:", JSON.stringify(err));
        callback(err || new Error("创建房间失败"));
      }
    });
  },

  joinRoom: function(accessInfo, callback) {
    var self = this;
    var mgr = this._getManager();
    if (!mgr) { callback(new Error("无 GameServerManager")); return; }
    mgr.joinRoom({
      accessInfo: accessInfo,
      success: function(res) {
        var data = (res && res.data) ? res.data : res;
        self._clientId = data.clientId;
        callback(null);
      },
      fail: function(err) {
        console.error("[Online] joinRoom fail:", JSON.stringify(err));
        callback(err || new Error("加入房间失败"));
      }
    });
  },

  onGameStartCb: null,
  _gameStartRegistered: false,

  prepareGameStart: function(callback) {
    var self = this;
    var mgr = this._getManager();
    if (!mgr) return;
    this._onGameStartCb = callback;
    if (mgr.onGameStart && !this._gameStartRegistered) {
      this._gameStartRegistered = true;
      mgr.onGameStart(function() {
        self._connected = true;
        console.log("[Online] onGameStart event received");
        if (self._onGameStartCb) self._onGameStartCb();
      });
    }
  },

  startGame: function(callback) {
    var self = this;
    var mgr = this._getManager();
    if (!mgr) { callback(new Error("无 GameServerManager")); return; }
    if (this._connected) { callback(null); return; }
    var called = false;
    function onReady() {
      if (called) return;
      called = true;
      self._connected = true;
      console.log("[Online] game started, _connected=true");
      callback(null);
    }
    if (mgr.onGameStart) {
      this._onGameStartCb = onReady;
      if (!this._gameStartRegistered) {
        this._gameStartRegistered = true;
        mgr.onGameStart(function() {
          self._connected = true;
          console.log("[Online] onGameStart event received");
          if (self._onGameStartCb) self._onGameStartCb();
        });
      }
    }
    mgr.startGame({
      success: function() {
        console.log("[Online] startGame request accepted by server");
        if (!mgr.onGameStart) {
          onReady();
        }
      },
      fail: function(err) {
        console.log("[Online] startGame fail (may auto-start):", JSON.stringify(err));
        if (called) return;
        if (mgr.onGameStart) {
          console.log("[Online] waiting for onGameStart event (auto-start)...");
          setTimeout(function() {
            if (!called) {
              called = true;
              callback(err || new Error("开始游戏失败"));
            }
          }, 5000);
        } else {
          called = true;
          callback(err || new Error("开始游戏失败"));
        }
      }
    });
  },

  sendFrame: function(data) {
    var mgr = this._getManager();
    if (!mgr || !this._connected) {
      console.log("[Online] sendFrame skipped: connected=" + this._connected);
      return false;
    }
    try {
      data._from = this._clientId;
      var frameStr = JSON.stringify(data);
      console.log("[Online] uploadFrame:", frameStr);
      mgr.uploadFrame({
        actionList: [frameStr]
      });
      return true;
    } catch (e) {
      console.error("[Online] sendFrame error:", e);
      return false;
    }
  },

  onFrame: function(callback) {
    this._onFrameCb = callback;
    var self = this;
    var mgr = this._getManager();
    if (!mgr) return;
    mgr.onSyncFrame(function(frame) {
      if (!self._onFrameCb) return;
      try {
        var list = frame.actionList || [];
        if (list.length > 0) {
          console.log("[Online] onSyncFrame: frameId=" + frame.frameId + " count=" + list.length);
        }
        for (var i = 0; i < list.length; i++) {
          var item = list[i];
          var parsed = (typeof item === "string") ? JSON.parse(item) : item;
          if (parsed._from && self._clientId && parsed._from === self._clientId) continue;
          delete parsed._from;
          console.log("[Online] onFrame dispatch:", JSON.stringify(parsed));
          self._onFrameCb(parsed);
        }
      } catch (e) {
        console.error("[Online] onFrame parse error:", e);
      }
    });
  },

  onDisconnect: function(callback) {
    this._onDisconnectCb = callback;
    var self = this;
    var mgr = this._getManager();
    if (!mgr) return;
    if (mgr.onDisconnect) {
      mgr.onDisconnect(function() {
        self._connected = false;
        if (self._onDisconnectCb) self._onDisconnectCb();
      });
    }
  },

  onRoomInfoChange: function(callback) {
    var mgr = this._getManager();
    if (!mgr || !mgr.onRoomInfoChange) return;
    mgr.onRoomInfoChange(function(res) {
      try { callback(res); } catch(e) { console.error("[Online] onRoomInfoChange error:", e); }
    });
  },

  getRoomInfo: function(callback) {
    var mgr = this._getManager();
    if (!mgr) { callback(new Error("无 GameServerManager")); return; }
    mgr.getRoomInfo().then(function(res) {
      callback(null, res);
    }).catch(function(err) {
      callback(err || new Error("获取房间信息失败"));
    });
  },

  leaveRoom: function() {
    var mgr = this._getManager();
    if (!mgr) return;
    try {
      if (mgr.endGame) mgr.endGame();
    } catch (e) {}
    try {
      if (mgr.memberLeaveRoom) mgr.memberLeaveRoom();
    } catch (e) {}
    this._connected = false;
    this._manager = null;
    this._clientId = null;
    this._accessInfo = null;
    this._onFrameCb = null;
    this._onDisconnectCb = null;
    this._onGameStartCb = null;
    this._gameStartRegistered = false;
  },

  _shareImagePath: null,

  generateShareImage: function() {
    if (this._shareImagePath) return this._shareImagePath;
    try {
      var canvas = wx.createCanvas();
      canvas.width = 500; canvas.height = 400;
      var c = canvas.getContext('2d');
      var bg = c.createLinearGradient(0, 0, 0, 400);
      bg.addColorStop(0, '#0d1320'); bg.addColorStop(0.5, '#161e2e'); bg.addColorStop(1, '#0a0e16');
      c.fillStyle = bg; c.fillRect(0, 0, 500, 400);
      c.strokeStyle = 'rgba(80,100,140,0.07)'; c.lineWidth = 1;
      for (var x = 0; x < 500; x += 40) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 400); c.stroke(); }
      for (var y = 0; y < 400; y += 40) { c.beginPath(); c.moveTo(0, y); c.lineTo(500, y); c.stroke(); }
      var beam = c.createLinearGradient(60, 60, 440, 340);
      beam.addColorStop(0, 'rgba(255,80,70,0)'); beam.addColorStop(0.5, 'rgba(255,80,70,0.5)'); beam.addColorStop(1, 'rgba(255,80,70,0)');
      c.strokeStyle = beam; c.lineWidth = 5; c.beginPath(); c.moveTo(60, 60); c.lineTo(440, 340); c.stroke();
      c.shadowColor = 'rgba(255,80,70,0.4)'; c.shadowBlur = 25; c.lineWidth = 2; c.stroke(); c.shadowBlur = 0;
      c.fillStyle = '#f4f7ff'; c.font = 'bold 44px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('镭射棋', 250, 150);
      c.fillStyle = '#5ccbff'; c.font = '20px sans-serif';
      c.fillText('来一局双人对战！', 250, 200);
      c.fillStyle = '#ff4d45'; c.beginPath(); c.arc(160, 300, 24, 0, Math.PI*2); c.fill();
      c.strokeStyle = '#ff8a82'; c.lineWidth = 2; c.stroke();
      c.fillStyle = '#3a8aff'; c.beginPath(); c.arc(340, 300, 24, 0, Math.PI*2); c.fill();
      c.strokeStyle = '#7ab5ff'; c.lineWidth = 2; c.stroke();
      c.fillStyle = '#8998a1'; c.font = 'bold 22px sans-serif';
      c.fillText('对决', 250, 300);
      c.fillStyle = 'rgba(255,255,255,0.1)'; c.font = '12px sans-serif';
      c.fillText('激光对决 · 策略博弈', 250, 360);
      var self = this;
      canvas.toTempFilePath({
        success: function(res) {
          self._shareImagePath = res.tempFilePath;
          console.log('[Online] share image generated:', res.tempFilePath);
        },
        fail: function(err) { console.error('[Online] share image failed:', err); }
      });
    } catch (e) { console.error('[Online] generateShareImage error:', e); }
    return null;
  },

  shareInvite: function(accessInfo) {
    console.log("[Online] shareInvite accessInfo:", accessInfo);
    this.generateShareImage();
    var self = this;
    try {
      wx.showShareMenu({ withShareTicket: true, menus: ["shareAppMessage","shareTimeline"] });
    } catch(e) { console.error("[Online] showShareMenu error:", e); }
    try {
      wx.onShareAppMessage(function(){
        var msg = {
          title: "来打镭射棋！一较高下",
          query: "online=1&room=" + encodeURIComponent(accessInfo)
        };
        if (self._shareImagePath) msg.imageUrl = self._shareImagePath;
        return msg;
      });
    } catch(e) { console.error("[Online] onShareAppMessage error:", e); }
  },

  triggerShare: function(accessInfo) {
    console.log("[Online] triggerShare accessInfo:", accessInfo);
    var msg = {
      title: "来打镭射棋！一较高下",
      query: "online=1&room=" + encodeURIComponent(accessInfo)
    };
    if (this._shareImagePath) msg.imageUrl = this._shareImagePath;
    try {
      wx.shareAppMessage(msg);
    } catch (e) {
      console.error("[Online] triggerShare error:", e);
    }
  },

  getLaunchRoomInfo: function(launchOptions) {
    if (!launchOptions) { console.log("[Online] getLaunchRoomInfo: no launchOptions"); return null; }
    var query = launchOptions.query || {};
    console.log("[Online] getLaunchRoomInfo query:", JSON.stringify(query));
    if (query.online === "1" || query.online === 1) {
      var room = query.room ? decodeURIComponent(query.room) : null;
      console.log("[Online] getLaunchRoomInfo room:", room);
      return room;
    }
    return null;
  }
};

module.exports = Online;
