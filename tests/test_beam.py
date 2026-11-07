import unittest
from model import Config, simulate


class BeamTests(unittest.TestCase):
    def pattern(self, **kwargs):
        return simulate(Config.parse({'n': 256, **kwargs}))['selected']

    def test_optimized_phases_point_near_ue(self):
        b = self.pattern(mode='RIS', phase='optimized')['R']['beam']
        self.assertTrue(b['available'])
        self.assertLess(abs(b['peak_angle_deg']-b['ue_angle_deg']), 3.0)
        self.assertGreater(b['coherent_at_ue_db'], -1)

    def test_steering_tracks_requested_angle(self):
        for angle in (-45, -15, 0, 30, 50):
            b = self.pattern(mode='RIS', phase='steered', steer_deg=angle)['R']['beam']
            self.assertLessEqual(abs(b['peak_angle_deg']-angle), 2.0)

    def test_random_phase_reduces_coherence_at_ue(self):
        optimal = self.pattern(mode='RIS',phase='optimized')['R']['beam']
        random = self.pattern(mode='RIS',phase='random')['R']['beam']
        self.assertLess(random['coherent_at_ue_db'], optimal['coherent_at_ue_db']-10)

    def test_none_and_ris_t_have_no_beam(self):
        self.assertFalse(self.pattern(mode='NONE')['R']['beam']['available'])
        self.assertFalse(self.pattern(mode='RIS')['T']['beam']['available'])
        self.assertTrue(self.pattern(mode='ES')['T']['beam']['available'])

    def test_beam_moves_when_ue_moves(self):
        one = self.pattern(mode='RIS',phase='optimized')['R']['beam']
        geometry={
          'surface':[60,20,5],
          'users':{'R':[30,10,1.5],'T':[90,-10,1.5]},
          'obstacles':[],
        }
        two = self.pattern(mode='RIS',phase='optimized', geometry=geometry)['R']['beam']
        self.assertGreater(abs(one['peak_angle_deg']-two['peak_angle_deg']),15)
        self.assertLess(abs(two['peak_angle_deg']-two['ue_angle_deg']), 3)

    def test_beam_has_consistent_arrays(self):
        b=self.pattern(mode='RIS')['R']['beam']
        self.assertEqual(len(b['angles_deg']),161)
        self.assertEqual(len(b['relative_db']),161)
        self.assertTrue(all(-50 <= v <= 0.001 for v in b['relative_db']))


if __name__ == '__main__':
    unittest.main()
