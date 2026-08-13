"use strict";

var GlbLoader = require("./glb-loader.js");
var COLS = 10, ROWS = 8;
var MODEL_PREFIX = {
  laser:"laser_cannon", king:"king", shield:"shield",
  mirror:"single_mirror", switch:"double_mirror"
};
var RED = [[6,9],[5,9],[4,9],[3,9],[2,9],[1,9],[0,9],[7,1],[0,1]];
var WHITE = [[7,0],[6,0],[5,0],[4,0],[3,0],[2,0],[1,0],[7,8],[0,8]];
var MIRROR_MAP = [{1:0,2:3},{3:0,2:1},{3:2,0:1},{1:2,0:3}];
var SWITCH_MAP = [
  {1:0,0:1,3:2,2:3}, {1:2,2:1,3:0,0:3},
  {1:0,0:1,3:2,2:3}, {1:2,2:1,3:0,0:3}
];

function pieceModelKey(piece){
  var prefix = piece && MODEL_PREFIX[piece.type];
  if(!prefix || (piece.owner !== 0 && piece.owner !== 1)) return null;
  return prefix + (piece.owner === 0 ? "_red" : "_blue");
}

function cellToWorld(row, col){
  return {x:col - (COLS - 1) / 2, y:0, z:row - (ROWS - 1) / 2};
}

function worldToCell(x, z){
  if(!Number.isFinite(x) || !Number.isFinite(z)) return null;
  var col = Math.floor(x + COLS / 2);
  var row = Math.floor(z + ROWS / 2);
  if(row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
  return {r:row, c:col};
}

function sortedCells(source){
  return source.map(function(cell){ return {r:cell[0], c:cell[1]}; })
    .sort(function(a,b){ return a.r - b.r || a.c - b.c; });
}

function zoneCells(){ return {red:sortedCells(RED), white:sortedCells(WHITE)}; }

function orientationAngle(type, orientation){
  if(!MODEL_PREFIX[type] || !Number.isInteger(orientation) || orientation < 0 || orientation > 3)
    return NaN;
  return orientation * Math.PI / 2;
}

function validateMirrorDirections(){
  for(var orientation=0;orientation<4;orientation++){
    var single = MIRROR_MAP[orientation];
    var expectedSingle = [
      {1:0,2:3}, {3:0,2:1}, {3:2,0:1}, {1:2,0:3}
    ][orientation];
    if(JSON.stringify(single) !== JSON.stringify(expectedSingle)) return false;
    var switchTable = SWITCH_MAP[orientation];
    var expectedSwitch = orientation % 2 === 0 ? {1:0,0:1,3:2,2:3} : {1:2,2:1,3:0,0:3};
    if(JSON.stringify(switchTable) !== JSON.stringify(expectedSwitch)) return false;
  }
  return true;
}

function identity(){ return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }

function multiply(a,b){
  var out = new Array(16);
  for(var col=0;col<4;col++) for(var row=0;row<4;row++){
    var sum = 0;
    for(var k=0;k<4;k++) sum += a[k*4+row] * b[col*4+k];
    out[col*4+row] = sum;
  }
  return out;
}

function perspective(fov, aspect, near, far){
  var f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0];
}

function normalize3(v){
  var length = Math.hypot(v[0],v[1],v[2]) || 1;
  return [v[0]/length,v[1]/length,v[2]/length];
}

function lookAt(eye,target,up){
  var z = normalize3([eye[0]-target[0],eye[1]-target[1],eye[2]-target[2]]);
  var x = normalize3([up[1]*z[2]-up[2]*z[1],up[2]*z[0]-up[0]*z[2],up[0]*z[1]-up[1]*z[0]]);
  var y = [z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
  return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
    -(x[0]*eye[0]+x[1]*eye[1]+x[2]*eye[2]),
    -(y[0]*eye[0]+y[1]*eye[1]+y[2]*eye[2]),
    -(z[0]*eye[0]+z[1]*eye[1]+z[2]*eye[2]),1];
}

function modelMatrix(piece){
  var world = cellToWorld(piece.row,piece.col);
  var angle = orientationAngle(piece.type,piece.orientation);
  if(!Number.isFinite(angle)) angle = 0;
  var cos = Math.cos(angle), sin = Math.sin(angle), scale = 0.68;
  return [scale*cos,0,-scale*sin,0, 0,scale,0,0, scale*sin,0,scale*cos,0,
    world.x,0.02,world.z,1];
}

function create(options){
  options = options || {};
  var canvas = options.canvas;
  var state = {mode:"loading", reason:null};
  var gl = null, program = null, resources = {}, board = null, disposed = false;
  var locations = null;

  function fallback(reason){
    disposeResources();
    state = {mode:"fallback", reason:String(reason && reason.message || reason || "WebGL unavailable")};
    return false;
  }

  function compile(type, source){
    var shader = gl.createShader(type);
    if(!shader) throw new Error("shader allocation failed");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){
      var message = gl.getShaderInfoLog(shader) || "shader compilation failed";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function init(){
    try {
      if(!canvas || typeof canvas.getContext !== "function") throw new Error("canvas unavailable");
      gl = canvas.getContext("webgl", {alpha:true, antialias:true});
      if(!gl) throw new Error("WebGL unavailable");
      var vertex = compile(gl.VERTEX_SHADER,
        "attribute vec3 aPosition; attribute vec3 aNormal; uniform mat4 uMvp; uniform mat4 uModel;" +
        "varying vec3 vNormal; void main(){vNormal=mat3(uModel)*aNormal;gl_Position=uMvp*vec4(aPosition,1.0);}");
      var fragment = compile(gl.FRAGMENT_SHADER,
        "precision mediump float; varying vec3 vNormal; uniform vec4 uColor;" +
        "void main(){float l=.35+.65*max(dot(normalize(vNormal),normalize(vec3(.3,.8,.5))),0.0);" +
        "gl_FragColor=vec4(uColor.rgb*l,uColor.a);}");
      program = gl.createProgram();
      if(!program) throw new Error("program allocation failed");
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if(!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "program link failed");
      locations = {
        position:gl.getAttribLocation(program,"aPosition"),
        normal:gl.getAttribLocation(program,"aNormal"),
        mvp:gl.getUniformLocation(program,"uMvp"),
        model:gl.getUniformLocation(program,"uModel"),
        color:gl.getUniformLocation(program,"uColor")
      };
      if(locations.position < 0 || locations.normal < 0 || !locations.mvp || !locations.model || !locations.color)
        throw new Error("required shader locations unavailable");
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      board = createBoard();
      return true;
    } catch(e){ return fallback(e); }
  }

  function createBoard(){
    var positions = [], normals = [], indices = [];
    for(var row=0;row<ROWS;row++) for(var col=0;col<COLS;col++){
      var center = cellToWorld(row,col), base = positions.length / 3;
      positions.push(center.x-.49,0,center.z-.49, center.x+.49,0,center.z-.49,
        center.x+.49,0,center.z+.49, center.x-.49,0,center.z+.49);
      for(var n=0;n<4;n++) normals.push(0,1,0);
      indices.push(base,base+1,base+2, base,base+2,base+3);
    }
    var position = gl.createBuffer(), normal = gl.createBuffer(), index = gl.createBuffer();
    if(!position || !normal || !index) throw new Error("board buffer allocation failed");
    gl.bindBuffer(gl.ARRAY_BUFFER,position);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(positions),gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER,normal);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(normals),gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
    return {position:position,normal:normal,index:index};
  }

  function uploadModel(key, model){
    resources[key] = [];
    model.meshes.forEach(function(mesh){
      mesh.primitives.forEach(function(primitive){
        var position = gl.createBuffer(), normal = gl.createBuffer(), index = gl.createBuffer();
        if(!position || !normal || !index) throw new Error("buffer allocation failed");
        gl.bindBuffer(gl.ARRAY_BUFFER, position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(primitive.positions), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, normal);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(primitive.normals), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(primitive.indices), gl.STATIC_DRAW);
        resources[key].push({position:position, normal:normal, index:index,
          count:primitive.indices.length, material:primitive.material});
      });
    });
  }

  function load(done){
    done = typeof done === "function" ? done : function(){};
    if(!init()){ done(false, state.reason); return; }
    var keys = [];
    Object.keys(MODEL_PREFIX).forEach(function(type){
      keys.push(MODEL_PREFIX[type] + "_red", MODEL_PREFIX[type] + "_blue");
    });
    var pending = keys.length, failed = false;
    keys.forEach(function(key){
      options.readAsset("games/laser/models/" + key + ".glb", function(error, data){
        if(disposed || failed) return;
        if(error){ failed = true; done(fallback(error), state.reason); return; }
        try { uploadModel(key, GlbLoader.parseGlb(data)); }
        catch(e){ failed = true; done(fallback(e), state.reason); return; }
        pending--;
        if(!pending){ state = {mode:"ready", reason:null}; done(true); }
      });
    });
  }

  function disposeResources(){
    if(gl){
      if(board){ gl.deleteBuffer(board.position); gl.deleteBuffer(board.normal); gl.deleteBuffer(board.index); }
      Object.keys(resources).forEach(function(key){
        resources[key].forEach(function(item){
          if(item.position) gl.deleteBuffer(item.position);
          if(item.normal) gl.deleteBuffer(item.normal);
          if(item.index) gl.deleteBuffer(item.index);
        });
      });
      if(program) gl.deleteProgram(program);
    }
    resources = {}; board = null; program = null; locations = null;
  }

  function bindAttributes(part){
    gl.bindBuffer(gl.ARRAY_BUFFER,part.position);
    gl.enableVertexAttribArray(locations.position);
    gl.vertexAttribPointer(locations.position,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,part.normal);
    gl.enableVertexAttribArray(locations.normal);
    gl.vertexAttribPointer(locations.normal,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,part.index);
  }

  function colorForCell(row,col){
    var key = row + "," + col;
    for(var i=0;i<RED.length;i++) if(RED[i][0]+","+RED[i][1] === key) return [0.62,0.12,0.10,1];
    for(var j=0;j<WHITE.length;j++) if(WHITE[j][0]+","+WHITE[j][1] === key) return [0.82,0.84,0.88,1];
    return (row+col)%2 ? [0.20,0.22,0.28,1] : [0.29,0.32,0.39,1];
  }

  function render(scene){
    if(disposed || state.mode !== "ready") return false;
    try {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      var camera = scene.camera || {yaw:0,pitch:.95};
      var distance = 14;
      var eye = [Math.sin(camera.yaw||0)*distance*Math.cos(camera.pitch||.95),
        distance*Math.sin(camera.pitch||.95),
        Math.cos(camera.yaw||0)*distance*Math.cos(camera.pitch||.95)];
      var projection = perspective(Math.PI/4,canvas.width/Math.max(canvas.height,1),.1,50);
      var viewProjection = multiply(projection,lookAt(eye,[0,0,0],[0,1,0]));
      var boardModel = identity();
      bindAttributes(board);
      gl.uniformMatrix4fv(locations.model,false,new Float32Array(boardModel));
      gl.uniformMatrix4fv(locations.mvp,false,new Float32Array(multiply(viewProjection,boardModel)));
      for(var row=0;row<ROWS;row++) for(var col=0;col<COLS;col++){
        gl.uniform4fv(locations.color,new Float32Array(colorForCell(row,col)));
        gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_SHORT,(row*COLS+col)*12);
      }
      (scene.pieces || []).forEach(function(piece){
        if(!piece.alive) return;
        var parts = resources[pieceModelKey(piece)] || [];
        var model = modelMatrix(piece);
        gl.uniformMatrix4fv(locations.model,false,new Float32Array(model));
        gl.uniformMatrix4fv(locations.mvp,false,new Float32Array(multiply(viewProjection,model)));
        parts.forEach(function(part){
          bindAttributes(part);
          gl.uniform4fv(locations.color,new Float32Array(part.material.baseColorFactor));
          gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_SHORT, 0);
        });
      });
      return true;
    } catch(e){ return fallback(e); }
  }

  function dispose(){ if(disposed) return; disposed = true; disposeResources(); }
  function resize(width,height,dpr){
    if(!canvas) return;
    var scale = Math.min(Math.max(dpr || 1, 1), 2);
    canvas.width = Math.max(1, Math.floor(width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));
  }

  return {load:load, render:render, pick:function(){ return null; }, resize:resize,
    dispose:dispose, status:function(){ return {mode:state.mode, reason:state.reason}; }};
}

module.exports = {
  create:create,
  pieceModelKey:pieceModelKey,
  cellToWorld:cellToWorld,
  worldToCell:worldToCell,
  zoneCells:zoneCells,
  orientationAngle:orientationAngle,
  validateMirrorDirections:validateMirrorDirections
};
