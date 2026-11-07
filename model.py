"""Narrowband SISO RIS / ideal independent-phase STAR-RIS educational model.
All powers computed in W; dBm only at presentation. See docs/MODEL.md.

Interactive geometry extension:
- UE-R / UE-T can move on the scene.
- RIS / STAR-RIS can move on the scene.
- Obstacles can move and multiple obstacles are supported.
The browser sends geometry inside Config.geometry; all propagation is still computed in Python.
"""
from dataclasses import dataclass, asdict, replace
import math
import numpy as np

C = 299792458.0

BS = np.array([0., 0., 8.])
DEFAULT_SURFACE = np.array([60., 20., 5.])
DEFAULT_USERS = {
    'R': np.array([40., -10., 1.5]),
    'T': np.array([90., -10., 1.5]),
}
DEFAULT_OBSTACLES = [
    {
        'min': np.array([18., -12., 0.]),
        'max': np.array([24., 5., 14.]),
    }
]


def default_geometry_json():
    return {
        'surface': DEFAULT_SURFACE.tolist(),
        'users': {k: v.tolist() for k, v in DEFAULT_USERS.items()},
        'obstacles': [
            {'min': o['min'].tolist(), 'max': o['max'].tolist()}
            for o in DEFAULT_OBSTACLES
        ],
    }


def _vec3(value, name):
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError(f'{name} phải là mảng [x, y, z].')
    out = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item):
            raise ValueError(f'{name} phải chứa 3 số hữu hạn.')
        out.append(float(item))
    return out


def normalize_geometry(value):
    """Validate geometry received from the browser and return JSON-safe data."""
    if value is None:
        return default_geometry_json()
    if not isinstance(value, dict):
        raise ValueError('geometry phải là JSON object.')

    unknown = set(value) - {'surface', 'users', 'obstacles'}
    if unknown:
        raise ValueError('Thuộc tính geometry không hợp lệ: ' + ', '.join(sorted(unknown)))

    surface = _vec3(value.get('surface', DEFAULT_SURFACE.tolist()), 'geometry.surface')
    users_raw = value.get('users', {})
    if not isinstance(users_raw, dict):
        raise ValueError('geometry.users phải là JSON object.')

    users = {}
    for side in ('R', 'T'):
        users[side] = _vec3(
            users_raw.get(side, DEFAULT_USERS[side].tolist()),
            f'geometry.users.{side}',
        )

    obstacles_raw = value.get('obstacles', default_geometry_json()['obstacles'])
    if not isinstance(obstacles_raw, list):
        raise ValueError('geometry.obstacles phải là danh sách.')
    if len(obstacles_raw) > 12:
        raise ValueError('Tối đa 12 vật cản.')

    obstacles = []
    for i, item in enumerate(obstacles_raw):
        if not isinstance(item, dict) or set(item) - {'min', 'max'}:
            raise ValueError(f'Vật cản {i + 1} phải có min và max.')
        lo = _vec3(item.get('min'), f'geometry.obstacles[{i}].min')
        hi = _vec3(item.get('max'), f'geometry.obstacles[{i}].max')
        if any(hi[j] <= lo[j] for j in range(3)):
            raise ValueError(f'Vật cản {i + 1}: max phải lớn hơn min trên cả 3 trục.')
        obstacles.append({'min': lo, 'max': hi})

    # Broad educational-scene bounds. They prevent accidental huge coordinates
    # while still allowing free movement over the displayed grid.
    points = [surface, users['R'], users['T']]
    for name, p in [('surface', surface), ('UE-R', users['R']), ('UE-T', users['T'])]:
        if not (-30 <= p[0] <= 130 and -60 <= p[1] <= 70 and 0 <= p[2] <= 40):
            raise ValueError(f'{name} nằm ngoài vùng mô phỏng.')

    for i, o in enumerate(obstacles):
        for p in (o['min'], o['max']):
            if not (-30 <= p[0] <= 130 and -60 <= p[1] <= 70 and 0 <= p[2] <= 40):
                raise ValueError(f'Vật cản {i + 1} nằm ngoài vùng mô phỏng.')

    return {'surface': surface, 'users': users, 'obstacles': obstacles}


@dataclass(frozen=True)
class Config:
    n: int = 256
    fc_ghz: float = 3.0
    pt_dbm: float = 30.0
    bs_gain_dbi: float = 10.0
    blockage_db: float = 40.0
    obstacle: bool = True
    efficiency: float = 0.9
    split: float = 0.5
    mode: str = 'ES'
    phase: str = 'optimized'
    steer_deg: float = 0.0  # target horizontal beam angle when phase='steered'
    bits: int = 0
    seed: int = 42
    geometry: dict | None = None

    @classmethod
    def parse(cls, data):
        if not isinstance(data, dict):
            raise ValueError('Cấu hình phải là một JSON object.')

        unknown = set(data) - set(cls.__dataclass_fields__)
        if unknown:
            raise ValueError('Tham số không hợp lệ: ' + ', '.join(sorted(unknown)))

        c = cls(**data)

        for name, lo, hi in [
            ('n', 1, 1024),
            ('fc_ghz', 1, 6),
            ('pt_dbm', -10, 40),
            ('bs_gain_dbi', 0, 20),
            ('blockage_db', 0, 80),
            ('efficiency', 0, 1),
            ('split', 0, 1),
            ('bits', 0, 4),
            ('seed', 0, 2147483647),
            ('steer_deg', -70, 70),
        ]:
            v = getattr(c, name)
            if isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) or not lo <= v <= hi:
                raise ValueError(f'{name} phải nằm trong [{lo}, {hi}].')

        for name in ['n', 'bits', 'seed']:
            if not isinstance(getattr(c, name), int):
                raise ValueError(f'{name} phải là số nguyên.')

        if (
            not isinstance(c.obstacle, bool)
            or c.mode not in ['NONE', 'RIS', 'ES', 'MS', 'TS']
            or c.phase not in ['optimized', 'random', 'zero', 'steered']
        ):
            raise ValueError('Chế độ mô phỏng không hợp lệ.')

        return replace(c, geometry=normalize_geometry(c.geometry))


def scene_arrays(c):
    g = normalize_geometry(c.geometry)
    surface = np.array(g['surface'], dtype=float)
    users = {k: np.array(v, dtype=float) for k, v in g['users'].items()}
    obstacles = [
        {'min': np.array(o['min'], dtype=float), 'max': np.array(o['max'], dtype=float)}
        for o in g['obstacles']
    ]
    return surface, users, obstacles


def intersects(a, b, obstacle):
    """Segment/AABB slab test for one obstacle."""
    low_corner = obstacle['min']
    high_corner = obstacle['max']
    delta = b - a
    low, high = 0.0, 1.0

    for i in range(3):
        if abs(delta[i]) < 1e-12:
            if a[i] < low_corner[i] or a[i] > high_corner[i]:
                return False
        else:
            t0, t1 = sorted((
                (low_corner[i] - a[i]) / delta[i],
                (high_corner[i] - a[i]) / delta[i],
            ))
            low, high = max(low, t0), min(high, t1)
            if low > high:
                return False
    return True


def blocked(a, b, c, obstacles):
    return bool(c.obstacle and any(intersects(a, b, o) for o in obstacles))


def channel(a, b, c, obstacles):
    distance = float(np.linalg.norm(b - a))
    distance = max(distance, 1e-9)
    wavelength = C / (c.fc_ghz * 1e9)
    attenuation = 10 ** (-c.blockage_db / 20) if blocked(a, b, c, obstacles) else 1.0
    return (
        wavelength / (4 * np.pi * distance)
        * attenuation
        * np.exp(-2j * np.pi * distance / wavelength)
    )


def elements(c, surface):
    cols = math.ceil(math.sqrt(c.n))
    rows = math.ceil(c.n / cols)
    spacing = C / (c.fc_ghz * 1e9) / 2
    indices = np.arange(c.n)
    return surface + np.column_stack((
        np.zeros(c.n),
        (indices % cols - (cols - 1) / 2) * spacing,
        (indices // cols - (rows - 1) / 2) * spacing,
    ))


def dbm(power):
    return None if power <= 0 else float(10 * np.log10(power) + 30)


def outgoing_direction(surface, ue, side, azimuth_deg):
    """Far-field unit vector, with elevation fixed at UE's actual elevation.

    The array lies in the YZ plane. Azimuth is relative to the local X normal:
    R points toward -X, T toward +X. This horizontal cut is illustrative;
    it is not a full electromagnetic 3D radiation calculation.
    """
    delta = ue - surface
    horizontal = float(np.hypot(delta[0], delta[1]))
    elev = math.atan2(float(delta[2]), max(horizontal, 1e-9))
    az = math.radians(float(azimuth_deg))
    sign = -1.0 if side == 'R' else 1.0
    return np.array([
        sign * math.cos(elev) * math.cos(az),
        math.cos(elev) * math.sin(az),
        math.sin(elev),
    ]), math.degrees(elev)


def make_beam_pattern(c, surface, ue, side, pts, incoming, weights, phi, duty):
    """Calculate a genuine array-factor azimuth cut from incident field and phases.

    AF(u) = sum_n h_BS,n * sqrt(eta)*weight_n * exp(j*phi_n)
                  * exp(j*k*(p_n-surface) dot u)

    We report shape normalized to this side's peak and coherent concentration
    at the actual UE angle. The near-field received power is computed separately.
    """
    if c.mode == 'NONE' or (c.mode == 'RIS' and side == 'T') or duty <= 0:
        return {'available': False, 'reason': 'Không có nhánh bề mặt phục vụ UE này.'}

    excitation = incoming * np.sqrt(c.efficiency) * weights * np.exp(1j * phi)
    ideal_magnitude = float(np.sum(np.abs(excitation)))
    if ideal_magnitude < 1e-22:
        return {'available': False, 'reason': 'Nhánh này không nhận được năng lượng từ RIS.'}

    delta = ue - surface
    ue_az = math.degrees(math.atan2(float(delta[1]), max(abs(float(delta[0])), 1e-9)))
    angles = np.linspace(-80., 80., 161)
    offsets = pts - surface
    wave_number = 2 * np.pi / (C / (c.fc_ghz * 1e9))
    elev = math.atan2(float(delta[2]), max(float(np.hypot(delta[0], delta[1])), 1e-9))
    azr = np.deg2rad(angles)
    # All sample directions share the UE elevation, making this an azimuth cut.
    directions = np.column_stack((
        np.full(angles.size,(-1 if side == 'R' else 1) * np.cos(elev)) * np.cos(azr),
        np.cos(elev) * np.sin(azr),
        np.full(angles.size,np.sin(elev)),
    ))
    field = np.exp(1j*wave_number*(directions @ offsets.T)) @ excitation
    envelope = np.abs(field)
    highest = float(np.max(envelope))
    normalized = envelope / max(highest,1e-30)
    db = 20*np.log10(np.maximum(normalized,1e-5))

    unit_target, elev_deg = outgoing_direction(surface, ue, side, ue_az)
    field_target = np.sum(excitation * np.exp(1j*wave_number*(offsets @ unit_target)))
    concentration = float(abs(field_target) / ideal_magnitude)
    concentration_db = 20*math.log10(max(concentration,1e-10))

    return {
        'available': True,
        'angles_deg': angles.tolist(),
        'relative_db': np.round(np.maximum(db,-50),3).tolist(),
        'peak_angle_deg': float(angles[int(np.argmax(envelope))]),
        'ue_angle_deg': float(ue_az),
        'elevation_deg': float(elev_deg),
        'ue_relative_db': float(20*math.log10(max(float(abs(field_target))/max(highest,1e-30),1e-10))),
        'coherent_at_ue_db': float(concentration_db),
        'side': side,
    }


def solve(c, detail=False):
    surface, users, obstacles = scene_arrays(c)
    pts = elements(c, surface)

    gain = 10 ** (c.bs_gain_dbi / 20)
    pt = 10 ** ((c.pt_dbm - 30) / 10)
    incoming = np.array([channel(BS, p, c, obstacles) for p in pts])

    rng = np.random.default_rng(c.seed)
    random_phases = rng.uniform(0, 2 * np.pi, (2, c.n))
    output = {}

    bs_surface_blocked = blocked(BS, surface, c, obstacles)

    for ui, (side, ue) in enumerate(users.items()):
        hd = gain * channel(BS, ue, c, obstacles)
        cascade = gain * incoming * np.array([channel(p, ue, c, obstacles) for p in pts])

        phi = np.mod(np.angle(hd) - np.angle(cascade), 2 * np.pi)
        if c.phase == 'steered':
            # Compensate the illumination phase and impose a linear spatial
            # gradient to point the far-field beam toward steer_deg.
            target_direction, _ = outgoing_direction(surface, ue, side, c.steer_deg)
            offsets = pts - surface
            k = 2 * np.pi / (C / (c.fc_ghz * 1e9))
            phi = np.mod(
                np.angle(hd) - np.angle(incoming)
                - k * (offsets @ target_direction),
                2 * np.pi,
            )
        elif c.phase == 'random':
            phi = random_phases[ui]
        elif c.phase == 'zero':
            phi = np.zeros(c.n)

        if c.bits:
            step = 2 * np.pi / (2 ** c.bits)
            phi = np.mod(np.round(phi / step) * step, 2 * np.pi)

        weights = np.ones(c.n)
        duty = 1.0

        if c.mode == 'NONE' or (c.mode == 'RIS' and side == 'T'):
            weights *= 0
        elif c.mode == 'ES':
            weights *= np.sqrt(c.split if side == 'R' else 1 - c.split)
        elif c.mode == 'MS':
            count = int(np.floor(c.n * c.split + 0.5))
            weights = (
                np.arange(c.n) < count if side == 'R'
                else np.arange(c.n) >= count
            ).astype(float)
        elif c.mode == 'TS':
            duty = c.split if side == 'R' else 1 - c.split

        before = np.sqrt(c.efficiency) * weights * cascade
        after = before * np.exp(1j * phi)
        hr = np.sum(after)

        p_direct = pt * abs(hd) ** 2
        p_active = pt * abs(hd + hr) ** 2
        p_average = duty * p_active + (1 - duty) * p_direct

        row = dict(
            power_w=float(p_average),
            power_dbm=dbm(p_average),
            direct_dbm=dbm(p_direct),
            active_dbm=dbm(p_active),
            surface_only_dbm=dbm(pt * abs(hr) ** 2),
            duty=float(duty),
            gain_db=float(10 * np.log10(p_average / p_direct)),
            direct_blocked=blocked(BS, ue, c, obstacles),
            direct_distance_m=float(np.linalg.norm(BS - ue)),
            bs_surface_blocked=bs_surface_blocked,
            surface_user_blocked=blocked(surface, ue, c, obstacles),
            bs_surface_distance_m=float(np.linalg.norm(BS - surface)),
            surface_user_distance_m=float(np.linalg.norm(surface - ue)),
        )

        if detail:
            row.update(
                phi_deg=np.rad2deg(phi).tolist(),
                weights=weights.tolist(),
                before_re=before.real.tolist(),
                before_im=before.imag.tolist(),
                after_re=after.real.tolist(),
                after_im=after.imag.tolist(),
                hd_re=float(hd.real),
                hd_im=float(hd.imag),
                hr_re=float(hr.real),
                hr_im=float(hr.imag),
                beam=make_beam_pattern(
                    c, surface, ue, side, pts, incoming, weights, phi, duty
                ),
            )

        output[side] = row

    return output


def simulate(c):
    selected = solve(c, True)

    cases = [
        ('LOS', replace(c, mode='NONE', obstacle=False)),
        ('DIRECT', replace(c, mode='NONE')),
        ('RIS', replace(c, mode='RIS')),
        ('ES', replace(c, mode='ES')),
        ('MS', replace(c, mode='MS')),
        ('TS', replace(c, mode='TS')),
    ]
    comparison = [dict(case=name, **solve(case)) for name, case in cases]

    ns = sorted(set([1, 4, 16, 32, 64, 128, 256, 512, 1024, c.n]))
    sweep = [dict(n=n, **solve(replace(c, n=n))) for n in ns]

    surface, users, obstacles = scene_arrays(c)
    geometry = dict(
        bs=BS.tolist(),
        surface=surface.tolist(),
        users={k: v.tolist() for k, v in users.items()},
        obstacles=[
            {'min': o['min'].tolist(), 'max': o['max'].tolist()}
            for o in obstacles
        ],
    )

    # Legacy fields retained so older front-end code does not break immediately.
    if obstacles:
        geometry['wall_min'] = obstacles[0]['min'].tolist()
        geometry['wall_max'] = obstacles[0]['max'].tolist()
    else:
        geometry['wall_min'] = None
        geometry['wall_max'] = None

    return dict(
        config=asdict(c),
        selected=selected,
        comparison=comparison,
        sweep=sweep,
        geometry=geometry,
        wavelength_m=C / (c.fc_ghz * 1e9),
    )
