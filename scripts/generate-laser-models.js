"use strict";

// Deterministic low-poly GLB generator for the five laser-board piece types.
// The runtime loader intentionally supports only a small glTF 2.0 subset, so
// keeping the source geometry here makes every shipped model reproducible.

var fs = require("node:fs");
var path = require("node:path");

var OUTPUT_DIR = path.join(__dirname, "..", "games", "laser", "models");
var SQRT_HALF = Math.SQRT1_2;
var TAU = Math.PI * 2;

var PALETTES = {
  red:{
    main:[.98,.045,.028,1], dark:[.24,.026,.035,1],
    accent:[1,.42,.045,1], optical:[.72,.94,1,1]
  },
  blue:{
    main:[.028,.38,1,1], dark:[.022,.075,.24,1],
    accent:[.06,.82,1,1], optical:[.72,.94,1,1]
  }
};

function add(a,b){ return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]; }
function sub(a,b){ return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
function mul(a,s){ return [a[0]*s,a[1]*s,a[2]*s]; }
function cross(a,b){ return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
function normalize(a){ var n=Math.hypot(a[0],a[1],a[2])||1; return mul(a,1/n); }

function merge(parts){
  var positions=[],normals=[],indices=[];
  parts.forEach(function(part){
    var base=positions.length/3;
    positions.push.apply(positions,part.positions);
    normals.push.apply(normals,part.normals);
    part.indices.forEach(function(index){ indices.push(base+index); });
  });
  return {positions:positions,normals:normals,indices:indices};
}

function polygonFace(points,normal,reverse){
  var positions=[],normals=[],indices=[];
  points.forEach(function(point){ positions.push.apply(positions,point); normals.push.apply(normals,normal); });
  for(var i=1;i<points.length-1;i++){
    if(reverse) indices.push(0,i+1,i); else indices.push(0,i,i+1);
  }
  return {positions:positions,normals:normals,indices:indices};
}

function quad(a,b,c,d,normal){
  return {positions:a.concat(b,c,d),normals:normal.concat(normal,normal,normal),indices:[0,1,2,0,2,3]};
}

function box(cx,cy,cz,sx,sy,sz,yaw){
  yaw=yaw||0;
  var cos=Math.cos(yaw),sin=Math.sin(yaw),hx=sx/2,hy=sy/2,hz=sz/2;
  function point(x,y,z){ return [cx+x*cos+z*sin,cy+y,cz-x*sin+z*cos]; }
  function normal(x,y,z){ return [x*cos+z*sin,y,-x*sin+z*cos]; }
  return merge([
    quad(point(-hx,-hy,hz),point(hx,-hy,hz),point(hx,hy,hz),point(-hx,hy,hz),normal(0,0,1)),
    quad(point(hx,-hy,-hz),point(-hx,-hy,-hz),point(-hx,hy,-hz),point(hx,hy,-hz),normal(0,0,-1)),
    quad(point(hx,-hy,hz),point(hx,-hy,-hz),point(hx,hy,-hz),point(hx,hy,hz),normal(1,0,0)),
    quad(point(-hx,-hy,-hz),point(-hx,-hy,hz),point(-hx,hy,hz),point(-hx,hy,-hz),normal(-1,0,0)),
    quad(point(-hx,hy,hz),point(hx,hy,hz),point(hx,hy,-hz),point(-hx,hy,-hz),normal(0,1,0)),
    quad(point(-hx,-hy,-hz),point(hx,-hy,-hz),point(hx,-hy,hz),point(-hx,-hy,hz),normal(0,-1,0))
  ]);
}

function frustumY(cx,y0,cz,r0,r1,height,segments,phase){
  phase=phase||Math.PI/8;
  var parts=[],top=[],bottom=[];
  for(var i=0;i<segments;i++){
    var a=phase+i*TAU/segments,b=phase+(i+1)*TAU/segments;
    var p0=[cx+Math.cos(a)*r0,y0,cz+Math.sin(a)*r0];
    var p1=[cx+Math.cos(b)*r0,y0,cz+Math.sin(b)*r0];
    var p2=[cx+Math.cos(b)*r1,y0+height,cz+Math.sin(b)*r1];
    var p3=[cx+Math.cos(a)*r1,y0+height,cz+Math.sin(a)*r1];
    var n=normalize(cross(sub(p1,p0),sub(p3,p0)));
    parts.push(quad(p0,p1,p2,p3,n));
    bottom.push(p0);top.unshift(p3);
  }
  parts.push(polygonFace(bottom,[0,-1,0],true));
  parts.push(polygonFace(top,[0,1,0],true));
  return merge(parts);
}

function cylinderBetween(start,end,radius,segments){
  var axis=normalize(sub(end,start));
  var reference=Math.abs(axis[1])<.9?[0,1,0]:[1,0,0];
  var u=normalize(cross(axis,reference)),v=normalize(cross(u,axis));
  var parts=[],startCap=[],endCap=[];
  for(var i=0;i<segments;i++){
    var a=i*TAU/segments,b=(i+1)*TAU/segments;
    var na=add(mul(u,Math.cos(a)),mul(v,Math.sin(a)));
    var nb=add(mul(u,Math.cos(b)),mul(v,Math.sin(b)));
    var p0=add(start,mul(na,radius)),p1=add(start,mul(nb,radius));
    var p2=add(end,mul(nb,radius)),p3=add(end,mul(na,radius));
    var sideNormal=normalize(add(na,nb));
    parts.push(quad(p0,p1,p2,p3,sideNormal));
    startCap.push(p0);endCap.unshift(p3);
  }
  parts.push(polygonFace(startCap,mul(axis,-1),true));
  parts.push(polygonFace(endCap,axis,true));
  return merge(parts);
}

function ringBetween(start,end,inner,outer,segments){
  var axis=normalize(sub(end,start));
  var reference=Math.abs(axis[1])<.9?[0,1,0]:[1,0,0];
  var u=normalize(cross(axis,reference)),v=normalize(cross(u,axis)),parts=[];
  for(var i=0;i<segments;i++){
    var a=i*TAU/segments,b=(i+1)*TAU/segments;
    var na=add(mul(u,Math.cos(a)),mul(v,Math.sin(a)));
    var nb=add(mul(u,Math.cos(b)),mul(v,Math.sin(b)));
    var soA=add(start,mul(na,outer)),soB=add(start,mul(nb,outer));
    var eoA=add(end,mul(na,outer)),eoB=add(end,mul(nb,outer));
    var siA=add(start,mul(na,inner)),siB=add(start,mul(nb,inner));
    var eiA=add(end,mul(na,inner)),eiB=add(end,mul(nb,inner));
    var sideNormal=normalize(add(na,nb));
    parts.push(quad(soA,soB,eoB,eoA,sideNormal));
    parts.push(quad(siB,siA,eiA,eiB,mul(sideNormal,-1)));
    parts.push(quad(soB,soA,siA,siB,mul(axis,-1)));
    parts.push(quad(eoA,eoB,eiB,eiA,axis));
  }
  return merge(parts);
}

function extrudeXY(points,z0,z1){
  var front=points.map(function(p){return [p[0],p[1],z1];});
  var back=points.slice().reverse().map(function(p){return [p[0],p[1],z0];});
  var parts=[polygonFace(front,[0,0,1],false),polygonFace(back,[0,0,-1],false)];
  for(var i=0;i<points.length;i++){
    var j=(i+1)%points.length;
    var a=[points[i][0],points[i][1],z0],b=[points[j][0],points[j][1],z0];
    var c=[points[j][0],points[j][1],z1],d=[points[i][0],points[i][1],z1];
    parts.push(quad(a,b,c,d,normalize(cross(sub(b,a),sub(d,a)))));
  }
  return merge(parts);
}

function verticalPlane(center,tangent,width,y0,y1,normal){
  var half=mul(tangent,width/2),low=[center[0],y0,center[2]],high=[center[0],y1,center[2]];
  var a=sub(low,half),b=add(low,half),c=add(high,half),d=sub(high,half);
  return quad(a,b,c,d,normal);
}

function Builder(faction){
  var palette=PALETTES[faction];
  this.faction=faction;
  this.materials=[
    {name:faction,color:palette.main,metallic:.72,roughness:.27,emissive:[0,0,0]},
    {name:faction+"_dark",color:palette.dark,metallic:.82,roughness:.30,emissive:[0,0,0]},
    {name:"gunmetal",color:[.045,.070,.11,1],metallic:.90,roughness:.24,emissive:[0,0,0]},
    {name:"mirror",color:palette.optical,metallic:.76,roughness:.08,
      emissive:palette.optical.slice(0,3).map(function(value){return value*.08;}),doubleSided:true},
    {name:"accent",color:palette.accent,metallic:.28,roughness:.16,
      emissive:palette.accent.slice(0,3).map(function(value){return value*.62;})}
  ];
  this.materialMap={main:0,dark:1,gunmetal:2,mirror:3,accent:4};
  this.meshes=[];
}
Builder.prototype.add=function(name,geometry,material){
  this.meshes.push({name:name,geometry:geometry,material:this.materialMap[material]});
};
Builder.prototype.base=function(prefix){
  this.add(prefix+"_Base_Lower",frustumY(0,0,0,.51,.48,.105,8),"gunmetal");
  this.add(prefix+"_Base_Band",frustumY(0,.105,0,.45,.41,.09,8),"main");
  this.add(prefix+"_Base_Deck",frustumY(0,.195,0,.36,.34,.075,8),"dark");
  this.add(prefix+"_Status_Light",box(0,.145,.455,.18,.045,.025),"accent");
};

function buildLaser(faction){
  var b=new Builder(faction),p="laser_cannon_"+faction;
  // A layered rotating plinth gives the cannon the weight of an optical
  // instrument while the 16-sided rings retain clean highlights up close.
  b.add(p+"_Base_Lower",frustumY(0,0,0,.52,.50,.08,16),"gunmetal");
  b.add(p+"_Base_Armor",frustumY(0,.08,0,.49,.44,.10,12),"main");
  b.add(p+"_Base_Light_Ring",ringBetween([0,.18,0],[0,.205,0],.37,.445,16),"accent");
  b.add(p+"_Base_Deck",frustumY(0,.205,0,.39,.35,.085,12),"dark");
  b.add(p+"_Yaw_Bearing",frustumY(0,.29,0,.31,.30,.075,16),"gunmetal");
  b.add(p+"_Front_Status",box(0,.13,.495,.22,.055,.028),"accent");

  // Twin armored yokes frame the barrel and make its firing direction legible
  // even when the circular aperture faces away from the camera.
  b.add(p+"_Yoke_Left",box(-.285,.515,-.015,.145,.40,.40,-.06),"main");
  b.add(p+"_Yoke_Right",box(.285,.515,-.015,.145,.40,.40,.06),"main");
  b.add(p+"_Yoke_Left_Inset",box(-.286,.515,.01,.075,.27,.30,-.06),"dark");
  b.add(p+"_Yoke_Right_Inset",box(.286,.515,.01,.075,.27,.30,.06),"dark");
  b.add(p+"_Left_Pivot_Rim",ringBetween([-.37,.54,0],[-.285,.54,0],.075,.145,16),"gunmetal");
  b.add(p+"_Right_Pivot_Rim",ringBetween([.285,.54,0],[.37,.54,0],.075,.145,16),"gunmetal");
  b.add(p+"_Left_Pivot_Core",cylinderBetween([-.385,.54,0],[-.365,.54,0],.078,16),"accent");
  b.add(p+"_Right_Pivot_Core",cylinderBetween([.365,.54,0],[.385,.54,0],.078,16),"accent");

  b.add(p+"_Rear_Power_Cell",cylinderBetween([0,.555,-.30],[0,.555,-.16],.155,16),"dark");
  b.add(p+"_Barrel_Core",cylinderBetween([0,.555,-.18],[0,.555,.35],.168,16),"gunmetal");
  b.add(p+"_Barrel_Armor_Top",box(0,.715,.08,.29,.085,.36),"main");
  b.add(p+"_Barrel_Armor_Left",box(-.15,.575,.08,.07,.20,.34,-.03),"main");
  b.add(p+"_Barrel_Armor_Right",box(.15,.575,.08,.07,.20,.34,.03),"main");
  b.add(p+"_Focus_Collar",ringBetween([0,.555,.30],[0,.555,.405],.115,.205,20),"main");
  b.add(p+"_Emitter_Rim",ringBetween([0,.555,.395],[0,.555,.485],.125,.225,24),"gunmetal");
  b.add(p+"_Emitter_Glass",cylinderBetween([0,.555,.477],[0,.555,.493],.128,24),"mirror");
  b.add(p+"_Emitter_Inner_Ring",ringBetween([0,.555,.49],[0,.555,.505],.060,.102,24),"accent");
  b.add(p+"_Emitter_Core",cylinderBetween([0,.555,.502],[0,.555,.512],.061,24),"accent");
  b.add(p+"_Top_Sight",box(0,.785,-.075,.09,.11,.24),"gunmetal");
  return b;
}

function buildKing(faction){
  var b=new Builder(faction),p="king_"+faction;
  b.base(p);
  b.add(p+"_Core_Lower",frustumY(0,.26,0,.25,.18,.25,8),"mirror");
  b.add(p+"_Core_Upper",frustumY(0,.51,0,.18,.24,.27,8),"mirror");
  b.add(p+"_Core_Cap",frustumY(0,.78,0,.24,.08,.16,8),"accent");
  [[-.29,0],[.29,0],[0,-.25]].forEach(function(pos,index){
    b.add(p+"_Cage_"+index,box(pos[0],.61,pos[1],.12,.65,.13,index===2?0:pos[0]*-.35),"dark");
  });
  b.add(p+"_Crown_Left",box(-.24,.94,0,.13,.36,.15,-.18),"main");
  b.add(p+"_Crown_Right",box(.24,.94,0,.13,.36,.15,.18),"main");
  b.add(p+"_Crown_Center",frustumY(0,.88,0,.11,0,0.42,6,0),"main");
  return b;
}

function buildShield(faction){
  var b=new Builder(faction),p="shield_"+faction;
  b.base(p);
  var silhouette=[[-.30,.28],[.30,.28],[.40,.40],[.32,1.04],[0,1.18],[-.32,1.04],[-.40,.40]];
  var inset=[[-.22,.36],[.22,.36],[.29,.45],[.23,.95],[0,1.07],[-.23,.95],[-.29,.45]];
  b.add(p+"_Armor_Plate",extrudeXY(silhouette,-.105,.105),"main");
  b.add(p+"_Front_Optical_Panel",extrudeXY(inset,.108,.13),"dark");
  b.add(p+"_Front_Slit",box(0,.67,.145,.055,.42,.035),"accent");
  b.add(p+"_Top_Rail",box(0,1.095,.01,.32,.10,.25),"gunmetal");
  b.add(p+"_Rear_Brace_Left",box(-.24,.49,-.22,.12,.46,.14,-.25),"gunmetal");
  b.add(p+"_Rear_Brace_Right",box(.24,.49,-.22,.12,.46,.14,.25),"gunmetal");
  return b;
}

function triangularPrismBody(normal,tangent,y0,y1){
  var faceCenter=mul(normal,.12);
  var a=add(faceCenter,mul(tangent,-.46));
  var b=add(faceCenter,mul(tangent,.46));
  // The reflective face is the hypotenuse of an isosceles right triangle.
  var c=mul(normal,.12-.46);
  var low=[[a[0],y0,a[2]],[b[0],y0,b[2]],[c[0],y0,c[2]]];
  var high=[[a[0],y1,a[2]],[b[0],y1,b[2]],[c[0],y1,c[2]]];
  var parts=[polygonFace(low,[0,-1,0],true),polygonFace(high,[0,1,0],false)];
  for(var i=0;i<3;i++){
    var j=(i+1)%3,n=normalize(cross(sub(low[j],low[i]),sub(high[i],low[i])));
    parts.push(quad(low[i],low[j],high[j],high[i],n));
  }
  return merge(parts);
}

function buildSingleMirror(faction){
  var b=new Builder(faction),p="single_mirror_"+faction;
  b.base(p);
  var normal=[SQRT_HALF,0,SQRT_HALF],tangent=[SQRT_HALF,0,-SQRT_HALF];
  b.add(p+"_Triangular_Prism_Body",triangularPrismBody(normal,tangent,.27,1.02),"dark");
  var faceCenter=mul(normal,.142);
  b.add(p+"_Mirror_Face",verticalPlane(faceCenter,tangent,.84,.33,.96,normal),"mirror");
  var left=add(faceCenter,mul(tangent,-.455)),right=add(faceCenter,mul(tangent,.455));
  b.add(p+"_Frame_Left",cylinderBetween([left[0],.28,left[2]],[left[0],1.02,left[2]],.045,6),"main");
  b.add(p+"_Frame_Right",cylinderBetween([right[0],.28,right[2]],[right[0],1.02,right[2]],.045,6),"main");
  b.add(p+"_Frame_Top",cylinderBetween([left[0],1.02,left[2]],[right[0],1.02,right[2]],.045,6),"main");
  b.add(p+"_Rear_Spine",cylinderBetween([-.27,.30,-.27],[-.27,1.00,-.27],.055,6),"main");
  b.add(p+"_Optical_Slit",box(-.31,.62,-.31,.05,.38,.05,Math.PI/4),"accent");
  return b;
}

function mirrorPanel(z,front){
  var points=[[-.34,.34],[.34,.34],[.39,.44],[.28,1.02],[0,1.13],[-.28,1.02],[-.39,.44]];
  var ordered=front?points:points.slice().reverse();
  var vertices=ordered.map(function(p){return [p[0],p[1],z];});
  return polygonFace(vertices,[0,0,front?1:-1],false);
}

function buildDoubleMirror(faction){
  var b=new Builder(faction),p="double_mirror_"+faction;
  b.base(p);
  b.add(p+"_Central_Spine",box(0,.69,0,.13,.88,.28),"gunmetal");
  // The runtime's switch calibration names -Z as the authored front.
  b.add(p+"_Mirror_Front",mirrorPanel(-.135,false),"mirror");
  b.add(p+"_Mirror_Back",mirrorPanel(.135,true),"mirror");
  b.add(p+"_Frame_Left",box(-.36,.69,0,.075,.72,.30,-.03),"main");
  b.add(p+"_Frame_Right",box(.36,.69,0,.075,.72,.30,.03),"main");
  b.add(p+"_Frame_Top",box(0,1.06,0,.48,.09,.30),"main");
  b.add(p+"_Optical_Slit",box(0,.61,.17,.045,.34,.025),"accent");
  return b;
}

function pad4(buffer,padByte){
  var padding=(4-buffer.length%4)%4;
  return padding?Buffer.concat([buffer,Buffer.alloc(padding,padByte)]):buffer;
}

function encodeGlb(builder){
  var chunks=[],bufferViews=[],accessors=[];
  function append(buffer,target){
    var offset=chunks.reduce(function(sum,chunk){return sum+chunk.length;},0);
    var padded=pad4(buffer,0);chunks.push(padded);
    bufferViews.push({buffer:0,byteOffset:offset,byteLength:buffer.length,target:target});
    return bufferViews.length-1;
  }
  function floatAccessor(values,type,target,withBounds){
    var array=new Float32Array(values),view=append(Buffer.from(array.buffer),target);
    var accessor={bufferView:view,componentType:5126,count:values.length/(type==="VEC3"?3:1),type:type};
    if(withBounds){
      accessor.min=[Infinity,Infinity,Infinity];accessor.max=[-Infinity,-Infinity,-Infinity];
      for(var i=0;i<values.length;i+=3) for(var axis=0;axis<3;axis++){
        accessor.min[axis]=Math.min(accessor.min[axis],values[i+axis]);
        accessor.max[axis]=Math.max(accessor.max[axis],values[i+axis]);
      }
    }
    accessors.push(accessor);return accessors.length-1;
  }
  function indexAccessor(values){
    var array=new Uint16Array(values),view=append(Buffer.from(array.buffer),34963);
    accessors.push({bufferView:view,componentType:5123,count:values.length,type:"SCALAR"});
    return accessors.length-1;
  }
  var meshes=builder.meshes.map(function(mesh){
    var g=mesh.geometry;
    return {name:mesh.name,primitives:[{attributes:{
      POSITION:floatAccessor(g.positions,"VEC3",34962,true),
      NORMAL:floatAccessor(g.normals,"VEC3",34962,false)
    },indices:indexAccessor(g.indices),material:mesh.material}]};
  });
  var bin=Buffer.concat(chunks);
  var doc={
    asset:{version:"2.0",generator:"Lai Board Optical Piece Generator"},
    scene:0,scenes:[{nodes:meshes.map(function(_,i){return i;})}],
    nodes:meshes.map(function(mesh,i){return {name:mesh.name,mesh:i};}),
    meshes:meshes,
    materials:builder.materials.map(function(material){return {
      name:material.name,doubleSided:material.doubleSided===true,
      emissiveFactor:material.emissive,
      pbrMetallicRoughness:{baseColorFactor:material.color,
        metallicFactor:material.metallic,roughnessFactor:material.roughness}
    };}),
    buffers:[{byteLength:bin.length}],bufferViews:bufferViews,accessors:accessors
  };
  var json=pad4(Buffer.from(JSON.stringify(doc)),0x20);
  var total=12+8+json.length+8+bin.length,header=Buffer.alloc(12),jsonHeader=Buffer.alloc(8),binHeader=Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(total,8);
  jsonHeader.writeUInt32LE(json.length,0);jsonHeader.writeUInt32LE(0x4e4f534a,4);
  binHeader.writeUInt32LE(bin.length,0);binHeader.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,jsonHeader,json,binHeader,bin]);
}

function generate(){
  var builders={
    laser_cannon:buildLaser,king:buildKing,shield:buildShield,
    single_mirror:buildSingleMirror,double_mirror:buildDoubleMirror
  };
  Object.keys(builders).forEach(function(type){
    ["red","blue"].forEach(function(faction){
      var output=path.join(OUTPUT_DIR,type+"_"+faction+".glb");
      fs.writeFileSync(output,encodeGlb(builders[type](faction)));
      process.stdout.write(path.relative(process.cwd(),output)+"\n");
    });
  });
}

if(require.main===module) generate();

module.exports={generate:generate,encodeGlb:encodeGlb};
