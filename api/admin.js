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
  
  // Verify admin authentication
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  const route = pathname.replace('/api/admin', '');
  
  try {
    switch (route) {
      case '/dashboard':
        return await handleDashboard(req, res, user);
      case '/products':
        return await handleProducts(req, res, user);
      case '/orders':
        return await handleOrders(req, res, user);
      case '/settings':
        return await handleSettings(req, res, user);
      default:
        return res.status(404).json({ success: false, message: 'Route not found' });
    }
  } catch (error) {
    console.error('Admin API error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function handleDashboard(req, res, user) {
  if (req.method === 'GET') {
    // Get dashboard statistics
    const { data: users } = await supabase
      .from('users')
      .select('*')
      .order('first_seen', { ascending: false });
    
    const now = new Date();
    const stats = {
      total_users: users?.length || 0,
      trial_users: users?.filter(u => u.subscription_type?.includes('trial')).length || 0,
      paid_users: users?.filter(u => !u.subscription_type?.includes('trial')).length || 0,
      active_users: users?.filter(u => u.status === 'active' || u.status === 'trial').length || 0,
      total_revenue: {
        total: users?.filter(u => u.subscription_type === 'monthly').length * 29 +
               users?.filter(u => u.subscription_type === 'yearly').length * 290 +
               users?.filter(u => u.subscription_type === 'lifetime').length * 999
      }
    };
    
    res.json({ success: true, users, stats });
  }
  
  if (req.method === 'POST') {
    const { action, account_number, subscription_type, months, days } = req.body;
    
    if (action === 'upgrade') {
      const now = new Date();
      let newExpiry;
      
      switch (subscription_type) {
        case 'monthly':
          newExpiry = new Date(now.setMonth(now.getMonth() + 1));
          break;
        case 'yearly':
          newExpiry = new Date(now.setFullYear(now.getFullYear() + 1));
          break;
        case 'lifetime':
          newExpiry = new Date('2099-12-31');
          break;
        default:
          newExpiry = new Date(now.setMonth(now.getMonth() + 1));
      }
      
      await supabase
        .from('users')
        .update({
          subscription_type,
          status: 'active',
          expires_at: newExpiry.toISOString()
        })
        .eq('account_number', account_number);
      
      res.json({ success: true, message: 'User upgraded successfully!' });
    }
    
    if (action === 'extend') {
      const { data: userToExtend } = await supabase
        .from('users')
        .select('expires_at')
        .eq('account_number', account_number)
        .single();
      
      if (!userToExtend) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      
      const currentExpiry = new Date(userToExtend.expires_at);
      const now = new Date();
      const baseDate = currentExpiry > now ? currentExpiry : now;
      let newExpiry;
      
      if (days) {
        newExpiry = new Date(baseDate);
        newExpiry.setDate(baseDate.getDate() + parseInt(days));
      } else if (months) {
        newExpiry = new Date(baseDate);
        newExpiry.setMonth(baseDate.getMonth() + parseInt(months));
      } else {
        return res.status(400).json({ success: false, message: 'Please specify days or months' });
      }
      
      await supabase
        .from('users')
        .update({ expires_at: newExpiry.toISOString(), status: 'active' })
        .eq('account_number', account_number);
      
      const extensionText = days ? `${days} days` : `${months} months`;
      res.json({ success: true, message: `License extended by ${extensionText}!` });
    }
    
    if (action === 'suspend') {
      await supabase
        .from('users')
        .update({ status: 'suspended' })
        .eq('account_number', account_number);
      
      res.json({ success: true, message: 'User suspended successfully' });
    }
  }
}

async function handleProducts(req, res, user) {
  // Product CRUD operations
  if (req.method === 'GET') {
    const { data: products } = await supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false });
    
    res.json({ success: true, products });
  }
  
  if (req.method === 'POST') {
    const { name, type, price_monthly, price_yearly, price_lifetime, description } = req.body;
    
    const { data: product } = await supabase
      .from('products')
      .insert({
        name,
        type,
        price_monthly,
        price_yearly: price_yearly || price_monthly * 10,
        price_lifetime: price_lifetime || price_monthly * 30,
        description,
        is_active: true
      })
      .select()
      .single();
    
    res.json({ success: true, product, message: 'Product created successfully' });
  }
}

async function handleOrders(req, res, user) {
  const { data: orders } = await supabase
    .from('orders')
    .select(`
      *,
      products (name, type)
    `)
    .order('created_at', { ascending: false });
  
  res.json({ success: true, orders });
}

async function handleSettings(req, res, user) {
  if (req.method === 'GET') {
    const { data: settings } = await supabase
      .from('website_settings')
      .select('*');
    
    res.json({ success: true, settings });
  }
  
  if (req.method === 'POST') {
    const { setting_key, setting_value } = req.body;
    
    await supabase
      .from('website_settings')
      .upsert({ setting_key, setting_value });
    
    res.json({ success: true, message: 'Settings updated' });
  }
}
