const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMargin } = require('../backend/services/costCalculator');

test('calcula lucro e margem com todos os custos', () => {
  const r = calculateMargin({ price: 100, productCost: 40, mlCommissionPercent: 15, shippingCost: 5, fixedFee: 2, taxPercent: 5, adsCostPercent: 3 });
  assert.equal(r.totalCosts, 70);
  assert.equal(r.netProfit, 30);
  assert.equal(r.marginPercent, 30);
});

test('aceita valores numéricos vindos como string', () => {
  const r = calculateMargin({ price: '100', productCost: '50', mlCommissionPercent: '10' });
  assert.equal(r.netProfit, 40);
  assert.equal(r.marginPercent, 40);
});

test('rejeita soma percentual igual ou maior que 100%', () => {
  assert.throws(() => calculateMargin({ price: 100, productCost: 10, mlCommissionPercent: 90, taxPercent: 10 }), /menor que 100/);
});
