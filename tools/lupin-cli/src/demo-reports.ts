/**
 * Three CI runs of a small shop's suite, oldest first, for `lupin check --demo`: what the
 * command finds, on reports nobody had to produce. One cause fails four tests, one test
 * passes only on a retry, and one flips between runs.
 */

const run = (cases: string): string => `<?xml version="1.0"?>
<testsuites><testsuite name="shop">${cases}</testsuite></testsuites>`;

const pass = (file: string, name: string, time = '0.2'): string =>
  `<testcase file="${file}" classname="${file.replace(/\.spec\.ts$/u, '')}" name="${name}" time="${time}"/>`;

const fail = (file: string, name: string, message: string, time = '5.0'): string =>
  `<testcase file="${file}" classname="${file.replace(/\.spec\.ts$/u, '')}" name="${name}" time="${time}">` +
  `<failure message="${message}"/></testcase>`;

const retried = (file: string, name: string): string =>
  `<testcase file="${file}" classname="${file.replace(/\.spec\.ts$/u, '')}" name="${name}" time="3.1">` +
  `<flakyFailure message="Timeout 3000ms exceeded waiting for locator(&apos;.toast&apos;)"/></testcase>`;

const STABLE = [
  pass('cart.spec.ts', 'adds an item'),
  pass('cart.spec.ts', 'removes an item'),
  pass('search.spec.ts', 'finds a product by name', '1.4'),
  pass('search.spec.ts', 'shows no results', '0.9'),
  pass('account.spec.ts', 'changes the password'),
].join('');

const GATEWAY = 'expected status 502 to be 200 from POST /api/payments';

export const DEMO_REPORTS: ReadonlyArray<{ name: string; xml: string }> = [
  {
    name: 'demo/run-1.xml',
    xml: run(
      STABLE +
        pass('checkout.spec.ts', 'pays by card', '2.2') +
        pass('checkout.spec.ts', 'pays by voucher', '2.0') +
        pass('login.spec.ts', 'signs in') +
        pass('account.spec.ts', 'updates the address'),
    ),
  },
  {
    name: 'demo/run-2.xml',
    xml: run(
      STABLE +
        pass('checkout.spec.ts', 'pays by card', '2.3') +
        pass('checkout.spec.ts', 'pays by voucher', '2.1') +
        fail('login.spec.ts', 'signs in', 'expected url /home, got /login') +
        pass('account.spec.ts', 'updates the address'),
    ),
  },
  {
    name: 'demo/run-3.xml',
    xml: run(
      STABLE +
        fail('checkout.spec.ts', 'pays by card', GATEWAY, '7.9') +
        fail('checkout.spec.ts', 'pays by voucher', GATEWAY.replace('502', '503')) +
        fail('checkout.spec.ts', 'refunds an order', GATEWAY) +
        fail('orders.spec.ts', 'cancels an order', GATEWAY.replace('502', '504')) +
        pass('login.spec.ts', 'signs in') +
        retried('account.spec.ts', 'updates the address'),
    ),
  },
];
