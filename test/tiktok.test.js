const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { generateSign, serializeBody } = require('../backend/integrations/tiktok/api');
const { timestampToDate } = require('../backend/integrations/tiktok/auth');

test('TikTok serializeBody preserva corpo vazio de POST', () => {
  assert.equal(serializeBody({}), '{}');
  assert.equal(serializeBody(null), '');
});

test('TikTok generateSign segue secret + path + params ordenados + body + secret', () => {
  const secret = 'secret123';
  const path = '/order/202309/orders/search';
  const params = { timestamp: 123, app_key: 'abc', page_size: 20, sign: 'ignorar' };
  const body = { create_time_ge: 10 };
  const expectedRaw = `${secret}${path}app_keyabcpage_size20timestamp123${JSON.stringify(body)}${secret}`;
  const expected = crypto.createHmac('sha256', secret).update(expectedRaw).digest('hex');
  assert.equal(generateSign(path, params, body, secret), expected);
});

test('TikTok timestampToDate interpreta expiração como Unix timestamp', () => {
  assert.equal(timestampToDate(1700000000).toISOString(), '2023-11-14T22:13:20.000Z');
  assert.equal(timestampToDate(null), null);
});
