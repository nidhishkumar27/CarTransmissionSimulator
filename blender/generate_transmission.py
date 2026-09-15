import bpy
import math
from mathutils import Vector

# ============================================================
# MANUAL TRANSMISSION SIMULATOR - BLENDER GENERATOR
# Blender 5.2.x
# One-script procedural model for Three.js / GLB export
# ============================================================

PI = math.pi

# ---------- Global dimensions ----------
SHAFT_CENTER_DISTANCE = 2.4
SHAFT_RADIUS = 0.08
SHAFT_LENGTH = 19.0
SHAFT_Z = 1.55
INPUT_Y = -SHAFT_CENTER_DISTANCE / 2.0
OUTPUT_Y = SHAFT_CENTER_DISTANCE / 2.0

GEAR_X = {
    1: -6.5,
    2: -2.5,
    3: 1.5,
    4: 5.5,
    5: 9.5,
}

GEAR_RATIOS = {1: 3.80, 2: 2.20, 3: 1.50, 4: 1.10, 5: 0.85, "R": 3.60}

# Tooth pairs are selected so each pair has the exact intended radius ratio
# while preserving the fixed 2.4-unit center distance. Module is allowed to
# vary per pair for a visually useful educational model.
GEAR_TEETH = {
    1: (20, 76),
    2: (20, 44),
    3: (20, 30),
    4: (40, 44),
    5: (40, 34),
    "R": (20, 72),
}

COLLECTION_NAMES = ["CAR", "ENGINE", "GEARBOX", "REVERSE", "DRIVETRAIN", "WHEELS"]

# ---------- Materials ----------
def make_material(name, color, metallic=0.0, roughness=0.45, emission=None, emission_strength=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        if emission is not None:
            bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


MATS = {}


def create_materials():
    MATS["chassis"] = make_material("MAT_Chassis_Blue", (0.035, 0.08, 0.16), 0.78, 0.28)
    MATS["frame"] = make_material("MAT_Frame_Steel", (0.08, 0.11, 0.14), 0.9, 0.24)
    MATS["gear"] = make_material("MAT_Gear_Steel", (0.48, 0.52, 0.56), 0.92, 0.21)
    MATS["shaft"] = make_material("MAT_Shaft_DarkSteel", (0.12, 0.14, 0.17), 0.96, 0.2)
    MATS["sync"] = make_material("MAT_Synchronizer_Brass", (0.68, 0.43, 0.10), 0.88, 0.22)
    MATS["engine"] = make_material("MAT_Engine_Red", (0.33, 0.025, 0.018), 0.64, 0.29)
    MATS["engine_dark"] = make_material("MAT_Engine_Dark", (0.08, 0.02, 0.018), 0.75, 0.3)
    MATS["clutch"] = make_material("MAT_Clutch_Copper", (0.58, 0.24, 0.06), 0.92, 0.24)
    MATS["rubber"] = make_material("MAT_Tire_Rubber", (0.012, 0.014, 0.017), 0.08, 0.64)
    MATS["rim"] = make_material("MAT_Rim_Metal", (0.36, 0.40, 0.45), 0.9, 0.25)
    MATS["silver"] = make_material("MAT_Silver", (0.63, 0.67, 0.72), 0.88, 0.22)
    MATS["orange"] = make_material("MAT_PowerFlow", (0.95, 0.30, 0.025), 0.25, 0.25, (1.0, 0.16, 0.01), 5.0)
    MATS["yellow"] = make_material("MAT_PowerFlowYellow", (0.98, 0.65, 0.06), 0.15, 0.25, (1.0, 0.45, 0.01), 4.0)


# ---------- Collections ----------
def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)

    root_scene_collection = bpy.context.scene.collection
    for child in list(root_scene_collection.children):
        if child.name == "Collection":
            root_scene_collection.children.unlink(child)
            bpy.data.collections.remove(child)

    for name in COLLECTION_NAMES:
        col = bpy.data.collections.get(name)
        if col is None:
            col = bpy.data.collections.new(name)
            root_scene_collection.children.link(col)


def move_to_collection(obj, collection_name):
    for col in list(obj.users_collection):
        col.objects.unlink(obj)
    bpy.data.collections[collection_name].objects.link(obj)


def make_root():
    root = bpy.data.objects.new("TransmissionRoot", None)
    bpy.data.collections["CAR"].objects.link(root)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.5
    return root


# ---------- Geometry helpers ----------
def assign_material(obj, mat):
    if obj.data and hasattr(obj.data, "materials"):
        obj.data.materials.append(mat)


def apply_rotation(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    obj.select_set(False)


def create_cube(name, location, scale, material, collection="CAR", parent=None, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign_material(obj, material)
    move_to_collection(obj, collection)
    if bevel > 0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
    if parent:
        obj.parent = parent
    return obj


def create_cylinder(name, location, radius, depth, material, collection="CAR", rotation=(0, 0, 0), parent=None, vertices=48, bevel=0.0):
    if radius <= 0 or depth <= 0:
        raise ValueError(f"Invalid cylinder dimensions for {name}: radius={radius}, depth={depth}")
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, material)
    move_to_collection(obj, collection)
    if rotation != (0, 0, 0):
        apply_rotation(obj)
    if bevel > 0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
    if parent:
        obj.parent = parent
    return obj


def create_torus(name, location, major_radius, minor_radius, material, collection="CAR", rotation=(0, 0, 0), parent=None):
    if major_radius <= 0 or minor_radius <= 0:
        raise ValueError(f"Invalid torus dimensions for {name}")
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=64,
        minor_segments=16,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, material)
    move_to_collection(obj, collection)
    if rotation != (0, 0, 0):
        apply_rotation(obj)
    if parent:
        obj.parent = parent
    return obj


def create_uv_sphere(name, location, scale, material, collection="CAR", parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign_material(obj, material)
    move_to_collection(obj, collection)
    if parent:
        obj.parent = parent
    return obj


def cylinder_between(name, p1, p2, radius, material, collection="CAR", parent=None):
    p1, p2 = Vector(p1), Vector(p2)
    delta = p2 - p1
    length = delta.length
    if length <= 0:
        raise ValueError(f"Cylinder endpoints identical for {name}")
    mid = (p1 + p2) * 0.5
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=radius, depth=length, location=mid)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(delta.normalized())
    assign_material(obj, material)
    move_to_collection(obj, collection)
    if parent:
        obj.parent = parent
    return obj


# ---------- Gear generation ----------
def create_gear(name, x, y, z, pitch_radius, teeth, thickness, bore_radius, material, collection="GEARBOX", parent=None):
    if pitch_radius <= bore_radius * 1.2:
        raise ValueError(f"Gear {name}: pitch radius too small for bore")
    if teeth < 8:
        raise ValueError(f"Gear {name}: too few teeth")
    if thickness <= 0:
        raise ValueError(f"Gear {name}: invalid thickness")

    root_radius = pitch_radius * 0.91
    outer_radius = pitch_radius * 1.075
    tooth_fraction = 0.38
    samples_per_tooth = 4
    count = teeth * samples_per_tooth

    angles = []
    radii = []
    for i in range(count):
        tooth_phase = (i % samples_per_tooth) / samples_per_tooth
        angle = 2.0 * PI * i / count
        if tooth_phase in (0.0, 0.75):
            r = root_radius
        elif tooth_phase in (0.25, 0.5):
            r = outer_radius
        else:
            r = pitch_radius
        angles.append(angle)
        radii.append(r)

    verts = []
    half = thickness / 2.0

    # Vertex ring 0 = inner bore, 1 = root, 2 = outer tooth profile, each on front/back.
    ring_count = 3
    rings = []
    for side in (-1, 1):
        sx = side * half
        for ring in range(ring_count):
            ring_indices = []
            for i in range(count):
                ang = angles[i]
                if ring == 0:
                    rr = bore_radius
                elif ring == 1:
                    rr = root_radius
                else:
                    rr = radii[i]
                ring_indices.append(len(verts))
                verts.append((sx, rr * math.cos(ang), rr * math.sin(ang)))
            rings.append(ring_indices)

    front_inner, front_root, front_outer, back_inner, back_root, back_outer = rings
    faces = []

    def quads_between(a, b, reverse=False):
        for i in range(count):
            j = (i + 1) % count
            if not reverse:
                faces.append((a[i], a[j], b[j], b[i]))
            else:
                faces.append((a[i], b[i], b[j], a[j]))

    # Front annular face and back face.
    quads_between(front_inner, front_root)
    quads_between(front_root, front_outer)
    quads_between(back_inner, back_root, reverse=True)
    quads_between(back_root, back_outer, reverse=True)

    # Outer tooth wall and inner bore wall.
    quads_between(front_outer, back_outer)
    quads_between(front_inner, back_inner, reverse=True)

    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update(calc_edges=True)

    obj = bpy.data.objects.new(name, mesh)
    bpy.data.collections[collection].objects.link(obj)
    obj.location = (x, y, z)
    assign_material(obj, material)

    bevel = obj.modifiers.new("Precision Bevel", "BEVEL")
    bevel.width = min(0.07, thickness * 0.16)
    bevel.segments = 2
    bevel.limit_method = "ANGLE"

    if parent:
        obj.parent = parent

    return obj


def gear_radii(ratio):
    r_input = SHAFT_CENTER_DISTANCE / (1.0 + ratio)
    r_output = SHAFT_CENTER_DISTANCE - r_input
    return r_input, r_output


# ---------- Engine / clutch ----------
def create_engine(root):
    engine = bpy.data.objects.new("Engine", None)
    bpy.data.collections["ENGINE"].objects.link(engine)
    engine.parent = root

    create_cube("Engine_Block", (-9.85, 0, 1.55), (1.25, 1.25, 1.25), MATS["engine"], "ENGINE", engine, 0.16)
    create_cube("Engine_Block_Lower", (-10.0, 0, 0.6), (1.05, 1.05, 0.4), MATS["engine_dark"], "ENGINE", engine, 0.1)
    create_cube("Engine_Valve_Cover_Block", (-9.8, 0, 2.95), (1.02, 1.0, 0.20), MATS["engine"], "ENGINE", engine, 0.09)
    create_cube("Engine_Valve_Cover", (-9.8, 0, 3.2), (0.82, 0.75, 0.10), MATS["silver"], "ENGINE", engine, 0.05)

    for y in (-0.78, -0.26, 0.26, 0.78):
        create_cylinder("Engine_Manifold_" + str(y).replace(".", "_"), (-9.0, y, 2.55), 0.09, 1.25, MATS["engine_dark"], "ENGINE", rotation=(0, PI / 2, 0), parent=engine)

    create_cylinder("Flywheel", (-8.25, 0, SHAFT_Z), 1.08, 0.28, MATS["clutch"], "ENGINE", rotation=(0, PI / 2, 0), parent=engine, vertices=64, bevel=0.035)
    create_cylinder("Clutch", (-7.94, 0, SHAFT_Z), 0.88, 0.20, MATS["clutch"], "ENGINE", rotation=(0, PI / 2, 0), parent=engine, vertices=64, bevel=0.025)
    create_cylinder("Clutch_Hub", (-7.80, 0, SHAFT_Z), 0.23, 0.40, MATS["shaft"], "ENGINE", rotation=(0, PI / 2, 0), parent=engine)
    create_cylinder("Pressure_Plate", (-8.05, 0, SHAFT_Z), 0.95, 0.18, MATS["silver"], "ENGINE", rotation=(0, PI / 2, 0), parent=engine, vertices=64, bevel=0.025)

    # Bell housing ring, kept compact and visually open.
    create_torus("Clutch_Bell_Housing", (-7.45, 0, SHAFT_Z), 1.05, 0.16, MATS["engine_dark"], "ENGINE", rotation=(0, PI / 2, 0), parent=engine)


# ---------- Chassis ----------
def create_chassis(root):
    chassis = bpy.data.objects.new("Chassis", None)
    bpy.data.collections["CAR"].objects.link(chassis)
    chassis.parent = root

    create_cube("Chassis_Base", (1.6, 0, 0.32), (13.5, 2.7, 0.13), MATS["chassis"], "CAR", chassis, 0.08)
    create_cube("Chassis_Rail_L", (1.6, -2.65, 0.72), (13.5, 0.14, 0.32), MATS["frame"], "CAR", chassis, 0.06)
    create_cube("Chassis_Rail_R", (1.6, 2.65, 0.72), (13.5, 0.14, 0.32), MATS["frame"], "CAR", chassis, 0.06)
    for idx, x in enumerate((-7.5, -1.0, 5.5, 11.5)):
        create_cube(f"Chassis_Crossmember_{idx+1}", (x, 0, 0.78), (0.16, 2.65, 0.22), MATS["frame"], "CAR", chassis, 0.05)

    # Small hood-side framing, intentionally open above the drivetrain.
    create_cube("Chassis_SideFront_L", (-8.8, -2.52, 1.85), (2.0, 0.09, 0.10), MATS["frame"], "CAR", chassis, 0.035)
    create_cube("Chassis_SideFront_R", (-8.8, 2.52, 1.85), (2.0, 0.09, 0.10), MATS["frame"], "CAR", chassis, 0.035)


# ---------- Gearbox / synchronizers ----------
def create_shaft(name, y, root):
    return create_cylinder(name, (-0.5, y, SHAFT_Z), SHAFT_RADIUS, SHAFT_LENGTH, MATS["shaft"], "DRIVETRAIN", rotation=(0, PI / 2, 0), parent=root, vertices=48, bevel=0.012)


def create_synchronizer(index, x, root):
    sync = create_torus(f"Synchronizer_{index}", (x - 0.72, OUTPUT_Y, SHAFT_Z), 0.38, 0.075, MATS["sync"], "GEARBOX", rotation=(0, PI / 2, 0), parent=root)
    hub = create_cylinder(f"SynchroHub_{index}", (x - 0.72, OUTPUT_Y, SHAFT_Z), 0.23, 0.34, MATS["shaft"], "GEARBOX", rotation=(0, PI / 2, 0), parent=root)
    sleeve = create_cylinder(f"SynchroSleeve_{index}", (x - 0.72, OUTPUT_Y, SHAFT_Z), 0.43, 0.24, MATS["sync"], "GEARBOX", rotation=(0, PI / 2, 0), parent=root, vertices=64, bevel=0.025)

    fork_root = bpy.data.objects.new(f"ShiftFork_{index}", None)
    bpy.data.collections["GEARBOX"].objects.link(fork_root)
    fork_root.location = (x - 0.72, OUTPUT_Y, SHAFT_Z)
    fork_root.parent = root
    create_cube(f"ShiftFork_{index}_Stem", (0, -0.02, 0.56), (0.10, 0.08, 0.56), MATS["sync"], "GEARBOX", fork_root, 0.025)
    create_cube(f"ShiftFork_{index}_JawL", (0, -0.40, 0.18), (0.12, 0.18, 0.08), MATS["sync"], "GEARBOX", fork_root, 0.025)
    create_cube(f"ShiftFork_{index}_JawR", (0, 0.40, 0.18), (0.12, 0.18, 0.08), MATS["sync"], "GEARBOX", fork_root, 0.025)
    return sync, hub, sleeve, fork_root


def create_gearbox(root):
    input_shaft = create_shaft("Input_Shaft", INPUT_Y, root)
    output_shaft = create_shaft("Output_Shaft", OUTPUT_Y, root)

    for gear_no in range(1, 6):
        ratio = GEAR_RATIOS[gear_no]
        input_teeth, output_teeth = GEAR_TEETH[gear_no]
        r_in, r_out = gear_radii(ratio)
        module = (r_in + r_out) * 2.0 / (input_teeth + output_teeth)
        assert abs(r_in + r_out - SHAFT_CENTER_DISTANCE) < 1e-7
        assert abs((r_out / r_in) - ratio) < 1e-7
        assert module > 0

        x = GEAR_X[gear_no]
        create_gear(f"Gear_{gear_no}_Input", x, INPUT_Y, SHAFT_Z, r_in, input_teeth, 0.48, 0.13, MATS["gear"], "GEARBOX", root)
        create_gear(f"Gear_{gear_no}_Output", x, OUTPUT_Y, SHAFT_Z, r_out, output_teeth, 0.48, 0.16, MATS["gear"], "GEARBOX", root)

        # Slightly different hubs make the output gears visibly distinct.
        create_cylinder(f"Gear_{gear_no}_Input_Hub", (x, INPUT_Y, SHAFT_Z), 0.20, 0.60, MATS["shaft"], "GEARBOX", rotation=(0, PI / 2, 0), parent=root, bevel=0.03)
        create_cylinder(f"Gear_{gear_no}_Output_Hub", (x, OUTPUT_Y, SHAFT_Z), 0.25, 0.60, MATS["shaft"], "GEARBOX", rotation=(0, PI / 2, 0), parent=root, bevel=0.03)
        create_synchronizer(gear_no, x, root)

    # Gearbox end plates / bearing guides.
    for x in (-7.35, 10.35):
        create_cube(f"Gearbox_EndPlate_{x}", (x, 0, SHAFT_Z), (0.13, 1.55, 1.48), MATS["frame"], "GEARBOX", root, 0.05)

    create_cube("Gearbox_Top_Rail", (1.5, 0, 3.25), (9.9, 1.50, 0.11), MATS["frame"], "GEARBOX", root, 0.04)
    create_cube("Gearbox_Lower_Rail", (1.5, 0, -0.10), (9.9, 1.45, 0.10), MATS["frame"], "GEARBOX", root, 0.035)


# ---------- Reverse ----------
def reverse_idler_position(r_in, r_out, r_idler):
    # Input center = (0,-d/2), output center=(0,+d/2).
    d = SHAFT_CENTER_DISTANCE
    a = r_in + r_idler
    b = r_out + r_idler
    y = (a * a - b * b) / (2.0 * d)
    x_sq = a * a - (y + d / 2.0) ** 2
    if x_sq <= 0:
        raise ValueError("Reverse idler geometry cannot form a valid tangent triangle")
    x = math.sqrt(x_sq)
    return x, y


def create_reverse(root):
    ratio = GEAR_RATIOS["R"]
    input_teeth, output_teeth = GEAR_TEETH["R"]
    r_in, r_out = gear_radii(ratio)
    r_idler = 0.36
    ix, iy = reverse_idler_position(r_in, r_out, r_idler)
    reverse_x = -7.0

    # Main reverse gears share the two gearbox shaft centerlines.
    create_gear("Reverse_Input", reverse_x, INPUT_Y, SHAFT_Z, r_in, input_teeth, 0.48, 0.13, MATS["gear"], "REVERSE", root)
    create_gear("Reverse_Output", reverse_x, OUTPUT_Y, SHAFT_Z, r_out, output_teeth, 0.48, 0.16, MATS["gear"], "REVERSE", root)
    create_gear("Reverse_Idler", reverse_x + ix, iy, SHAFT_Z, r_idler, 18, 0.40, 0.10, MATS["clutch"], "REVERSE", root)

    # Dedicated reverse idler support shaft.
    create_cylinder("Reverse_Idler_Shaft", (reverse_x + ix, iy, SHAFT_Z), 0.07, 1.0, MATS["shaft"], "REVERSE", rotation=(0, PI / 2, 0), parent=root)
    create_torus("Reverse_Synchronizer", (reverse_x + 0.70, OUTPUT_Y, SHAFT_Z), 0.39, 0.075, MATS["sync"], "REVERSE", rotation=(0, PI / 2, 0), parent=root)
    create_cylinder("Reverse_SynchroHub", (reverse_x + 0.70, OUTPUT_Y, SHAFT_Z), 0.23, 0.34, MATS["shaft"], "REVERSE", rotation=(0, PI / 2, 0), parent=root)
    create_cylinder("Reverse_SynchroSleeve", (reverse_x + 0.70, OUTPUT_Y, SHAFT_Z), 0.43, 0.24, MATS["sync"], "REVERSE", rotation=(0, PI / 2, 0), parent=root, vertices=64, bevel=0.025)

    fork = bpy.data.objects.new("Reverse_ShiftFork", None)
    bpy.data.collections["REVERSE"].objects.link(fork)
    fork.location = (reverse_x + 0.70, OUTPUT_Y, SHAFT_Z)
    fork.parent = root
    create_cube("Reverse_ShiftFork_Stem", (0, -0.02, 0.56), (0.10, 0.08, 0.56), MATS["sync"], "REVERSE", fork, 0.025)
    create_cube("Reverse_ShiftFork_JawL", (0, -0.40, 0.18), (0.12, 0.18, 0.08), MATS["sync"], "REVERSE", fork, 0.025)
    create_cube("Reverse_ShiftFork_JawR", (0, 0.40, 0.18), (0.12, 0.18, 0.08), MATS["sync"], "REVERSE", fork, 0.025)


# ---------- Driveshaft / differential ----------
def create_differential(root):
    diff = bpy.data.objects.new("Differential", None)
    bpy.data.collections["DRIVETRAIN"].objects.link(diff)
    diff.parent = root

    create_uv_sphere("Differential_Housing", (13.25, 0, 1.0), (1.05, 1.25, 0.95), MATS["frame"], "DRIVETRAIN", diff)
    create_torus("Differential_Ring", (13.25, 0, 1.0), 0.78, 0.12, MATS["silver"], "DRIVETRAIN", rotation=(0, PI / 2, 0), parent=diff)
    create_cylinder("Differential_Center", (13.25, 0, 1.0), 0.30, 1.7, MATS["shaft"], "DRIVETRAIN", rotation=(PI / 2, 0, 0), parent=diff)

    create_cylinder("Driveshaft", (11.8, 0, 1.55), 0.075, 3.0, MATS["shaft"], "DRIVETRAIN", rotation=(0, PI / 2, 0), parent=diff)
    create_torus("Driveshaft_UJoint", (10.45, 0, 1.55), 0.17, 0.045, MATS["silver"], "DRIVETRAIN", rotation=(0, PI / 2, 0), parent=diff)
    create_torus("Driveshaft_UJoint_Rear", (13.0, 0, 1.22), 0.17, 0.045, MATS["silver"], "DRIVETRAIN", rotation=(0, PI / 2, 0), parent=diff)

    # Short visual coupling down to the rear axle height.
    cylinder_between("Driveshaft_Drop", (13.0, 0, 1.42), (13.25, 0, 1.0), 0.075, MATS["shaft"], "DRIVETRAIN", diff)
    create_cylinder("Rear_Axle", (13.5, 0, 1.0), 0.095, 7.0, MATS["shaft"], "DRIVETRAIN", rotation=(PI / 2, 0, 0), parent=diff)


def create_wheel(name_tire, name_rim, x, y, root):
    z = 1.0
    tire = create_torus(name_tire, (x, y, z), 0.62, 0.22, MATS["rubber"], "WHEELS", rotation=(PI / 2, 0, 0), parent=root)
    rim = create_torus(name_rim, (x, y, z), 0.43, 0.07, MATS["rim"], "WHEELS", rotation=(PI / 2, 0, 0), parent=root)
    create_cylinder(name_rim + "_Hub", (x, y, z), 0.17, 0.20, MATS["rim"], "WHEELS", rotation=(PI / 2, 0, 0), parent=root)
    return tire, rim


def create_wheels(root):
    create_wheel("Wheel_Tire_FL", "Wheel_Rim_FL", -3.3, -3.35, root)
    create_wheel("Wheel_Tire_FR", "Wheel_Rim_FR", -3.3, 3.35, root)
    create_wheel("Wheel_Tire_RL", "Wheel_Rim_RL", 13.5, -3.35, root)
    create_wheel("Wheel_Tire_RR", "Wheel_Rim_RR", 13.5, 3.35, root)


# ---------- Additional visual drivetrain links ----------
def create_drivetrain_details(root):
    create_cylinder("Input_Coupler", (-7.55, 0, SHAFT_Z), 0.13, 0.70, MATS["shaft"], "DRIVETRAIN", rotation=(0, PI / 2, 0), parent=root)
    create_cylinder("Output_Coupler", (10.45, OUTPUT_Y, SHAFT_Z), 0.13, 0.70, MATS["shaft"], "DRIVETRAIN", rotation=(0, PI / 2, 0), parent=root)

    # Bearing rings on shaft ends.
    create_torus("Input_Bearing", (-7.25, INPUT_Y, SHAFT_Z), 0.18, 0.06, MATS["silver"], "DRIVETRAIN", rotation=(0, PI / 2, 0), parent=root)
    create_torus("Output_Bearing", (10.2, OUTPUT_Y, SHAFT_Z), 0.18, 0.06, MATS["silver"], "DRIVETRAIN", rotation=(0, PI / 2, 0), parent=root)


# ---------- Lighting / camera ----------
def setup_scene():
    world = bpy.context.scene.world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.012, 0.018, 0.032, 1.0)
    bg.inputs["Strength"].default_value = 0.38

    camera_data = bpy.data.cameras.new("Transmission_Camera")
    camera = bpy.data.objects.new("Transmission_Camera", camera_data)
    bpy.data.collections["CAR"].objects.link(camera)
    camera.location = (2.5, -24.0, 18.0)
    target = Vector((1.5, 0.0, 1.25))
    direction = target - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 50
    bpy.context.scene.camera = camera

    def area_light(name, location, energy, size):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        bpy.data.collections["CAR"].objects.link(obj)
        obj.location = location
        target_dir = target - obj.location
        obj.rotation_euler = target_dir.to_track_quat("-Z", "Y").to_euler()
        return obj

    area_light("Key_Light", (-3, -8, 13), 1400, 8.0)
    area_light("Fill_Light", (4, 8, 9), 950, 7.0)
    area_light("Rim_Light", (15, 1, 10), 1200, 6.0)

    # Presentation floor, thin and dark; it does not enclose the drivetrain.
    create_cube("Presentation_Floor", (1.6, 0, 0.02), (14.5, 5.0, 0.03), MATS["frame"], "CAR", None, 0.02)

    # Scene settings
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.look = "AgX - Medium High Contrast"


# ---------- Validation ----------
def validate_model():
    required = [
        "TransmissionRoot", "Chassis", "Chassis_Rail_L", "Chassis_Rail_R",
        "Engine", "Engine_Block", "Engine_Valve_Cover", "Flywheel", "Clutch", "Clutch_Hub", "Pressure_Plate",
        "Input_Shaft", "Output_Shaft", "Driveshaft", "Rear_Axle",
        "Differential_Housing", "Differential_Ring",
        "Reverse_Input", "Reverse_Idler", "Reverse_Output", "Reverse_Synchronizer", "Reverse_ShiftFork",
        "Wheel_Tire_FL", "Wheel_Tire_FR", "Wheel_Tire_RL", "Wheel_Tire_RR",
        "Wheel_Rim_FL", "Wheel_Rim_FR", "Wheel_Rim_RL", "Wheel_Rim_RR",
    ]
    for g in range(1, 6):
        required += [
            f"Gear_{g}_Input", f"Gear_{g}_Output",
            f"Synchronizer_{g}", f"SynchroSleeve_{g}", f"ShiftFork_{g}"
        ]

    missing = [name for name in required if bpy.data.objects.get(name) is None]
    if missing:
        raise RuntimeError("Missing required objects: " + ", ".join(missing))

    for shaft_name in ("Input_Shaft", "Output_Shaft"):
        obj = bpy.data.objects[shaft_name]
        max_side = max(obj.dimensions)
        assert SHAFT_RADIUS < 1.0
        if max_side > 22.0:
            raise RuntimeError(f"{shaft_name} has unreasonable dimensions: {tuple(obj.dimensions)}")

    # Gear-center / pitch-radius checks from the actual specification.
    for g in range(1, 6):
        r_in, r_out = gear_radii(GEAR_RATIOS[g])
        assert abs(r_in + r_out - SHAFT_CENTER_DISTANCE) < 1e-7
        input_obj = bpy.data.objects[f"Gear_{g}_Input"]
        output_obj = bpy.data.objects[f"Gear_{g}_Output"]
        xy = math.hypot(input_obj.location.y - output_obj.location.y, input_obj.location.z - output_obj.location.z)
        if abs(xy - SHAFT_CENTER_DISTANCE) > 1e-6:
            raise RuntimeError(f"Gear {g} shaft center distance invalid: {xy}")

    # Generic geometry sanity check; deliberate chassis dimensions are allowed but nothing should be enormous.
    max_allowed = 40.0
    oversized = []
    for obj in bpy.context.scene.objects:
        if not obj.type == "MESH":
            continue
        if max(obj.dimensions) > max_allowed:
            oversized.append((obj.name, tuple(round(v, 2) for v in obj.dimensions)))
    if oversized:
        raise RuntimeError(f"Unreasonable object dimensions detected: {oversized}")

    print("\nMODEL VALIDATION")
    print("----------------")
    print("Chassis: OK")
    print("Engine: OK")
    print("Clutch: OK")
    print("Input shaft: OK")
    print("Output shaft: OK")
    for g in range(1, 6):
        print(f"{g}st gear: OK" if g == 1 else f"{g}th gear: OK")
    print("Reverse idler: OK")
    print("Driveshaft: OK")
    print("Differential: OK")
    print("Wheels: OK")
    print("Geometry sanity: OK")
    print("READY FOR GLB EXPORT")


def prepare_for_export():
    # Apply modifiers only to mesh objects so GLB preserves final visible geometry.
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            for mod in list(obj.modifiers):
                try:
                    bpy.ops.object.modifier_apply(modifier=mod.name)
                except Exception:
                    pass
            obj.select_set(False)


def build_model():
    clear_scene()
    create_materials()
    root = make_root()

    create_chassis(root)
    create_engine(root)
    create_gearbox(root)
    create_reverse(root)
    create_differential(root)
    create_drivetrain_details(root)
    create_wheels(root)
    setup_scene()

    validate_model()
    print("\nTip: save this .blend, then use File > Export > glTF 2.0 and choose GLB.")


build_model()
