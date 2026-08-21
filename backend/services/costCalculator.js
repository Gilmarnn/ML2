/**
 * Calculadora de margem — propositalmente NÃO usa percentuais fixos de comissão
 * "chutados", porque a comissão do Mercado Livre varia por categoria e tipo de
 * anúncio (clássico/premium), e muda com o tempo. O usuário informa a taxa real
 * dele (visível na própria página de edição do anúncio, ou na tabela de tarifas
 * do ML pra categoria em questão), e o resto é conta.
 *
 * Isso evita o problema clássico de calculadora "genérica de mercado" que erra
 * a margem porque assume uma comissão média que não bate com a categoria real.
 */
function calculateMargin({
  price,
  productCost,
  mlCommissionPercent = 0,
  shippingCost = 0,
  fixedFee = 0,
  taxPercent = 0,
  adsCostPercent = 0
}) {
  const values = {
    price: toNumber(price, 'price'),
    productCost: toNumber(productCost, 'productCost'),
    mlCommissionPercent: toNumber(mlCommissionPercent, 'mlCommissionPercent'),
    shippingCost: toNumber(shippingCost, 'shippingCost'),
    fixedFee: toNumber(fixedFee, 'fixedFee'),
    taxPercent: toNumber(taxPercent, 'taxPercent'),
    adsCostPercent: toNumber(adsCostPercent, 'adsCostPercent')
  };

  if (values.price <= 0) throw new Error('price precisa ser maior que zero');
  for (const [key, value] of Object.entries(values)) {
    if (key !== 'price' && value < 0) throw new Error(`${key} não pode ser negativo`);
  }

  const percentCosts = values.mlCommissionPercent + values.taxPercent + values.adsCostPercent;
  if (percentCosts >= 100) {
    throw new Error('A soma dos custos percentuais precisa ser menor que 100%.');
  }

  const commissionValue = values.price * (values.mlCommissionPercent / 100);
  const taxValue = values.price * (values.taxPercent / 100);
  const adsValue = values.price * (values.adsCostPercent / 100);

  const totalCosts = values.productCost + commissionValue + values.shippingCost + values.fixedFee + taxValue + adsValue;
  const netProfit = values.price - totalCosts;
  const marginPercent = (netProfit / values.price) * 100;
  const percentCostsRatio = percentCosts / 100;
  const breakevenPrice = (values.productCost + values.shippingCost + values.fixedFee) / (1 - percentCostsRatio);

  return {
    price: values.price,
    totalCosts: round2(totalCosts),
    netProfit: round2(netProfit),
    marginPercent: round2(marginPercent),
    breakevenPrice: round2(breakevenPrice),
    breakdown: {
      productCost: round2(values.productCost),
      commissionValue: round2(commissionValue),
      shippingCost: round2(values.shippingCost),
      fixedFee: round2(values.fixedFee),
      taxValue: round2(taxValue),
      adsValue: round2(adsValue)
    }
  };
}

function toNumber(value, field) {
  if (typeof value === 'string') value = value.trim().replace(',', '.');
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} precisa ser numérico`);
  return number;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { calculateMargin };
