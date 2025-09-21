import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // Verify admin authentication
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  
  try {
    if (req.method === 'GET') {
      // Get dashboard statistics
      const { data: users } = await supabase
        .from('users')
        .select('*')
        .order('first_seen', { ascending: false });
      
      const stats = {
        total_users: users?.length || 0,
        active_trials: users?.filter(u => u.status === 'trial').length || 0,
        paid_users: users?.filter(u => u.subscription_type !== 'trial').length || 0,
        total_revenue: users?.filter(u => u.subscription_type === 'monthly').length * 29 +
                      users?.filter(u => u.subscription_type === 'yearly').length * 290 +
                      users?.filter(u => u.subscription_type === 'lifetime').length * 999
      };
      
      res.json({ success: true, users, stats });
    }
    
    if (req.method === 'POST') {
      const { action, account_number, subscription_type, months } = req.body;
      
      if (action === 'upgrade') {
        // Upgrade user subscription
        const expiryDate = new Date();
        let newExpiry;
        
        switch (subscription_type) {
          case 'monthly':
            newExpiry = new Date(expiryDate.setMonth(expiryDate.getMonth() + 1));
            break;
          case 'yearly':
            newExpiry = new Date(expiryDate.setFullYear(expiryDate.getFullYear() + 1));
            break;
          case 'lifetime':
            newExpiry = new Date('2099-12-31');
            break;
          default:
            newExpiry = new Date(expiryDate.setMonth(expiryDate.getMonth() + 1));
        }
        
        await supabase
          .from('users')
          .update({
            subscription_type,
            status: 'active',
            expires_at: newExpiry.toISOString()
          })
          .eq('account_number', account_number);
        
        res.json({ success: true, message: 'User upgraded successfully' });
      }
      
      if (action === 'suspend') {
        await supabase
          .from('users')
          .update({ status: 'suspended' })
          .eq('account_number', account_number);
        
        res.json({ success: true, message: 'User suspended' });
      }
      
      if (action === 'extend') {
        const { data: user } = await supabase
          .from('users')
          .select('expires_at')
          .eq('account_number', account_number)
          .single();
        
        const currentExpiry = new Date(user.expires_at);
        const newExpiry = new Date(currentExpiry.setMonth(currentExpiry.getMonth() + parseInt(months)));
        
        await supabase
          .from('users')
          .update({ expires_at: newExpiry.toISOString() })
          .eq('account_number', account_number);
        
        res.json({ success: true, message: `License extended by ${months} months` });
      }
    }
    
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}
