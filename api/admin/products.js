import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

function verifyToken(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  
  try {
    switch (req.method) {
      case 'GET':
        return await getProducts(req, res);
      case 'POST':
        return await createProduct(req, res, user);
      case 'PUT':
        return await updateProduct(req, res, user);
      case 'DELETE':
        return await deleteProduct(req, res, user);
      default:
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Products API error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function getProducts(req, res) {
  const { data: products, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  
  res.json({ success: true, products });
}

async function createProduct(req, res, user) {
  const {
    name,
    type,
    description,
    short_description,
    price_monthly,
    price_yearly,
    price_lifetime,
    features,
    category,
    is_featured = false
  } = req.body;
  
  // Validation
  if (!name || !type || !price_monthly) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }
  
  const { data: product, error } = await supabase
    .from('products')
    .insert({
      name,
      type,
      description,
      short_description,
      price_monthly,
      price_yearly: price_yearly || price_monthly * 10, // 2 months free
      price_lifetime: price_lifetime || price_monthly * 30, // 6 months free
      features: features || [],
      category,
      is_featured,
      is_active: true
    })
    .select()
    .single();
  
  if (error) throw error;
  
  // Log admin activity
  await supabase
    .from('admin_activity')
    .insert({
      admin_email: user.email,
      action: 'create_product',
      details: { product_id: product.id, product_name: name }
    });
  
  res.json({ success: true, product, message: 'Product created successfully' });
}

async function updateProduct(req, res, user) {
  const { id } = req.query;
  const updates = req.body;
  
  if (!id) {
    return res.status(400).json({ success: false, message: 'Product ID required' });
  }
  
  const { data: product, error } = await supabase
    .from('products')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  
  if (error) throw error;
  
  // Log admin activity
  await supabase
    .from('admin_activity')
    .insert({
      admin_email: user.email,
      action: 'update_product',
      details: { product_id: id, updates }
    });
  
  res.json({ success: true, product, message: 'Product updated successfully' });
}

async function deleteProduct(req, res, user) {
  const { id } = req.query;
  
  if (!id) {
    return res.status(400).json({ success: false, message: 'Product ID required' });
  }
  
  const { error } = await supabase
    .from('products')
    .update({ is_active: false })
    .eq('id', id);
  
  if (error) throw error;
  
  // Log admin activity
  await supabase
    .from('admin_activity')
    .insert({
      admin_email: user.email,
      action: 'delete_product',
      details: { product_id: id }
    });
  
  res.json({ success: true, message: 'Product deactivated successfully' });
}
