import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // CORS headers for public access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=300'); // 5 minute cache
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
  
  try {
    // Get active products with optimized query
    const { data: products, error } = await supabase
      .from('products')
      .select('id, name, type, description, short_description, price_monthly, price_yearly, price_lifetime, features, images, video_url, category, is_featured, is_active')
      .eq('is_active', true)
      .order('is_featured', { ascending: false })
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    // Enhanced product data with calculated values
    const enhancedProducts = products.map(product => ({
      ...product,
      savings_yearly: Math.round((product.price_monthly * 12 - product.price_yearly) / (product.price_monthly * 12) * 100),
      savings_lifetime: Math.round((product.price_monthly * 36 - product.price_lifetime) / (product.price_monthly * 36) * 100),
      monthly_equivalent: Math.round(product.price_lifetime / 36 * 100) / 100
    }));
    
    res.json({ 
      success: true, 
      products: enhancedProducts,
      total: products.length 
    });
    
  } catch (error) {
    console.error('Products API error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
}
