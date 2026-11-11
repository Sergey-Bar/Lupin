# Embedded and firmware QA

Lupin reads firmware and device test results the same way it reads a web app's: one run, its
failures grouped by cause, a gate, a trend and a copilot that explains it. What differs is only how
the tests are run and where.

## What Lupin recognises

When you connect a repository, Lupin reads its root build files and proposes a test command. It
never flashes a board or runs anything itself; it reads the files and suggests.

| Your repository has | Lupin proposes                                          |
| ------------------- | ------------------------------------------------------- |
| `platformio.ini`    | `pio test --junit-output-path pio-junit.xml`            |
| `project.yml`       | `ceedling test:all` (Ceedling, with Unity and CMock)    |
| `west.yml`          | `west twister -T tests --platform native_sim` (Zephyr)  |
| `CMakeLists.txt`    | `ctest --test-dir build --output-junit ctest-junit.xml` |

It also names the frameworks it finds (GoogleTest, Unity, Catch2, CppUTest, Zephyr's ztest) and
recommends GoogleTest to a CMake project that has no tests yet. A `CMakeLists.txt` deeper in the
tree, such as a vendored dependency in a web repository, does not make the project embedded.

## Send the results

Every command above writes JUnit XML, which Lupin already reads. Run it through the CLI and the
report is uploaded when the command ends, whether it passed or failed:

```bash
lupin test --format junit --report ctest-junit.xml -- \
  ctest --test-dir build --output-junit ctest-junit.xml
```

See [Send results from any CI](./cli.md) for the token and the environment it reads.

## Say which board it ran on

A run's required capabilities and labels are shown on its page as **Target**, for example
`hil · board:esp32-s3 · nightly`. Give a hardware-in-the-loop job the capabilities of the rig it
needs, and only a runner that has that rig claims it. The run then says where it ran, so a failure
on one board is never read as a failure everywhere.

## Who owns a failure

If the repository has a `CODEOWNERS` file, the copilot names the owners of each failure cause
from the failing tests' files, the same for firmware as for anything else.
