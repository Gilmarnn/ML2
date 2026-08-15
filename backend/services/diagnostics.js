const axios = require('axios');

/**
 * Diagnóstico por regras — não depende de nenhuma API externa além do Mercado Livre.
 * Cada checagem soma ou tira pontos de um score de 0 a 100 e gera um motivo legível.
 */
function ruleBasedDiagnosis(item, visits) {
  const checks = [];
  let score = 100;

  const titleLen = (item.title || '').length;
  if (titleLen < 40) {
    score -= 15;
    checks.push({ status: 'alerta', msg: `Título com ${titleLen} caracteres — o ML permite até 60. Título curto reduz chance de aparecer em buscas por palavras-chave secundárias.` });
  } else {
    checks.push({ status: 'ok', msg: 'Título usa bem o espaço disponível.' });
  }

  const pictureCount = (item.pictures || []).length;
  if (pictureCount < 6) {
    score -= 15;
    checks.push({ status: 'alerta', msg: `Apenas ${pictureCount} imagem(ns). O ideal é 6 ou mais, incluindo ângulos, uso e escala.` });
  } else {
    checks.push({ status: 'ok', msg: `${pictureCount} imagens cadastradas.` });
  }

  if (item.shipping?.free_shipping) {
    checks.push({ status: 'ok', msg: 'Frete grátis ativo — favorece ranqueamento e conversão.' });
  } else {
    score -= 10;
    checks.push({ status: 'alerta', msg: 'Sem frete grátis. Anúncios com frete grátis costumam converter mais e rankear melhor.' });
  }

  if (item.warranty) {
    checks.push({ status: 'ok', msg: 'Garantia informada.' });
  } else {
    score -= 5;
    checks.push({ status: 'alerta', msg: 'Campo de garantia vazio — pode reduzir confiança do comprador.' });
  }

  if (item.available_quantity === 0) {
    score -= 25;
    checks.push({ status: 'critico', msg: 'Estoque zerado — anúncio parado, sem vendas possíveis.' });
  }

  const totalVisits = visits?.total_visits ?? null;
  if (totalVisits !== null) {
    if (totalVisits === 0) {
      score -= 20;
      checks.push({ status: 'critico', msg: 'Zero visitas no período — provável problema de visibilidade (categoria errada, título fraco, ou anúncio muito novo).' });
    } else {
      checks.push({ status: 'info', msg: `${totalVisits} visitas no período analisado.` });
    }
  }

  score = Math.max(0, Math.min(100, score));

  return { score, checks };
}

/**
 * Sugestões em linguagem natural geradas por IA (opcional).
 * Só roda se ANTHROPIC_API_KEY estiver configurada no .env.
 * Isso é diferente do acesso ao Claude dentro do claude.ai — aqui é uma chamada
 * de API paga, feita com uma chave que você mesmo cria em console.anthropic.com.
 */
async function aiSuggestions(item, ruleResult) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const prompt = `Você é um especialista em otimização de anúncios do Mercado Livre.
Dados do anúncio:
- Título atual: "${item.title}"
- Preço: ${item.price}
- Categoria: ${item.category_id}
- Quantidade de imagens: ${(item.pictures || []).length}
- Frete grátis: ${item.shipping?.free_shipping ? 'sim' : 'não'}
- Score de diagnóstico automático: ${ruleResult.score}/100
- Problemas identificados: ${ruleResult.checks.filter(c => c.status !== 'ok').map(c => c.msg).join(' | ') || 'nenhum'}

Dê no máximo 3 sugestões objetivas e acionáveis para melhorar a conversão deste anúncio.
Responda em português, em formato de lista, sem introdução.`;

  try {
    const { data } = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }
      }
    );
    const text = data.content.map((b) => b.text || '').join('\n').trim();
    return text || null;
  } catch (err) {
    console.error('[diagnostics] Falha ao chamar API da Anthropic:', err.response?.data || err.message);
    return null;
  }
}

async function diagnoseItem(item, visits) {
  const ruleResult = ruleBasedDiagnosis(item, visits);
  const suggestions = await aiSuggestions(item, ruleResult);
  return { ...ruleResult, aiSuggestions: suggestions };
}

module.exports = { diagnoseItem, ruleBasedDiagnosis };
