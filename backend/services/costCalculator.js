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
  mlCommissionPercent, // ex: 12.5 para 12,5%
  shippingCost = 0,
  fixedFee = 0, // tarifa fixa do ML para itens de baixo valor, se aplicável
  taxPercent = 0, // imposto sobre a venda (Simples Nacional, etc.)
  adsCostPercent = 0 // custo de Ads como % do preço, se o vendedor usa Product Ads
}) {
  if (price <= 0) throw new Error('price precisa ser maior que zero');

  const commissionValue = price * (mlCommissionPercent / 100);
  const taxValue = price * (taxPercent / 100);
  const adsValue = price * (adsCostPercent / 100);

  const totalCosts = productCost + commissionValue + shippingCost + fixedFee + taxValue + adsValue;
  const netProfit = price - totalCosts;
  const marginPercent = (netProfit / price) * 100;

  // Preço mínimo pra não ter prejuízo, mantendo as mesmas taxas percentuais
  const percentCostsRatio = (mlCommissionPercent + taxPercent + adsCostPercent) / 100;
  const breakevenPrice = (productCost + shippingCost + fixedFee) / (1 - percentCostsRatio);

  return {
    price,
    totalCosts: round2(totalCosts),
    netProfit: round2(netProfit),
    marginPercent: round2(marginPercent),
    breakevenPrice: round2(breakevenPrice),
    breakdown: {
      productCost: round2(productCost),
      commissionValue: round2(commissionValue),
      shippingCost: round2(shippingCost),
      fixedFee: round2(fixedFee),
      taxValue: round2(taxValue),
      adsValue: round2(adsValue)
    }
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { calculateMargin };
