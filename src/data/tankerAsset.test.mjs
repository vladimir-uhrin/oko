import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bytes = readFileSync(new URL('../../public/models/oko-tanker.glb', import.meta.url));
const meta = JSON.parse(readFileSync(new URL('../../public/models/oko-tanker.json', import.meta.url)));
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());

test('Blender tanker is self-contained glTF 2 with a bounded rendering cost', () => {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(meta.bytes, bytes.length);
  assert(bytes.length < 400_000);
  assert.match(gltf.asset.generator, /Blender/);
  assert.equal(gltf.nodes.length, 1);
  assert.equal(gltf.nodes[0].mesh, 0);
  for (const key of ['matrix', 'translation', 'rotation', 'scale']) assert.equal(gltf.nodes[0][key], undefined);
  assert(gltf.meshes[0].primitives.length <= 8);
  for (const resource of [...gltf.buffers, ...(gltf.images || [])]) assert.equal(resource.uri, undefined);
  assert.equal(gltf.extensionsRequired?.includes('KHR_draco_mesh_compression') || false, false);
  const triangles = gltf.meshes[0].primitives.reduce((count, primitive) => {
    assert.equal(primitive.mode ?? 4, 4);
    return count + gltf.accessors[primitive.indices].count / 3;
  }, 0);
  assert.equal(triangles, meta.triangles);
  assert(triangles > 1000 && triangles < 20000);
});

test('Tanker export preserves metre scale, waterline and editable source', () => {
  const positions = gltf.meshes[0].primitives.map(p => gltf.accessors[p.attributes.POSITION]);
  const min = [0, 1, 2].map(axis => Math.min(...positions.map(a => a.min[axis])));
  const max = [0, 1, 2].map(axis => Math.max(...positions.map(a => a.max[axis])));
  assert(Math.abs(max[0] - min[0] - 200) < 0.5, 'hull length ~200 m including stripe');
  assert(Math.abs(max[2] - min[2] - 32) < 0.1, 'beam ~32 m');
  assert.equal(min[1], -7, 'seven metres below the glTF waterline');
  assert.equal(max[1], 39, 'mast extends upward in glTF +Y');
  assert.equal(meta.kind, 'illustrative-model');
  const source = readFileSync(new URL('../../assets/blender/oko-tanker.blend', import.meta.url));
  assert(source.length > 10000, 'editable Blender file must ship with the trial');
});
