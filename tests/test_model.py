import unittest
from dataclasses import replace

from model import Config, simulate, solve, normalize_geometry


class ModelTests(unittest.TestCase):
    def test_default_runs(self):
        r = simulate(Config.parse({}))
        self.assertIn('R', r['selected'])
        self.assertIn('T', r['selected'])
        self.assertEqual(len(r['geometry']['obstacles']), 1)

    def test_geometry_can_move_users_and_surface(self):
        c = Config.parse({
            'geometry': {
                'surface': [55, 18, 5],
                'users': {
                    'R': [35, -18, 1.5],
                    'T': [95, -8, 1.5],
                },
                'obstacles': [
                    {'min': [18, -12, 0], 'max': [24, 5, 14]},
                ],
            }
        })
        r = simulate(c)
        self.assertEqual(r['geometry']['surface'], [55.0, 18.0, 5.0])
        self.assertEqual(r['geometry']['users']['R'], [35.0, -18.0, 1.5])

    def test_multiple_obstacles_supported(self):
        c = Config.parse({
            'geometry': {
                'surface': [60, 20, 5],
                'users': {
                    'R': [40, -10, 1.5],
                    'T': [90, -10, 1.5],
                },
                'obstacles': [
                    {'min': [18, -12, 0], 'max': [24, 5, 14]},
                    {'min': [48, 3, 0], 'max': [54, 12, 12]},
                ],
            }
        })
        r = simulate(c)
        self.assertEqual(len(r['geometry']['obstacles']), 2)

    def test_no_surface_mode(self):
        c = Config.parse({'mode': 'NONE'})
        d = solve(c)
        self.assertAlmostEqual(d['R']['power_dbm'], d['R']['direct_dbm'], places=9)
        self.assertAlmostEqual(d['T']['power_dbm'], d['T']['direct_dbm'], places=9)

    def test_ris_does_not_serve_transmission_side(self):
        c = Config.parse({'mode': 'RIS'})
        d = solve(c)
        self.assertAlmostEqual(d['T']['power_dbm'], d['T']['direct_dbm'], places=9)

    def test_too_many_obstacles_rejected(self):
        obstacles = [
            {'min': [i, 0, 0], 'max': [i + 0.5, 1, 1]}
            for i in range(13)
        ]
        with self.assertRaises(ValueError):
            Config.parse({
                'geometry': {
                    'surface': [60, 20, 5],
                    'users': {
                        'R': [40, -10, 1.5],
                        'T': [90, -10, 1.5],
                    },
                    'obstacles': obstacles,
                }
            })


if __name__ == '__main__':
    unittest.main()
