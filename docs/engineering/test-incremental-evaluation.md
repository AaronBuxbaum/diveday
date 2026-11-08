# Vitest incremental selection evaluation

Evaluated on 2026-11-08 with the installed Vitest **5.1.0**, Node **24.22.1**, using
isolated five-test fixtures. This measures selector behavior, not DiveDay suite speed or
production miss rates. The experiment deliberately introduces failures and compares each
incremental run with an unconditional run of the same fixture state.

## Reproduce

```sh
node scripts/test-incremental-evaluation.mjs > /tmp/incremental-evaluation.json
```

An optional positional argument supplies a different `node_modules` directory. The probe uses
fresh temporary directories, one worker, bounded subprocesses, and no network, database, app
server, or repository test cache. It removes its temporary fixtures even on failure. The JSON
contains selected files, failures, exit codes, wall times, and failures missed by incremental
selection. Expected failing fixture tests are observations, not harness errors. Missing reports,
timeouts, and incomplete cold runs abort the experiment.

## Recorded-dependency behavior

`--since-last-run` enables dependency recording and the modification-time provider. It requires
Vitest's cache. Each scenario starts with a cold run, which selected all five tests.

| Change after the cold run | Incremental selection | Full run detects failure? |
| --- | --- | --- |
| Nothing | None | No |
| Statically imported module | Its test | Yes, also caught incrementally |
| Computed dynamic import's module | Its test | Yes, also caught incrementally |
| File read with `readFileSync` | **None** | **Yes: missed** |
| Imported module changed with old mtime restored | **None** | **Yes: missed** |
| Environment variable changed | **None** | **Yes: missed** |
| Setup file | All five | Yes, also caught incrementally |
| New failing test file | New test; sometimes all six | Yes, also caught incrementally |
| Previously failed test, no new changes | Failed test | Yes, also caught incrementally |
| Deleted imported module | Its test | Yes, also caught incrementally |

The dynamic-import probe deliberately computes the import path at runtime. Arbitrary file reads
are not module imports: recording loaded modules does not discover their data dependencies.
Environment-dependent behavior is likewise not protected by a filesystem modification clock.

In the first measured run, an unchanged warm run took 0.50 seconds versus 2.14 seconds for the
five-test full run; a static-import edit took 0.70 versus 1.56 seconds, and a dynamic-import edit
0.74 versus 1.45 seconds. Setup changes ran everything and provided no meaningful speedup.
These are single synthetic observations, not statistical benchmarks or promised application gains.

## Comparison with native related selection

A second complete experiment also ran `vitest related <changed-input> --run` between the
incremental and unconditional runs. Native related selected the static import, preserved-mtime
import, setup dependents, new test and deleted-import test. It selected **nothing** for the
computed dynamic import or raw file read. Thus neither selector dominates: runtime recording
catches the executed computed import that static traversal misses, while a changed-path query
catches the preserved-mtime edit that incremental recording misses. The repository wrapper's
source-reader and global fallbacks are additional protections, not properties of native related.

Both complete runs reproduced all three incremental missed-failure scenarios. New-test
selection varied: one run selected only the new test, the other selected all six. This is a
safe widening, but another reason not to promise precise selection size or speedup from this
experimental mode. Full-suite measurements remain necessary.

## Decision

Do not replace `test:affected` or make raw `--since-last-run` a push gate. It is useful for
repeated local feedback in a stable checkout, especially runtime imports, but it cannot prove
that the current working tree passes CI. A warm cache is evidence about the last execution,
not evidence about inputs it never recorded.

Keep the current selector's source-reader expansion and conservative full-suite fallbacks for
unknown, deleted, dependency/configuration and database inputs. They address concrete gaps that
a raw incremental command demonstrably misses. Git-derived changed paths also protect against
a changed file whose mtime has been preserved. Neither import selection nor mtime recording
can infer an arbitrary changed external database or environment; such changes require an
explicit unconditional verification run.

If incremental selection is exposed, label it an optional iteration accelerator, preserve a
separate conservative pre-push verification command, and never feed its cache back as proof that
full CI can be skipped. Before adopting it as a default, compare measured selected files and
missed failures against full CI on real changes. Do not infer a repository recall rate from these
small adversarial probes or unify browser and unit models merely to share an implementation.
