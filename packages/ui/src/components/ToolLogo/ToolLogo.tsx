import { forwardRef, type HTMLAttributes } from 'react';
import {
  siApachejmeter,
  siAppium,
  siArgos,
  siBiome,
  siBlazemeter,
  siBruno,
  siBurpsuite,
  siCheckmarx,
  siChromatic,
  siCircleci,
  siCodeclimate,
  siCodecov,
  siCoveralls,
  siCucumber,
  siCypress,
  siDependabot,
  siDocker,
  siDotnet,
  siDrizzle,
  siEditorconfig,
  siEslint,
  siFirebase,
  siGatling,
  siGithubactions,
  siGitlab,
  siGo,
  siInsomnia,
  siJenkins,
  siJest,
  siJunit5,
  siK6,
  siKnip,
  siKotlin,
  siLefthook,
  siLighthouse,
  siMocha,
  siMockserviceworker,
  siNodedotjs,
  siNpm,
  siOwasp,
  siPercy,
  siPhp,
  siPostman,
  siPrecommit,
  siPrettier,
  siPuppeteer,
  siPytest,
  siPython,
  siQase,
  siRenovate,
  siRobotframework,
  siRubocop,
  siRuby,
  siRust,
  siSaucelabs,
  siSelenium,
  siSnyk,
  siSocket,
  siSonarqubecloud,
  siStackhawk,
  siStorybook,
  siStryker,
  siSwift,
  siTestcafe,
  siTestrail,
  siTrivy,
  siTurborepo,
  siTypescript,
  siVitepress,
  siVitest,
  siWebdriverio,
  siZap,
  type SimpleIcon,
} from 'simple-icons';
import { cn } from '../../lib/utils.js';

/** Catalog names (lower-cased) to the vendor's own mark. CC0 data from simple-icons. */
const BY_NAME = new Map<string, SimpleIcon>([
  ['vitest', siVitest],
  ['jest', siJest],
  ['cypress', siCypress],
  ['pytest', siPytest],
  ['junit 5', siJunit5],
  ['go test', siGo],
  ['mocha', siMocha],
  ['mock service worker', siMockserviceworker],
  ['selenium', siSelenium],
  ['webdriverio', siWebdriverio],
  ['puppeteer', siPuppeteer],
  ['testcafe', siTestcafe],
  ['robot framework', siRobotframework],
  ['cucumber', siCucumber],
  ['sauce labs', siSaucelabs],
  ['appium', siAppium],
  ['firebase test lab', siFirebase],
  ['bruno', siBruno],
  ['postman', siPostman],
  ['insomnia', siInsomnia],
  ['codecov', siCodecov],
  ['coveralls', siCoveralls],
  ['sonarqube cloud', siSonarqubecloud],
  ['qlty (code climate)', siCodeclimate],
  ['rubocop', siRubocop],
  ['knip', siKnip],
  ['biome', siBiome],
  ['editorconfig', siEditorconfig],
  ['checkmarx one', siCheckmarx],
  ['zap', siZap],
  ['burp suite', siBurpsuite],
  ['stackhawk', siStackhawk],
  ['snyk', siSnyk],
  ['socket', siSocket],
  ['trivy', siTrivy],
  ['owasp dependency-check', siOwasp],
  ['gatling', siGatling],
  ['gatling enterprise', siGatling],
  ['grafana cloud k6', siK6],
  ['apache jmeter', siApachejmeter],
  ['blazemeter', siBlazemeter],
  ['storybook a11y addon', siStorybook],
  ['stryker.net', siStryker],
  ['percy', siPercy],
  ['chromatic', siChromatic],
  ['argos', siArgos],
  ['testrail', siTestrail],
  ['qase', siQase],
  ['jenkins', siJenkins],
  ['circleci', siCircleci],
  ['pre-commit', siPrecommit],
  ['lefthook', siLefthook],
  ['eslint', siEslint],
  ['prettier', siPrettier],
  ['typescript', siTypescript],
  ['github actions', siGithubactions],
  ['gitlab ci', siGitlab],
  ['renovate', siRenovate],
  ['dependabot', siDependabot],
  ['lighthouse', siLighthouse],
  ['stryker', siStryker],
  ['k6', siK6],
  ['docker', siDocker],
  ['node.js', siNodedotjs],
  ['npm', siNpm],
  ['python', siPython],
  ['go', siGo],
  ['rust', siRust],
  ['ruby', siRuby],
  ['php', siPhp],
  ['.net', siDotnet],
  ['kotlin', siKotlin],
  ['swift', siSwift],
]);

/**
 * Words that identify a tool inside a detected command (`npx playwright test`, `eslint .`),
 * checked in this order, so a script is drawn with the tool it actually runs.
 */
const BY_KEYWORD: ReadonlyArray<readonly [string, SimpleIcon]> = [
  ['vitest', siVitest],
  ['jest', siJest],
  ['cypress', siCypress],
  ['eslint', siEslint],
  ['prettier', siPrettier],
  ['tsc', siTypescript],
  ['typescript', siTypescript],
  ['stryker', siStryker],
  ['docker', siDocker],
  ['turbo', siTurborepo],
  ['drizzle', siDrizzle],
  ['vitepress', siVitepress],
  ['storybook', siStorybook],
  ['k6', siK6],
];

export function toolIconFor(name: string, command = ''): SimpleIcon | undefined {
  const direct = BY_NAME.get(name.trim().toLowerCase());
  if (direct !== undefined) return direct;
  // A named catalog tool is never drawn with another tool's mark: `pnpm add -D husky` is
  // Husky, not pnpm. The command is read only for a bare script name (`lint`, `test:e2e`).
  if (!/^[a-z0-9:_-]+$/u.test(name.trim())) return undefined;
  const haystack = `${name} ${command}`.toLowerCase();
  return BY_KEYWORD.find(([word]) => new RegExp(`\\b${word}\\b`, 'u').test(haystack))?.[1];
}

export interface ToolLogoProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The tool's name, as the catalog or the scan reports it. */
  name: string;
  /** The command that runs it, used when the name alone is a script name like `lint`. */
  command?: string;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * A tool's real mark, drawn in the current text colour so twenty logos on one screen read as
 * one calm set rather than twenty brand colours. A tool with no published mark gets its
 * initial on the same tile, so every row keeps its shape.
 */
export const ToolLogo = forwardRef<HTMLSpanElement, ToolLogoProps>(
  ({ name, command, size = 'md', className, ...props }, ref) => {
    const icon = toolIconFor(name, command);
    const box = { sm: 'h-6 w-6 text-xs', md: 'h-8 w-8 text-sm', lg: 'h-12 w-12 text-lg' }[size];
    const mark = { sm: 'h-3.5 w-3.5', md: 'h-4 w-4', lg: 'h-6 w-6' }[size];
    return (
      <span
        ref={ref}
        aria-hidden="true"
        data-tool-logo={icon === undefined ? 'monogram' : icon.slug}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md bg-surface-muted font-semibold text-fg',
          box,
          className,
        )}
        {...props}
      >
        {icon === undefined ? (
          name.trim().charAt(0).toUpperCase()
        ) : (
          <svg viewBox="0 0 24 24" className={mark} fill="currentColor">
            <path d={icon.path} />
          </svg>
        )}
      </span>
    );
  },
);
ToolLogo.displayName = 'ToolLogo';
