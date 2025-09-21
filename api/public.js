import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // Route based on URL path and method
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  const route = pathname.replace('/api/public', '');
  
  try {
    switch (route) {
      case '/products':
        return await handleProducts(req, res);
      case '/create-order':
        return await handleCreateOrder(req, res);
      case '/website-settings':
        return await handleWebsiteSettings(req, res);
      default:
        return res.status(404).json({ success: false, message: 'Route not found' });
    }
  } catch (error) {
    console.error('Public API error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function handleProducts(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false });
  
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, type, description, short_description, price_monthly, price_yearly, price_lifetime, features, images, video_url, category, is_featured, is_active')
    .eq('is_active', true)
    .order('is_featured', { ascending: false });
  
  if (error) throw error;
  
  const enhancedProducts = products.map(product => ({
    ...product,
    savings_yearly: Math.round((product.price_monthly * 12 - product.price_yearly) / (product.price_monthly * 12) * 100),
    savings_lifetime: Math.round((product.price_monthly * 36 - product.price_lifetime) / (product.price_monthly * 36) * 100),
    monthly_equivalent: Math.round(product.price_lifetime / 36 * 100) / 100
  }));
  
  res.json({ success: true, products: enhancedProducts, total: products.length });
}

async function handleCreateOrder(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false });
  
  const { product_id, customer_name, customer_email, account_number, subscription_type } = req.body;
  
  // Input validation
  if (!product_id || !customer_name || !customer_email || !account_number || !subscription_type) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }
  
  // Get product details
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('*')
    .eq('id', product_id)
    .eq('is_active', true)
    .single();
  
  if (productError || !product) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }
  
  const pricing = {
    monthly: product.price_monthly,
    yearly: product.price_yearly,
    lifetime: product.price_lifetime
  };
  
  const amount = pricing[subscription_type];
  const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  
  // Create order
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      id: orderId,
      customer_email,
      customer_name,
      account_number: parseInt(account_number),
      product_id,
      subscription_type,
      amount,
      payment_status: 'pending',
      created_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (orderError) throw orderError;
  
  res.json({ 
    success: true, 
    order_id: orderId,
    amount,
    message: 'Order created successfully!'
  });
}

async function handleWebsiteSettings(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false });
  
  const { data: settings } = await supabase
    .from('website_settings')
    .select('setting_key, setting_value');
  
  const config = {};
  settings?.forEach(setting => {
    config[setting.setting_key] = setting.setting_value;
  });
  
  res.json({ success: true, config });
}
