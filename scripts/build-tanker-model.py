"""OKO: original, editable low-poly tanker, built and exported with Blender.

Run: blender --background --factory-startup --python scripts/build-tanker-model.py
No downloads or add-ons. Metres, bow +X, Blender Z-up; glTF export is Y-up.
Origin at the waterline amidships. This is a generic visual, not a real vessel.
"""
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / 'public/models/oko-tanker.glb'
SOURCE = ROOT / 'assets/blender/oko-tanker.blend'
SOURCE.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1


def material(name, rgb, metal=0.0, rough=0.65):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    return mat


navy = material('Hull | midnight blue', (0.025, 0.07, 0.105), 0.15)
red = material('Hull | antifouling red', (0.45, 0.065, 0.035))
deck = material('Deck | sea green', (0.07, 0.27, 0.24))
white = material('Superstructure | ivory', (0.78, 0.84, 0.82))
glass = material('Windows | blue glass', (0.025, 0.12, 0.18), 0.3, 0.25)
steel = material('Pipes and rails | light steel', (0.48, 0.57, 0.59), 0.5)
orange = material('Lifeboats | rescue orange', (0.95, 0.19, 0.025))
yellow = material('Safety | warm yellow', (0.93, 0.61, 0.12))


def mesh(name, verts, faces, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def box(name, loc, size, mat, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('Soft manufactured edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def pipe(name, start, end, radius, mat, sides=8):
    a, b = Vector(start), Vector(end)
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius,
                                       depth=(b-a).length, location=(a+b)/2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    obj.data.materials.append(mat)
    return obj


# Counterclockwise hull outline viewed from above, with a tapered stern and pointed bow.
outline = [(-100, -9), (-96, -14), (-78, -16), (60, -16),
           (78, -13), (92, -7), (100, 0), (92, 7), (78, 13),
           (60, 16), (-78, 16), (-96, 14), (-100, 9)]


def hull_band(name, bottom, top, lower_scale, upper_scale, mat, cap=False):
    verts = [(x*lower_scale, y*lower_scale, bottom) for x, y in outline]
    verts += [(x*upper_scale, y*upper_scale, top) for x, y in outline]
    n = len(outline)
    faces = [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
    faces.append(tuple(reversed(range(n))))
    if cap:
        faces.append(tuple(range(n, 2*n)))
    return mesh(name, verts, faces, mat)


hull_band('Hull / submerged body', -7, 0, 0.9, 1, red)
hull_band('Hull / freeboard', 0, 7, 1, 1, navy)
hull_band('Deck / main plate', 7, 7.25, 1, 1, deck, True)
# Narrow, visible waterline stripe and forecastle.
hull_band('Hull / boot stripe', 0, 0.35, 1.002, 1.002, white)
box('Forecastle deck', (80, 0, 8), (16, 19, 1.5), deck, 0.5)

# Aft accommodation block and panoramic wheelhouse.
box('Accommodation / main', (-76, 0, 14), (27, 23, 13.5), white, 0.45)
box('Accommodation / upper', (-76, 0, 23), (24, 20, 5), white, 0.35)
box('Bridge / wings', (-72, 0, 26.5), (14, 31, 1), white, 0.2)
box('Bridge / wheelhouse', (-74, 0, 28.5), (15, 23, 3.5), white, 0.25)
box('Bridge / roof', (-74, 0, 30.5), (17, 25, 0.6), white)
for side in [-1, 1]:
    for z in [11, 15, 19, 23]:
        for x in [-84, -79, -74, -69]:
            box('Accommodation / window', (x, side*(11.55 if z < 22 else 10.05), z),
                (1.6, 0.12, 0.95), glass)
    box('Bridge / side glazing', (-74, side*11.55, 29), (12.5, 0.14, 1.4), glass)
box('Bridge / front glazing', (-66.43, 0, 29), (0.15, 21, 1.4), glass)
box('Funnel / casing', (-88, 0, 29), (6.5, 7, 6.5), navy, 0.4)
box('Funnel / orange band', (-88, 0, 30), (6.6, 7.1, 1.5), orange)
pipe('Mast / main', (-72, 0, 31), (-72, 0, 39), 0.32, steel)
pipe('Mast / crossbar', (-72, -4, 36), (-72, 4, 36), 0.18, steel)
box('Radar scanner', (-72, 0, 38), (0.8, 6, 0.5), white)
for side in [-1, 1]:
    box('Rescue / cradle', (-63, side*13, 9), (11, 3.5, 1), steel)
    box('Rescue / enclosed lifeboat', (-63, side*13, 10.5), (9, 3.2, 2.5), orange, 0.8)
    pipe('Rescue / davit', (-67, side*10, 8), (-67, side*13, 13), 0.18, white)

# Tank access hatches, paired longitudinal cargo lines and transverse manifolds.
for x in [-45, -23, -1, 21, 43, 63]:
    for y in [-8, 8]:
        pipe('Cargo / access hatch', (x, y, 7.3), (x, y, 8.2), 2.3, white, 12)
        pipe('Cargo / hatch cover', (x, y, 8.2), (x, y, 8.45), 2.5, navy, 12)
    pipe('Cargo / cross pipe', (x, -10, 8.8), (x, 10, 8.8), 0.3, steel)
    pipe('Cargo / vent riser', (x+3, 0, 7.3), (x+3, 0, 13), 0.22, steel)
    box('Cargo / vent cap', (x+3, 0, 13), (1.4, 0.9, 0.4), navy)
    for y in [-2.5, 2.5]:
        pipe('Cargo / valve stem', (x, y, 9), (x, y, 10), 0.12, steel)
        pipe('Cargo / valve wheel', (x, y, 9.9), (x, y, 10.1), 0.6, orange, 10)
for y in [-2.5, -1, 1, 2.5]:
    pipe('Cargo / longitudinal line', (-54, y, 8.8), (73, y, 8.8), 0.3, steel)
for y in [-14, 14]:
    box('Safety / deck walkway', (6, y, 7.32), (126, 0.65, 0.08), yellow)
    for x in range(-56, 65, 8):
        pipe('Rail / stanchion', (x, y+math.copysign(1, y), 7.3),
             (x, y+math.copysign(1, y), 8.8), 0.065, white, 6)
    pipe('Rail / top', (-56, y+math.copysign(1, y), 8.8),
         (64, y+math.copysign(1, y), 8.8), 0.07, white, 6)
for x in [-93, 84]:
    for y in [-6, 6]:
        box('Mooring / base', (x, y, 8.9 if x > 0 else 7.5), (3, 2, 0.4), navy)
        for dx in [-0.8, 0.8]:
            pipe('Mooring / bollard', (x+dx, y, 7.5), (x+dx, y, 10), 0.45, steel)
pipe('Bow / flag mast', (90, 0, 7.3), (90, 0, 17), 0.18, steel)

# Save the editable source before joining meshes for the web export.
scene = bpy.context.scene
scene['description'] = 'OKO generic tanker study; not a real ship or AIS observation.'
scene['asset_license'] = 'CC0-1.0'
scene['axes'] = 'metres; bow +X; waterline Z=0 in Blender'
bpy.ops.object.select_all(action='SELECT')
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        area.spaces.active.region_3d.view_distance = 245
        area.spaces.active.region_3d.view_location = (0, 0, 5)
        area.spaces.active.region_3d.view_rotation = Vector((1, -1.7, 1.1)).to_track_quat('Z', 'Y')
        area.spaces.active.clip_end = 10000
        area.spaces.active.shading.color_type = 'MATERIAL'
        area.spaces.active.shading.show_cavity = True
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE), compress=True)

bpy.context.view_layer.objects.active = next(o for o in scene.objects if o.type == 'MESH')
bpy.ops.object.join()
obj = bpy.context.object
obj.name = 'OKO generic tanker'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
tri = obj.modifiers.new('Web triangles', 'TRIANGULATE')
bpy.ops.object.modifier_apply(modifier=tri.name)
triangles = len(obj.data.polygons)
assert triangles < 20000, f'Tanker exceeds triangle budget: {triangles}'
bpy.ops.export_scene.gltf(filepath=str(MODEL), export_format='GLB',
                          use_selection=True, export_yup=True,
                          export_cameras=False, export_lights=False,
                          export_animations=False, export_extras=False)
metadata = {
    'name': 'OKO generic tanker', 'kind': 'illustrative-model', 'license': 'CC0-1.0',
    'generator': f'Blender {bpy.app.version_string}', 'lengthM': 200,
    'beamM': 32, 'triangles': triangles, 'bytes': MODEL.stat().st_size,
    'upAxis': '+Y', 'bowAxis': '+X', 'waterlineM': 0,
    'source': 'assets/blender/oko-tanker.blend',
    'rebuild': 'scripts/build-tanker-model.py',
}
MODEL.with_suffix('.json').write_text(json.dumps(metadata, indent=2)+'\n', encoding='utf-8')
print('OKO_TANKER_RESULT '+json.dumps(metadata))
