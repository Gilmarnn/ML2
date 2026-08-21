function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstImage(raw) {
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length) {
    const image = raw[0];
    return image?.urls?.[0] || image?.url || image?.thumb_url || image;
  }
  if (Array.isArray(raw.images) && raw.images.length) {
    const image = raw.images[0];
    return image?.urls?.[0] || image?.url || image?.thumb_url || image || null;
  }
  if (raw.image?.image_url_list?.length) return raw.image.image_url_list[0];
  if (raw.thumbnail) return raw.thumbnail;
  if (Array.isArray(raw.pictures) && raw.pictures.length) return raw.pictures[0]?.secure_url || raw.pictures[0]?.url || null;
  return null;
}

function normalizeProduct(platform, raw) {
  switch (platform) {
    case 'mercadolivre':
      return {
        platform,
        platform_product_id: String(raw.id),
        title: raw.title || '',
        price: number(raw.price),
        currency: raw.currency_id || 'BRL',
        stock: number(raw.available_quantity),
        status: raw.status || null,
        thumbnail: firstImage(raw),
        sold_quantity: number(raw.sold_quantity),
        raw_data: raw
      };
    case 'tiktok': {
      const sku = raw.skus?.[0] || {};
      const price = sku.price?.sale_price || sku.price?.tax_exclusive_price || raw.price || 0;
      const stock = (sku.inventory || []).reduce((sum, row) => sum + number(row.quantity), 0);
      return {
        platform,
        platform_product_id: String(raw.id || raw.product_id),
        title: raw.title || raw.product_name || '',
        price: number(price),
        currency: sku.price?.currency || raw.currency || 'BRL',
        stock,
        status: raw.status || null,
        thumbnail: firstImage(raw.main_images || raw),
        sold_quantity: number(raw.sales_count || raw.sold_count),
        raw_data: raw
      };
    }
    case 'shopee': {
      const models = raw.model || raw.models || [];
      const firstModel = models[0] || {};
      return {
        platform,
        platform_product_id: String(raw.item_id || raw.id),
        title: raw.item_name || raw.name || '',
        price: number(firstModel.price_info?.current_price ?? raw.price_info?.[0]?.current_price ?? raw.price),
        currency: raw.currency || 'BRL',
        stock: number(firstModel.stock_info_v2?.summary_info?.total_available_stock ?? raw.stock_info_v2?.summary_info?.total_available_stock ?? raw.stock),
        status: raw.item_status || raw.status || null,
        thumbnail: firstImage(raw),
        sold_quantity: number(raw.sold || raw.historical_sold),
        raw_data: raw
      };
    }
    default:
      throw new Error(`Plataforma ${platform} não suportada para produtos.`);
  }
}

function normalizeOrder(platform, raw) {
  switch (platform) {
    case 'mercadolivre':
      return {
        platform,
        platform_order_id: String(raw.id),
        status: raw.status || null,
        total_amount: number(raw.total_amount),
        currency: raw.currency_id || 'BRL',
        buyer_id: raw.buyer?.id ? String(raw.buyer.id) : null,
        order_created_at: raw.date_created || null,
        order_updated_at: raw.last_updated || null,
        raw_data: raw
      };
    case 'tiktok':
      return {
        platform,
        platform_order_id: String(raw.id || raw.order_id),
        status: raw.status || null,
        total_amount: number(raw.payment?.total_amount || raw.payment?.original_total_product_price || raw.total_amount),
        currency: raw.payment?.currency || raw.currency || 'BRL',
        buyer_id: raw.buyer_email || raw.buyer_user_id || null,
        order_created_at: raw.create_time ? new Date(number(raw.create_time) * 1000).toISOString() : null,
        order_updated_at: raw.update_time ? new Date(number(raw.update_time) * 1000).toISOString() : null,
        raw_data: raw
      };
    case 'shopee':
      return {
        platform,
        platform_order_id: String(raw.order_sn || raw.id),
        status: raw.order_status || raw.status || null,
        total_amount: number(raw.total_amount),
        currency: raw.currency || 'BRL',
        buyer_id: raw.buyer_username || raw.buyer_user_id || null,
        order_created_at: raw.create_time ? new Date(number(raw.create_time) * 1000).toISOString() : null,
        order_updated_at: raw.update_time ? new Date(number(raw.update_time) * 1000).toISOString() : null,
        raw_data: raw
      };
    default:
      throw new Error(`Plataforma ${platform} não suportada para pedidos.`);
  }
}

module.exports = { normalizeProduct, normalizeOrder };
