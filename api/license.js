import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function detectAccountType(accountNumber, serverName) {
  // Common patterns for demo accounts
  const demoPatterns = [
    /demo/i,
    /test/i,
    /practice/i,
    /simulation/i
  ];
  
  // Check account number patterns (demo accounts often have specific ranges)
  const isDemoByNumber = accountNumber > 50000000 && accountNumber < 90000000; // Common demo range
  
  // Check server name for demo indicators
  const isDemoByServer = serverName && demoPatterns.some(pattern => pattern.test(serverName));
  
  if (isDemoByNumber || isDemoByServer) {
    return 'demo';
  }
  
  // Real account patterns
  if (accountNumber < 50000000 || accountNumber > 90000000) {
    return 'real';
  }
  
  return 'unknown';
}

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || 
         req.headers['x-real-ip'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         req.ip || 'unknown';
}

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
      mt5_build,
      trial_type = 'trial_30',
      // Enhanced user tracking data
      account_name,
      server_name,
      account_currency,
      account_leverage,
      account_margin_mode,
      terminal_name,
      terminal_company
    } = req.body;
    
    if (!account_number || !broker_name) {
      return res.status(400).json({ success: false, message: 'Missing required data' });
    }
    
    const clientIP = getClientIP(req);
    const accountType = detectAccountType(account_number, server_name);
    
    console.log(`License validation request: Account ${account_number} (${accountType}) from ${clientIP}`);
    
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('account_number', account_number)
      .single();
    
    if (existingUser) {
      // Update existing user with enhanced tracking
      await supabase
        .from('users')
        .update({
          last_seen: new Date().toISOString(),
          account_balance,
          account_name: account_name || existingUser.account_name,
          account_type: accountType !== 'unknown' ? accountType : existingUser.account_type,
          server_name: server_name || existingUser.server_name,
          account_currency: account_currency || existingUser.account_currency,
          account_leverage: account_leverage || existingUser.account_leverage,
          account_margin_mode: account_margin_mode || existingUser.account_margin_mode,
          terminal_name: terminal_name || existingUser.terminal_name,
          terminal_company: terminal_company || existingUser.terminal_company,
          client_ip: clientIP,
          validation_count: existingUser.validation_count + 1,
          last_balance_update: new Date().toISOString()
        })
        .eq('account_number', account_number);
      
      // Check if license is valid
      const now = new Date();
      const expiryDate = new Date(existingUser.expires_at);
      
      if (expiryDate < now) {
        return res.json({
          valid: false,
          message: `${accountType === 'demo' ? 'Demo' : 'Live'} account trial expired - Contact Mark8Pips to upgrade`,
          status: 'expired',
          expires_at: existingUser.expires_at,
          account_type: accountType,
          account_name: account_name || existingUser.account_name
        });
      }
      
      if (existingUser.status !== 'active' && existingUser.status !== 'trial') {
        return res.json({
          valid: false,
          message: `${accountType === 'demo' ? 'Demo' : 'Live'} account license suspended - Contact Mark8Pips support`,
          status: existingUser.status,
          account_type: accountType,
          account_name: account_name || existingUser.account_name
        });
      }
      
      return res.json({
        valid: true,
        status: existingUser.status,
        subscription_type: existingUser.subscription_type,
        expires_at: existingUser.expires_at,
        days_remaining: Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24)),
        message: `Welcome back ${account_name || existingUser.account_name || 'Trader'}! ${existingUser.subscription_type} license active`,
        account_type: accountType,
        account_name: account_name || existingUser.account_name
      });
    } else {
      // Create new user with enhanced tracking
      const expiryDate = new Date();
      const trialDays = trial_type === 'trial_7' ? 7 : 30;
      expiryDate.setDate(expiryDate.getDate() + trialDays);
      
      console.log(`Creating new user: ${account_name || `Trader_${account_number}`} with ${trialDays}-day trial`);
      
      const { data: newUser } = await supabase
        .from('users')
        .insert({
          account_number,
          broker_name,
          account_balance,
          ea_version,
          mt5_build,
          subscription_type: trial_type,
          status: 'trial',
          expires_at: expiryDate.toISOString(),
          validation_count: 1,
          // Enhanced tracking data
          account_name: account_name || `Trader_${account_number}`,
          account_type: accountType,
          server_name,
          account_currency: account_currency || 'USD',
          account_leverage,
          account_margin_mode,
          terminal_name,
          terminal_company,
          client_ip: clientIP,
          last_balance_update: new Date().toISOString()
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
          ea_name: 'Mark8Pips Professional EA'
        });
      
      console.log(`New user created successfully: ${newUser.id}, License: ${license_key}`);
      
      return res.json({
        valid: true,
        status: 'trial',
        subscription_type: trial_type,
        expires_at: expiryDate.toISOString(),
        days_remaining: trialDays,
        license_key,
        message: `Welcome ${account_name || `Trader_${account_number}`}! ${trialDays}-day ${accountType} account trial activated`,
        account_type: accountType,
        account_name: account_name || `Trader_${account_number}`
      });
    }
    
  } catch (error) {
    console.error('License validation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'License server temporarily unavailable. Please try again.',
      valid: false 
    });
  }
}
