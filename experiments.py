"""Reproducible report data. Run: python experiments.py --output results"""
import argparse
import csv
import json
from dataclasses import replace, asdict
from pathlib import Path

from model import Config, simulate, solve


def write_csv(path, rows):
    with path.open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--output', default='results')
    p.add_argument('--n', type=int, default=256)
    args = p.parse_args()

    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)

    c = Config.parse({'n': args.n})
    full = simulate(c)

    (out / 'default_result.json').write_text(
        json.dumps(full, ensure_ascii=False, indent=2, allow_nan=False),
        encoding='utf-8',
    )
    (out / 'experiment_config.json').write_text(
        json.dumps(asdict(c), indent=2),
        encoding='utf-8',
    )

    write_csv(
        out / 'comparison.csv',
        [
            dict(
                case=row['case'],
                ue=s,
                power_dbm=row[s]['power_dbm'],
                gain_vs_direct_db=row[s]['gain_db'],
            )
            for row in full['comparison']
            for s in ['R', 'T']
        ],
    )

    rows = []
    for n in [1, 4, 16, 32, 64, 128, 256, 512, 1024]:
        for mode in ['NONE', 'RIS', 'ES', 'MS', 'TS']:
            for phase in ['optimized', 'random']:
                for s, d in solve(replace(c, n=n, mode=mode, phase=phase)).items():
                    rows.append(
                        dict(
                            n=n,
                            mode=mode,
                            phase=phase,
                            ue=s,
                            power_dbm=d['power_dbm'],
                            gain_db=d['gain_db'],
                        )
                    )
    write_csv(out / 'sweep_n.csv', rows)

    rows = []
    for loss in range(0, 81, 5):
        for mode in ['NONE', 'RIS', 'ES', 'MS', 'TS']:
            for s, d in solve(replace(c, blockage_db=loss, mode=mode)).items():
                rows.append(
                    dict(
                        blockage_db=loss,
                        mode=mode,
                        ue=s,
                        power_dbm=d['power_dbm'],
                        gain_db=d['gain_db'],
                    )
                )
    write_csv(out / 'sweep_blockage.csv', rows)

    rows = []
    for split in [0, .25, .5, .75, 1]:
        for mode in ['ES', 'MS', 'TS']:
            for s, d in solve(replace(c, split=split, mode=mode)).items():
                rows.append(
                    dict(
                        reflection_fraction=split,
                        mode=mode,
                        ue=s,
                        power_dbm=d['power_dbm'],
                        gain_db=d['gain_db'],
                    )
                )
    write_csv(out / 'sweep_split.csv', rows)

    print(f'Wrote reproducible JSON and CSV results to {out.resolve()}')


if __name__ == '__main__':
    main()
