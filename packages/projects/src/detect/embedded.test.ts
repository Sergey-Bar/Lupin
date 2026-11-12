import { describe, expect, it } from 'vitest';

import { literalView } from './repository-view.js';
import { detectProject } from './index.js';

/**
 * Embedded C and C++: firmware and device code, tested on the host or on a rig. Every
 * command proposed writes JUnit XML, the format ingest already reads, so a firmware run
 * lands in the same runs, causes and gates as a web app's.
 */
async function detect(files: Record<string, string>) {
  const result = await detectProject(literalView(files));
  if (!result.recognised) throw new Error('not recognised');
  return result;
}

describe('embedded C and C++ detection', () => {
  it('reads a CMake project with GoogleTest, and proposes ctest writing JUnit', async () => {
    const result = await detect({
      'CMakeLists.txt': 'project(fw C CXX)\nenable_testing()\nfind_package(GTest REQUIRED)\n',
      'src/main.c': 'int main(void) { return 0; }\n',
    });
    expect(result.ecosystem).toBe('c-cpp');
    expect(result.frameworks.map((framework) => framework.name)).toContain('googletest');
    expect(result.candidateCommands[0]?.argv).toEqual([
      'ctest',
      '--test-dir',
      'build',
      '--output-junit',
      'ctest-junit.xml',
    ]);
    expect(result.artifactGlobs.map((glob) => glob.format)).toEqual(['junit-xml']);
  });

  it('reads PlatformIO, and proposes pio test writing JUnit, ahead of anything else', async () => {
    const result = await detect({
      'platformio.ini': '[env:esp32dev]\nplatform = espressif32\ntest_framework = unity\n',
      'CMakeLists.txt': 'project(fw)\n',
    });
    expect(result.frameworks.map((framework) => framework.name)).toEqual(
      expect.arrayContaining(['platformio', 'unity']),
    );
    expect(result.candidateCommands[0]?.id).toBe('c-cpp.pio-test');
  });

  it('reads a Zephyr application, and proposes twister', async () => {
    const result = await detect({
      'west.yml': 'manifest:\n  projects: []\n',
      'CMakeLists.txt': 'find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})\n',
      'prj.conf': 'CONFIG_ZTEST=y\n',
    });
    expect(result.frameworks.map((framework) => framework.name)).toContain('ztest');
    expect(result.candidateCommands.map((command) => command.id)).toContain('c-cpp.twister');
  });

  it('reads Ceedling, and proposes its JUnit test run', async () => {
    const result = await detect({ 'project.yml': ':project:\n  :build_root: build\n' });
    expect(result.candidateCommands[0]?.id).toBe('c-cpp.ceedling');
  });

  it('is not fooled by a CMakeLists.txt in a Node repository', async () => {
    const result = await detect({
      'package.json': JSON.stringify({ name: 'app', scripts: { test: 'vitest run' } }),
      'third_party/CMakeLists.txt': 'project(dep)\n',
    });
    expect(result.ecosystem).toBe('node');
  });
});
