import { evidenceFor } from '../manifest.js';
import type { EcosystemDetector } from '../detector.js';
import type { ArtifactGlob, CommandCandidate, FrameworkSignal } from '../types.js';

/**
 * Embedded C and C++: firmware and device code, tested on the host or on a rig.
 *
 * Read only from root manifests: a vendored `third_party/CMakeLists.txt` in a web repository
 * is a dependency, not the project. Four build systems, each with the command that makes it
 * write **JUnit XML**, the format ingest already reads, so a firmware run lands in the same
 * runs, causes and gates as anything else. Nothing here flashes a board: running on hardware
 * is the runner's job, behind its own capability labels.
 */
const MARKERS = ['platformio.ini', 'west.yml', 'project.yml', 'CMakeLists.txt'] as const;
type Marker = (typeof MARKERS)[number];

const FRAMEWORKS: ReadonlyArray<readonly [RegExp, string, FrameworkSignal['category']]> = [
  [/\bGTest\b|googletest|gtest/u, 'googletest', 'unit'],
  [/\bCatch2\b/u, 'catch2', 'unit'],
  [/\bCppUTest\b/u, 'cpputest', 'unit'],
  [/\bunity\b/iu, 'unity', 'unit'],
  [/CONFIG_ZTEST|\bZephyr\b/u, 'ztest', 'unit'],
];

/** Each build system's own test command, writing JUnit XML; best first. */
const COMMANDS: ReadonlyArray<readonly [Marker, string, string[], number]> = [
  [
    'platformio.ini',
    'c-cpp.pio-test',
    ['pio', 'test', '--junit-output-path', 'pio-junit.xml'],
    0.9,
  ],
  ['project.yml', 'c-cpp.ceedling', ['ceedling', 'test:all'], 0.85],
  [
    'west.yml',
    'c-cpp.twister',
    ['west', 'twister', '-T', 'tests', '--platform', 'native_sim'],
    0.8,
  ],
  [
    'CMakeLists.txt',
    'c-cpp.ctest',
    ['ctest', '--test-dir', 'build', '--output-junit', 'ctest-junit.xml'],
    0.75,
  ],
];

const BUILD_TOOL: ReadonlyArray<readonly [Marker, string]> = [
  ['platformio.ini', 'platformio'],
  ['west.yml', 'west'],
  ['project.yml', 'ceedling'],
];

const ARTIFACTS: readonly ArtifactGlob[] = [
  { glob: '**/*junit*.xml', format: 'junit-xml', category: 'unit' },
];

function frameworksIn(
  texts: ReadonlyArray<readonly [string, string]>,
  present: readonly Marker[],
): FrameworkSignal[] {
  const found: FrameworkSignal[] = [];
  if (present.includes('platformio.ini')) {
    found.push({ name: 'platformio', category: 'unit', evidence: 'platformio.ini' });
  }
  for (const [pattern, name, category] of FRAMEWORKS) {
    const hit = texts.find(([, text]) => pattern.test(text));
    if (hit === undefined) continue;
    const token = pattern.exec(hit[1])?.[0] ?? name;
    found.push({ name, category, evidence: evidenceFor(hit[0], hit[1], token) });
  }
  if (present.includes('project.yml')) {
    found.push({ name: 'ceedling', category: 'unit', evidence: 'project.yml' });
  }
  if (found.length === 0) {
    found.push({ name: 'ctest', category: 'unit', evidence: present[0] ?? 'CMakeLists.txt' });
  }
  return found;
}

function commandsFor(present: readonly Marker[]): CommandCandidate[] {
  return COMMANDS.filter(([marker]) => present.includes(marker)).map(
    ([marker, id, argv, confidence]) => ({
      id,
      argv,
      label: argv.join(' '),
      category: 'unit' as const,
      evidence: marker,
      confidence,
    }),
  );
}

export const detectCCpp: EcosystemDetector = async ({ paths, read }) => {
  const present = MARKERS.filter((marker) => paths.includes(marker));
  if (present.length === 0) return null;
  const sources = paths.includes('prj.conf') ? [...present, 'prj.conf'] : [...present];
  const texts = await Promise.all(
    sources.map(async (path) => [path, (await read(path)) ?? ''] as const),
  );
  return {
    ecosystem: 'c-cpp',
    language: 'C/C++',
    packageManager: BUILD_TOOL.find(([marker]) => present.includes(marker))?.[1] ?? 'cmake',
    frameworks: frameworksIn(texts, present),
    candidateCommands: commandsFor(present),
    artifactGlobs: [...ARTIFACTS],
    coverageGlobs: [],
    coverageFormats: ['lcov', 'cobertura'],
    confidence: 0.7,
  };
};
