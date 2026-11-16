import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLsBid } from '../server/ls-exchange.js';

test('LS Exchange values use the selected listing and reject stale or non-EUR quotes', () => {
  const html = '<span item="101@2" field="bid" decimals="4">1.234,5000</span> €' +
    '<span item="101@2" field="midTime" decimals="4">21:38:25</span>';
  const servedAt = Date.parse('2026-11-16T20:38:30Z');
  assert.deepEqual(parseLsBid(html, 101, servedAt, servedAt), { bid: 1234.5, quotedAt: servedAt - 5_000 });
  assert.equal(parseLsBid(html, 102, servedAt, servedAt), null);
  assert.equal(parseLsBid(html.replace('€', '$'), 101, servedAt, servedAt), null);
  assert.equal(parseLsBid(html.replace('21:38:25', '17:30:00'), 101, servedAt, servedAt), null);
});
