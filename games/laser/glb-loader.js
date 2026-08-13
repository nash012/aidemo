"use strict";

var GLB_MAGIC = 0x46546c67;
var JSON_CHUNK = 0x4e4f534a;
var BIN_CHUNK = 0x004e4942;
var COMPONENT_BYTES = {5121:1, 5123:2, 5125:4, 5126:4};
var TYPE_SIZE = {SCALAR:1, VEC2:2, VEC3:3, VEC4:4, MAT4:16};

function fail(message){ throw new Error("Invalid GLB: " + message); }

function asArrayBuffer(input){
  if(input instanceof ArrayBuffer) return input;
  if(input && input.buffer instanceof ArrayBuffer){
    return input.buffer.slice(input.byteOffset || 0,
      (input.byteOffset || 0) + input.byteLength);
  }
  fail("expected ArrayBuffer");
}

function readChunks(buffer){
  if(buffer.byteLength < 20) fail("truncated header");
  var view = new DataView(buffer);
  if(view.getUint32(0, true) !== GLB_MAGIC) fail("bad magic");
  if(view.getUint32(4, true) !== 2) fail("unsupported version");
  if(view.getUint32(8, true) !== buffer.byteLength) fail("length mismatch");
  var offset = 12, json = null, bin = null;
  while(offset < buffer.byteLength){
    if(offset + 8 > buffer.byteLength) fail("truncated chunk header");
    var length = view.getUint32(offset, true);
    var type = view.getUint32(offset + 4, true);
    var start = offset + 8, end = start + length;
    if(end > buffer.byteLength) fail("chunk exceeds file bounds");
    if(type === JSON_CHUNK){
      if(json) fail("duplicate JSON chunk");
      var bytes = new Uint8Array(buffer, start, length);
      var text = "";
      for(var i=0;i<bytes.length;i++) text += String.fromCharCode(bytes[i]);
      try { json = JSON.parse(text.replace(/\u0000+$/g, "").trim()); }
      catch(e){ fail("malformed JSON chunk"); }
    } else if(type === BIN_CHUNK){
      if(bin) fail("duplicate BIN chunk");
      bin = {offset:start, length:length};
    }
    offset = end;
  }
  if(!json) fail("missing JSON chunk");
  if(!bin) fail("missing BIN chunk");
  return {json:json, bin:bin};
}

function componentReader(componentType){
  if(componentType === 5121) return function(v,o){ return v.getUint8(o); };
  if(componentType === 5123) return function(v,o){ return v.getUint16(o,true); };
  if(componentType === 5125) return function(v,o){ return v.getUint32(o,true); };
  if(componentType === 5126) return function(v,o){ return v.getFloat32(o,true); };
  fail("unsupported component type " + componentType);
}

function decodeAccessor(index, doc, buffer, bin){
  var accessor = doc.accessors && doc.accessors[index];
  if(!accessor) fail("missing accessor " + index);
  if(accessor.sparse) fail("sparse accessors are unsupported");
  var viewDef = doc.bufferViews && doc.bufferViews[accessor.bufferView];
  if(!viewDef) fail("missing bufferView for accessor " + index);
  var components = TYPE_SIZE[accessor.type];
  var bytes = COMPONENT_BYTES[accessor.componentType];
  if(!components) fail("unsupported accessor type " + accessor.type);
  if(!bytes) fail("unsupported component type " + accessor.componentType);
  var elementBytes = components * bytes;
  var stride = viewDef.byteStride || elementBytes;
  if(stride < elementBytes) fail("invalid accessor stride");
  var viewStart = bin.offset + (viewDef.byteOffset || 0);
  var start = viewStart + (accessor.byteOffset || 0);
  var count = accessor.count;
  if(!Number.isInteger(count) || count < 0) fail("invalid accessor count");
  var last = count ? start + (count - 1) * stride + elementBytes : start;
  var viewEnd = viewStart + viewDef.byteLength;
  if(start < bin.offset || last > bin.offset + bin.length || last > viewEnd)
    fail("accessor " + index + " exceeds buffer bounds");
  var data = new Array(count * components);
  var dataView = new DataView(buffer);
  var read = componentReader(accessor.componentType);
  for(var i=0;i<count;i++){
    for(var c=0;c<components;c++) data[i*components+c] = read(dataView, start+i*stride+c*bytes);
  }
  return data;
}

function materialAt(index, materials){
  if(index === undefined || !materials[index]) fail("primitive material is missing");
  return materials[index];
}

function parseGlb(input){
  var buffer = asArrayBuffer(input);
  var chunks = readChunks(buffer);
  var doc = chunks.json;
  var materials = (doc.materials || []).map(function(source){
    var pbr = source.pbrMetallicRoughness || {};
    return {
      name:source.name || "material",
      baseColorFactor:(pbr.baseColorFactor || [1,1,1,1]).slice(),
      metallicFactor:pbr.metallicFactor === undefined ? 1 : pbr.metallicFactor,
      roughnessFactor:pbr.roughnessFactor === undefined ? 1 : pbr.roughnessFactor,
      doubleSided:source.doubleSided === true
    };
  });
  var meshes = (doc.meshes || []).map(function(source, meshIndex){
    var primitives = (source.primitives || []).map(function(primitive){
      if(!primitive.attributes || primitive.attributes.POSITION === undefined)
        fail("mesh " + meshIndex + " lacks POSITION");
      if(primitive.attributes.NORMAL === undefined)
        fail("mesh " + meshIndex + " lacks NORMAL");
      if(primitive.indices === undefined) fail("mesh " + meshIndex + " lacks indices");
      var positions = decodeAccessor(primitive.attributes.POSITION, doc, buffer, chunks.bin);
      var normals = decodeAccessor(primitive.attributes.NORMAL, doc, buffer, chunks.bin);
      var indices = decodeAccessor(primitive.indices, doc, buffer, chunks.bin);
      if(positions.length !== normals.length) fail("position/normal count mismatch");
      return {positions:positions, normals:normals, indices:indices,
        material:materialAt(primitive.material, materials)};
    });
    if(!primitives.length) fail("mesh " + meshIndex + " has no primitives");
    return {name:source.name || "mesh_" + meshIndex, primitives:primitives};
  });
  var nodes = (doc.nodes || []).map(function(source, nodeIndex){
    if(source.mesh !== undefined && !meshes[source.mesh]) fail("node " + nodeIndex + " has invalid mesh");
    return {
      name:source.name || "node_" + nodeIndex,
      mesh:source.mesh,
      children:(source.children || []).slice(),
      matrix:source.matrix ? source.matrix.slice() : null,
      translation:(source.translation || [0,0,0]).slice(),
      rotation:(source.rotation || [0,0,0,1]).slice(),
      scale:(source.scale || [1,1,1]).slice()
    };
  });
  nodes.forEach(function(node, nodeIndex){
    node.children.forEach(function(child){
      if(!nodes[child]) fail("node " + nodeIndex + " has invalid child");
    });
  });
  var sceneIndex = doc.scene === undefined ? 0 : doc.scene;
  var scene = doc.scenes && doc.scenes[sceneIndex];
  if(!scene) fail("missing default scene");
  return {nodes:nodes, meshes:meshes, materials:materials,
    sceneNodes:(scene.nodes || []).slice()};
}

function mirrorSurfaces(model){
  var names = model.nodes.map(function(node){ return node.name; });
  var single = names.filter(function(name){ return /_Mirror_Face$/.test(name); });
  var front = names.filter(function(name){ return /_Mirror_Front$/.test(name); });
  var back = names.filter(function(name){ return /_Mirror_Back$/.test(name); });
  if(single.length){
    if(single.length !== 1 || front.length || back.length) fail("single mirror surface metadata");
    return single;
  }
  if(front.length || back.length){
    if(front.length !== 1 || back.length !== 1 || single.length) fail("double mirror surface metadata");
    return [front[0], back[0]];
  }
  fail("missing mirror surface metadata");
}

module.exports = {parseGlb:parseGlb, mirrorSurfaces:mirrorSurfaces};
