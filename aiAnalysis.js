const axios = require('axios');

async function fetchImageBase64(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const mediaType = response.headers['content-type'] || 'image/jpeg';
  return { base64: Buffer.from(response.data).toString('base64'), mediaType };
}

/**
 * Análise profunda de um anúncio: título, descrição, preço e foto, levando
 * em conta a concorrência real da categoria. Usa a API da Anthropic com
 * visão (manda a foto principal junto do texto) — precisa de ANTHROPIC_API_KEY
 * configurada; sem ela, devolve um erro claro em vez de quebrar o resto do app.
 */
async function deepAnalysis({ item, competitorData }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { error: 'ANTHROPIC_API_KEY não configurada no servidor. Configure essa variável para habilitar a análise por IA.' };
  }

  const content = [];
  const mainPictureUrl = (item.pictures?.[0]?.secure_url || item.pictures?.[0]?.url || item.thumbnail || '').replace(
    /^http:\/\//,
    'https://'
  );

  if (mainPictureUrl) {
    try {
      const { base64, mediaType } = await fetchImageBase64(mainPictureUrl);
      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
    } catch (e) {
      // Segue sem a imagem se não conseguir baixar — a análise de texto ainda vale.
    }
  }

  const hasSales = (item.sold_quantity || 0) > 0;

  const competitorSummary =
    competitorData.competitors.length > 0
      ? `Concorrentes reais na mesma categoria (${competitorData.competitors.length} analisados):
- Preço médio da concorrência: R$ ${competitorData.avgPrice}
- Média de fotos por anúncio concorrente: ${competitorData.avgPictures}
- % dos concorrentes com frete grátis: ${competitorData.freeShippingRate}%
- Alguns títulos concorrentes: ${competitorData.competitors.slice(0, 5).map((c) => c.title).join(' | ')}`
      : 'Não foi possível encontrar concorrentes comparáveis para essa categoria/termo de busca.';

  const salesWarning = hasSales
    ? `ATENÇÃO: este anúncio já teve ${item.sold_quantity} venda(s). O Mercado Livre restringe algumas mudanças em anúncios com vendas (categoria e condição do produto normalmente não podem mais ser alteradas, e mudanças bruscas de título/descrição podem impactar o histórico de avaliações). Sinalize claramente quais sugestões abaixo são seguras de aplicar e quais merecem cautela — sem garantir regras que você não tem certeza, apenas alertando para o vendedor confirmar na própria tela de edição do Mercado Livre antes de aplicar.`
    : 'Este anúncio ainda não teve vendas, então há mais liberdade para mudanças estruturais sem risco de perder histórico.';

  const prompt = `Você é um especialista em otimização de anúncios do Mercado Livre, focado em aumentar taxa de conversão.

DADOS DO ANÚNCIO:
- Título atual: "${item.title}"
- Preço: R$ ${item.price}
- Nº de fotos: ${(item.pictures || []).length}
- Frete grátis: ${item.shipping?.free_shipping ? 'sim' : 'não'}
- Vendas realizadas: ${item.sold_quantity || 0}
- Descrição atual (resumo): ${(item.plainDescription || 'não disponível').slice(0, 800)}

${competitorSummary}

${salesWarning}

Analise a foto principal em anexo (se houver) e responda em português, direto ao ponto, no seguinte formato exato:

TÍTULO SUGERIDO: (uma reescrita objetiva, até 60 caracteres, mais competitiva que a atual)

DESCRIÇÃO — PONTOS DE MELHORIA: (até 3 bullets objetivos e acionáveis)

PREÇO: (comentário sobre o posicionamento do preço frente à concorrência, com sugestão se fizer sentido)

FOTO: (crítica direta da foto principal: enquadramento, fundo, iluminação, o que falta — se não houver foto anexada, diga isso)

RISCO DE MUDANÇA: (classifique as sugestões acima em seguras de aplicar agora vs. que merecem cautela, considerando o aviso sobre vendas)`;

  content.push({ type: 'text', text: prompt });

  try {
    const { data } = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model: 'claude-sonnet-4-6', max_tokens: 900, messages: [{ role: 'user', content }] },
      { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } }
    );
    const text = data.content
      .map((b) => b.text || '')
      .join('\n')
      .trim();
    return { analysis: text };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    return { error: `Falha ao chamar a API da Anthropic: ${msg}` };
  }
}

module.exports = { deepAnalysis };
