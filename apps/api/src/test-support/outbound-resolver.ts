import { useOutboundResolver } from '../http/outbound-guard.js';

/**
 * Every hostname a test names resolves to one public documentation address (TEST-NET-3), so
 * the outbound guard never makes a DNS query in the suite. A test about resolution passes its
 * own resolver.
 */
useOutboundResolver(async () => ['203.0.113.10']);
