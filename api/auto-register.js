import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });
  
  try {
    const { 
      account_number, 
      broker_name, 
      account_balance, 
      ea_version, 
      mt5_build 
    } = req.body;
    
    if (!account_number || !broker_name) {
      return res.status(400).json({ success: false, message: 'Missing required data' });
    }
    
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('account_number', account_number)
      .single();
    
    if (existingUser) {
      // Update last seen and validation count
      await supabase
        .from('users')
        .update({
          last_seen: new Date().toISOString(),
          account_balance,
          validation_count: existingUser.validation_count + 1
        })
        .eq('account_number', account_number);
      
      // Check if license is valid
      const now = new Date();
      const expiryDate = new Date(existingUser.expires_at);
      
      if (expiryDate < now) {
        return res.json({
          valid: false,
          message: 'Trial period expired',
          status: 'expired',
          expires_at: existingUser.expires_at
        });
      }
      
      if (existingUser.status !== 'active' && existingUser.status !== 'trial') {
        return res.json({
          valid: false,
          message: 'License suspended',
          status: existingUser.status
        });
      }
      
      return res.json({
        valid: true,
        status: existingUser.status,
        subscription_type: existingUser.subscription_type,
        expires_at: existingUser.expires_at,
        days_remaining: Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24)),
        message: `Welcome back! ${existingUser.subscription_type} license active`
      });
    } else {
      // Create new user with 30-day trial
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);
      
      const { data: newUser } = await supabase
        .from('users')
        .insert({
          account_number,
          broker_name,
          account_balance,
          ea_version,
          mt5_build,
          subscription_type: 'trial',
          status: 'trial',
          expires_at: expiryDate.toISOString(),
          validation_count: 1
        })
        .select()
        .single();
      
      // Generate license key
      const license_key = `EA-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
      
      // Create license record
      await supabase
        .from('licenses')
        .insert({
          user_id: newUser.id,
          license_key,
          ea_name: 'Professional EA'
        });
      
      return res.json({
        valid: true,
        status: 'trial',
        subscription_type: 'trial',
        expires_at: expiryDate.toISOString(),
        days_remaining: 30,
        license_key,
        message: 'Welcome! 30-day trial activated'
      });
    }
    
  } catch (error) {
    console.error('Auto-register error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
