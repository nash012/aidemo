"use strict";

var GlbLoader = require("./glb-loader.js");
var COLS = 10, ROWS = 8;
var MODEL_PREFIX = {
  laser:"laser_cannon", king:"king", shield:"shield",
  mirror:"single_mirror", switch:"double_mirror"
};
var RED = [[6,9],[5,9],[4,9],[3,9],[2,9],[1,9],[0,9],[7,1],[0,1]];
var WHITE = [[7,0],[6,0],[5,0],[4,0],[3,0],[2,0],[1,0],[7,8],[0,8]];
var MIRROR_MAP = [{0:1,3:2},{0:3,1:2},{1:0,2:3},{2:1,3:0}];
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
  if(!MODEL_PREFIX[type] || !Number.isFinite(orientation))
    return NaN;
  if(type === "mirror") return -orientation * Math.PI / 2;
  if(type === "switch") return Math.PI / 4 + orientation * Math.PI / 2;
  return Math.PI - orientation * Math.PI / 2;
}

function validateMirrorDirections(authoredNormal,doubleSided){
  authoredNormal=authoredNormal || [0,1];
  if(!Array.isArray(authoredNormal) || authoredNormal.length!==2 ||
     !Number.isFinite(authoredNormal[0]) || !Number.isFinite(authoredNormal[1])) return false;
  var normalLength=Math.hypot(authoredNormal[0],authoredNormal[1]);
  if(normalLength<.9) return false;
  var localX=authoredNormal[0]/normalLength,localZ=authoredNormal[1]/normalLength;
  var directions = [[0,-1],[1,0],[0,1],[-1,0]];
  function reflected(inDir, angle){
    var d = directions[inDir];
    var nx=Math.cos(angle)*localX+Math.sin(angle)*localZ;
    var nz=-Math.sin(angle)*localX+Math.cos(angle)*localZ;
    var dot = d[0]*nx + d[1]*nz;
    var rx = d[0] - 2*dot*nx, rz = d[1] - 2*dot*nz;
    var best = -1, bestDot = -Infinity;
    for(var i=0;i<4;i++){
      var score = rx*directions[i][0] + rz*directions[i][1];
      if(score > bestDot){ bestDot = score; best = i; }
    }
    return best;
  }
  for(var orientation=0;orientation<4;orientation++){
    if(doubleSided){
      var switchTable = SWITCH_MAP[orientation];
      var switchAngle = orientationAngle("switch", orientation);
      for(var input=0;input<4;input++) if(reflected(input, switchAngle) !== switchTable[input]) return false;
    } else {
      var single = MIRROR_MAP[orientation];
      var singleAngle = orientationAngle("mirror", orientation);
      var nx=Math.cos(singleAngle)*localX+Math.sin(singleAngle)*localZ;
      var nz=-Math.sin(singleAngle)*localX+Math.cos(singleAngle)*localZ;
      for(var inDir=0;inDir<4;inDir++){
        // The GLB normal points out of the visible mirror surface. Incoming
        // light must travel against it; a positive dot product is the back.
        var facesMirror=directions[inDir][0]*nx+directions[inDir][1]*nz<-.5;
        var mapped=single[inDir];
        if(facesMirror !== (mapped!==undefined)) return false;
        if(facesMirror && reflected(inDir,singleAngle)!==mapped) return false;
      }
    }
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

function cameraData(width,height,camera){
  camera = camera || {yaw:0,pitch:.95};
  var yaw = Number.isFinite(camera.yaw) ? camera.yaw : 0;
  var pitch = Number.isFinite(camera.pitch) ? camera.pitch : .95;
  var distance = Number.isFinite(camera.distance) ? camera.distance : 14;
  var offsetY = Number.isFinite(camera.offsetY) ? camera.offsetY : 0;
  var eye = [Math.sin(yaw)*distance*Math.cos(pitch),
    distance*Math.sin(pitch), Math.cos(yaw)*distance*Math.cos(pitch)];
  var forward = normalize3([-eye[0],-eye[1],-eye[2]]);
  var right = normalize3([-forward[2],0,forward[0]]);
  var up = [
    right[1]*forward[2]-right[2]*forward[1],
    right[2]*forward[0]-right[0]*forward[2],
    right[0]*forward[1]-right[1]*forward[0]
  ];
  var projection = perspective(Math.PI/4,width/Math.max(height,1),.1,50);
  projection[9] = 2 * offsetY / Math.max(height,1);
  return {eye:eye,forward:forward,right:right,up:up,
    viewProjection:multiply(projection,lookAt(eye,[0,0,0],[0,1,0]))};
}

function projectCell(row,col,width,height,camera){
  var world = cellToWorld(row,col), matrix = cameraData(width,height,camera).viewProjection;
  var x = matrix[0]*world.x + matrix[8]*world.z + matrix[12];
  var y = matrix[1]*world.x + matrix[9]*world.z + matrix[13];
  var w = matrix[3]*world.x + matrix[11]*world.z + matrix[15];
  if(!Number.isFinite(w) || w <= 0) return null;
  return {x:(x/w*.5+.5)*width, y:(.5-y/w*.5)*height};
}

function modelMatrix(piece,pose){
  pose = pose || piece;
  var world = cellToWorld(pose.row,pose.col);
  var angle = orientationAngle(piece.type,pose.orientation);
  if(!Number.isFinite(angle)) angle = 0;
  var cos = Math.cos(angle), sin = Math.sin(angle), scale = 0.68;
  return [scale*cos,0,-scale*sin,0, 0,scale,0,0, scale*sin,0,scale*cos,0,
    world.x,0.02+(pose.height||0),world.z,1];
}

function create(options){
  options = options || {};
  var canvas = options.canvas;
  var state = {mode:"loading", reason:null};
  var gl = null, program = null, resources = {}, board = null, boardEdge = null, beam = null, ring = null, disposed = false;
  var displayWidth = canvas && canvas.width || 1, displayHeight = canvas && canvas.height || 1;
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
    var vertex = null, fragment = null;
    try {
      if(!canvas || typeof canvas.getContext !== "function") throw new Error("canvas unavailable");
      gl = canvas.getContext("webgl", {alpha:true, antialias:true, preserveDrawingBuffer:true});
      if(!gl) throw new Error("WebGL unavailable");
      vertex = compile(gl.VERTEX_SHADER,
        "attribute vec3 aPosition; attribute vec3 aNormal; uniform mat4 uMvp; uniform mat4 uModel;" +
        "varying vec3 vNormal; varying vec3 vLocalNormal; void main(){vLocalNormal=aNormal;" +
        "vNormal=mat3(uModel)*aNormal;gl_Position=uMvp*vec4(aPosition,1.0);}");
      fragment = compile(gl.FRAGMENT_SHADER,
        "precision mediump float; varying vec3 vNormal; varying vec3 vLocalNormal; uniform vec4 uColor;" +
        "void main(){vec4 base=uColor;bool oneSided=base.a>1.5;" +
        "float mirrorSide=dot(normalize(vLocalNormal),normalize(vec3(1.0,0.0,1.0)));" +
        "if(oneSided&&mirrorSide<.65)base=vec4(.025,.030,.042,1.0);else base.a=min(base.a,1.0);" +
        "float l=.58+.42*max(dot(normalize(vNormal),normalize(vec3(.3,.8,.5))),0.0);" +
        "gl_FragColor=vec4(base.rgb*l,base.a);}");
      program = gl.createProgram();
      if(!program) throw new Error("program allocation failed");
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      vertex = null; fragment = null;
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
      boardEdge = createBoardEdge();
      beam = createBeam();
      ring = createRing();
      return true;
    } catch(e){
      if(gl && vertex) gl.deleteShader(vertex);
      if(gl && fragment) gl.deleteShader(fragment);
      return fallback(e);
    }
  }

  function withBuffers(message, upload){
    var item = {position:null, normal:null, index:null};
    try {
      item.position=gl.createBuffer(); item.normal=gl.createBuffer(); item.index=gl.createBuffer();
      if(!item.position || !item.normal || !item.index) throw new Error(message);
      upload(item);
      return item;
    } catch(e){
      if(item.position) gl.deleteBuffer(item.position);
      if(item.normal) gl.deleteBuffer(item.normal);
      if(item.index) gl.deleteBuffer(item.index);
      throw e;
    }
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
    return withBuffers("board buffer allocation failed",function(item){
    gl.bindBuffer(gl.ARRAY_BUFFER,item.position);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(positions),gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER,item.normal);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(normals),gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,item.index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
    });
  }

  function createBoardEdge(){
    var positions=[
      -5,0,-4, 5,0,-4, 5,-.24,-4, -5,-.24,-4,
      5,0,-4, 5,0,4, 5,-.24,4, 5,-.24,-4,
      5,0,4, -5,0,4, -5,-.24,4, 5,-.24,4,
      -5,0,4, -5,0,-4, -5,-.24,-4, -5,-.24,4
    ];
    var normals=[]; for(var n=0;n<16;n++) normals.push(0,.25,.97);
    var indices=[]; for(var side=0;side<4;side++){
      var base=side*4; indices.push(base,base+1,base+2,base,base+2,base+3);
    }
    var item=withBuffers("board edge buffer allocation failed",function(buffers){
      gl.bindBuffer(gl.ARRAY_BUFFER,buffers.position); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(positions),gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER,buffers.normal); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(normals),gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffers.index); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
    });
    item.count=indices.length; return item;
  }

  function createBeam(){
    return withBuffers("beam buffer allocation failed",function(item){
    gl.bindBuffer(gl.ARRAY_BUFFER,item.normal);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,1,0,0,1,0,0,1,0,0,1,0]),gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,item.index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([0,1,2,0,2,3]),gl.STATIC_DRAW);
    });
  }

  function createRing(){
    var positions=[],normals=[],indices=[],segments=24,inner=.31,outer=.42;
    for(var i=0;i<segments;i++){
      var angle=i*Math.PI*2/segments,cos=Math.cos(angle),sin=Math.sin(angle);
      positions.push(cos*inner,.035,sin*inner,cos*outer,.035,sin*outer);
      normals.push(0,1,0,0,1,0);
      var next=(i+1)%segments;
      indices.push(i*2,i*2+1,next*2+1,i*2,next*2+1,next*2);
    }
    var item=withBuffers("ring buffer allocation failed",function(buffers){
      gl.bindBuffer(gl.ARRAY_BUFFER,buffers.position); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(positions),gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER,buffers.normal); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(normals),gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffers.index); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
    });
    item.count=indices.length; return item;
  }

  function uploadModel(key, model){
    resources[key] = [];
    model.meshes.forEach(function(mesh){
      mesh.primitives.forEach(function(primitive){
        var item = withBuffers("buffer allocation failed",function(buffers){
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(primitive.positions), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(primitive.normals), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(primitive.indices), gl.STATIC_DRAW);
        });
        item.count=primitive.indices.length; item.material=primitive.material;
        item.singleMirrorFace=key.indexOf("single_mirror_")===0 && /_Mirror_Face$/.test(mesh.name);
        resources[key].push(item);
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
        try {
          var model=GlbLoader.parseGlb(data);
          if(key.indexOf("single_mirror_") === 0 || key.indexOf("double_mirror_") === 0){
            var normals=GlbLoader.mirrorSurfaceNormals(model);
            var doubleSided=key.indexOf("double_mirror_")===0;
            if(!validateMirrorDirections(normals[0],doubleSided))
              throw new Error("mirror surface normal disagrees with game rules");
          }
          uploadModel(key, model);
        }
        catch(e){ failed = true; done(fallback(e), state.reason); return; }
        pending--;
        if(!pending){ state = {mode:"ready", reason:null}; done(true); }
      });
    });
  }

  function disposeResources(){
    if(gl){
      if(board){ gl.deleteBuffer(board.position); gl.deleteBuffer(board.normal); gl.deleteBuffer(board.index); }
      if(boardEdge){ gl.deleteBuffer(boardEdge.position); gl.deleteBuffer(boardEdge.normal); gl.deleteBuffer(boardEdge.index); }
      if(beam){ gl.deleteBuffer(beam.position); gl.deleteBuffer(beam.normal); gl.deleteBuffer(beam.index); }
      if(ring){ gl.deleteBuffer(ring.position); gl.deleteBuffer(ring.normal); gl.deleteBuffer(ring.index); }
      Object.keys(resources).forEach(function(key){
        resources[key].forEach(function(item){
          if(item.position) gl.deleteBuffer(item.position);
          if(item.normal) gl.deleteBuffer(item.normal);
          if(item.index) gl.deleteBuffer(item.index);
        });
      });
      if(program) gl.deleteProgram(program);
    }
    resources = {}; board = null; boardEdge = null; beam = null; ring = null; program = null; locations = null;
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

  function validPath(path){
    if(!Array.isArray(path) || path.length < 2) return false;
    for(var i=0;i<path.length;i++) if(!path[i] || !Number.isFinite(path[i].r) ||
      !Number.isFinite(path[i].c)) return false;
    return true;
  }

  function drawBeamSegment(a,b,width,viewProjection,color){
    var aw=cellToWorld(a.r,a.c), bw=cellToWorld(b.r,b.c);
    var dx=bw.x-aw.x,dz=bw.z-aw.z,length=Math.hypot(dx,dz);
    if(!length) return;
    var px=-dz/length*width,pz=dx/length*width,y=.34;
    gl.bindBuffer(gl.ARRAY_BUFFER,beam.position);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([
      aw.x+px,y,aw.z+pz, aw.x-px,y,aw.z-pz,
      bw.x-px,y,bw.z-pz, bw.x+px,y,bw.z+pz
    ]),gl.DYNAMIC_DRAW || gl.STATIC_DRAW);
    bindAttributes(beam);
    var model=identity();
    gl.uniformMatrix4fv(locations.model,false,new Float32Array(model));
    gl.uniformMatrix4fv(locations.mvp,false,new Float32Array(multiply(viewProjection,model)));
    gl.uniform4fv(locations.color,new Float32Array(color));
    gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_SHORT,0);
  }

  function drawBeam(path,progress,viewProjection){
    if(!validPath(path)) return;
    progress = Number.isFinite(progress) ? Math.max(0,Math.min(1,progress)) : 1;
    var upto = progress * (path.length - 1);
    for(var i=0;i<path.length-1 && upto>i;i++){
      var end = path[i+1], fraction = Math.min(1,upto-i);
      if(fraction < 1) end = {
        r:path[i].r+(end.r-path[i].r)*fraction,
        c:path[i].c+(end.c-path[i].c)*fraction
      };
      gl.depthMask(false);
      drawBeamSegment(path[i],end,.11,viewProjection,[1,.25,.03,.28]);
      gl.depthMask(true);
      drawBeamSegment(path[i],end,.035,viewProjection,[1,.93,.45,1]);
    }
  }

  function drawRing(row,col,viewProjection,color){
    if(!Number.isFinite(row) || !Number.isFinite(col)) return;
    var world=cellToWorld(row,col),model=identity(); model[12]=world.x; model[14]=world.z;
    bindAttributes(ring);
    gl.uniformMatrix4fv(locations.model,false,new Float32Array(model));
    gl.uniformMatrix4fv(locations.mvp,false,new Float32Array(multiply(viewProjection,model)));
    gl.uniform4fv(locations.color,new Float32Array(color));
    gl.drawElements(gl.TRIANGLES,ring.count,gl.UNSIGNED_SHORT,0);
  }

  function render(scene){
    if(disposed || state.mode !== "ready") return false;
    try {
      if(typeof gl.isContextLost === "function" && gl.isContextLost())
        throw new Error("WebGL context lost");
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      var viewProjection = cameraData(displayWidth,displayHeight,scene.camera).viewProjection;
      var boardModel = identity();
      bindAttributes(board);
      gl.uniformMatrix4fv(locations.model,false,new Float32Array(boardModel));
      gl.uniformMatrix4fv(locations.mvp,false,new Float32Array(multiply(viewProjection,boardModel)));
      for(var row=0;row<ROWS;row++) for(var col=0;col<COLS;col++){
        gl.uniform4fv(locations.color,new Float32Array(colorForCell(row,col)));
        gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_SHORT,(row*COLS+col)*12);
      }
      bindAttributes(boardEdge);
      gl.uniform4fv(locations.color,new Float32Array([.08,.09,.13,1]));
      gl.drawElements(gl.TRIANGLES,boardEdge.count,gl.UNSIGNED_SHORT,0);
      (scene.pieces || []).forEach(function(piece,pieceIndex){
        if(!piece.alive) return;
        var parts = resources[pieceModelKey(piece)] || [];
        var poses = scene.aiPose && scene.aiPose.poses;
        var pose = poses && (poses[pieceIndex] || poses[String(pieceIndex)]);
        var model = modelMatrix(piece,pose);
        gl.uniformMatrix4fv(locations.model,false,new Float32Array(model));
        gl.uniformMatrix4fv(locations.mvp,false,new Float32Array(multiply(viewProjection,model)));
        parts.forEach(function(part){
          bindAttributes(part);
          var partColor=part.material.baseColorFactor.slice();
          // Alpha > 1 is an internal shader flag. The shader restores output
          // alpha to 1 and darkens normals that face away from the authored
          // single-mirror reflective normal (+X,+Z).
          if(part.singleMirrorFace) partColor[3]=2;
          gl.uniform4fv(locations.color,new Float32Array(partColor));
          gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_SHORT, 0);
        });
      });
      if(scene.selected >= 0 && scene.pieces && scene.pieces[scene.selected]){
        var selected=scene.pieces[scene.selected];
        drawRing(selected.row,selected.col,viewProjection,[1,.82,.18,.85]);
      }
      (scene.targets || []).forEach(function(target){
        drawRing(target.r,target.c,viewProjection,[.18,.65,1,.70]);
      });
      drawBeam(scene.path,scene.beamProgress,viewProjection);
      // WeChat composes this offscreen WebGL canvas into the main 2D canvas
      // immediately after render(). Wait for the complete frame so slower
      // mobile GPUs cannot expose a board-only or partially drawn piece frame.
      if(typeof gl.finish === "function") gl.finish();
      return true;
    } catch(e){ return fallback(e); }
  }

  function dispose(){ if(disposed) return; disposed = true; disposeResources(); }
  function resize(width,height,dpr){
    if(!canvas) return;
    displayWidth = Math.max(1,width || 1); displayHeight = Math.max(1,height || 1);
    var scale = Math.min(Math.max(dpr || 1, 1), 2);
    canvas.width = Math.max(1, Math.floor(displayWidth * scale));
    canvas.height = Math.max(1, Math.floor(displayHeight * scale));
  }

  function pick(x,y,camera){
    if(state.mode !== "ready" || !Number.isFinite(x) || !Number.isFinite(y) ||
       x < 0 || y < 0 || x > displayWidth || y > displayHeight) return null;
    var data = cameraData(displayWidth,displayHeight,camera);
    var ndcX = x/displayWidth*2-1;
    var offsetY = camera && Number.isFinite(camera.offsetY) ? camera.offsetY : 0;
    var ndcY = 1-y/displayHeight*2 + 2*offsetY/displayHeight;
    var tan = Math.tan(Math.PI/8), aspect = displayWidth/displayHeight;
    var direction = normalize3([
      data.forward[0] + data.right[0]*ndcX*tan*aspect + data.up[0]*ndcY*tan,
      data.forward[1] + data.right[1]*ndcX*tan*aspect + data.up[1]*ndcY*tan,
      data.forward[2] + data.right[2]*ndcX*tan*aspect + data.up[2]*ndcY*tan
    ]);
    if(Math.abs(direction[1]) < 1e-8) return null;
    var distance = -data.eye[1]/direction[1];
    if(distance <= 0 || !Number.isFinite(distance)) return null;
    return worldToCell(data.eye[0]+direction[0]*distance,
      data.eye[2]+direction[2]*distance);
  }

  return {load:load, render:render, pick:pick, resize:resize,
    dispose:dispose, status:function(){ return {mode:state.mode, reason:state.reason}; }};
}

module.exports = {
  create:create,
  pieceModelKey:pieceModelKey,
  cellToWorld:cellToWorld,
  worldToCell:worldToCell,
  zoneCells:zoneCells,
  orientationAngle:orientationAngle,
  validateMirrorDirections:validateMirrorDirections,
  projectCell:projectCell
};
