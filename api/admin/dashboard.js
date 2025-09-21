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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // Verify admin authentication
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  
  try {
    if (req.method === 'GET') {
      // Get dashboard statistics with more details
      const { data: users } = await supabase
        .from('users')
        .select('*')
        .order('first_seen', { ascending: false });
      
      const now = new Date();
      const stats = {
        total_users: users?.length || 0,
        trial_7_users: users?.filter(u => u.subscription_type === 'trial_7').length || 0,
        trial_30_users: users?.filter(u => u.subscription_type === 'trial_30').length || 0,
        monthly_users: users?.filter(u => u.subscription_type === 'monthly').length || 0,
        yearly_users: users?.filter(u => u.subscription_type === 'yearly').length || 0,
        lifetime_users: users?.filter(u => u.subscription_type === 'lifetime').length || 0,
        active_users: users?.filter(u => u.status === 'active' || u.status === 'trial').length || 0,
        suspended_users: users?.filter(u => u.status === 'suspended').length || 0,
        expired_users: users?.filter(u => new Date(u.expires_at) < now).length || 0,
        expiring_soon: users?.filter(u => {
          const daysLeft = Math.ceil((new Date(u.expires_at) - now) / (1000 * 60 * 60 * 24));
          return daysLeft > 0 && daysLeft <= 7;
        }).length || 0,
        total_revenue: {
          monthly: users?.filter(u => u.subscription_type === 'monthly').length * 29,
          yearly: users?.filter(u => u.subscription_type === 'yearly').length * 290,
          lifetime: users?.filter(u => u.subscription_type === 'lifetime').length * 999,
          total: users?.filter(u => u.subscription_type === 'monthly').length * 29 +
                 users?.filter(u => u.subscription_type === 'yearly').length * 290 +
                 users?.filter(u => u.subscription_type === 'lifetime').length * 999
        }
      };
      
      // Get recent activity
      const { data: recentUsers } = await supabase
        .from('users')
        .select('*')
        .order('last_seen', { ascending: false })
        .limit(10);
      
      res.json({ success: true, users, stats, recent_activity: recentUsers });
    }
    
    if (req.method === 'POST') {
      const { action, account_number, subscription_type, months, days, trial_type } = req.body;
      
      if (action === 'upgrade') {
        // Upgrade user subscription
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
          case 'trial_7':
            newExpiry = new Date(now.setDate(now.getDate() + 7));
            break;
          case 'trial_30':
            newExpiry = new Date(now.setDate(now.getDate() + 30));
            break;
          default:
            newExpiry = new Date(now.setMonth(now.getMonth() + 1));
        }
        
        await supabase
          .from('users')
          .update({
            subscription_type,
            status: subscription_type.includes('trial') ? 'trial' : 'active',
            expires_at: newExpiry.toISOString()
          })
          .eq('account_number', account_number);
        
        res.json({ success: true, message: `User upgraded to ${subscription_type}`, new_expires_at: newExpiry.toISOString() });
      }
      
      if (action === 'extend') {
        // Get current user data
        const { data: user } = await supabase
          .from('users')
          .select('expires_at')
          .eq('account_number', account_number)
          .single();
        
        if (!user) {
          return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        // Extend from current expiry date (not from now)
        const currentExpiry = new Date(user.expires_at);
        let newExpiry;
        
        if (days) {
          newExpiry = new Date(currentExpiry.setDate(currentExpiry.getDate() + parseInt(days)));
        } else if (months) {
          newExpiry = new Date(currentExpiry.setMonth(currentExpiry.getMonth() + parseInt(months)));
        } else {
          return res.status(400).json({ success: false, message: 'Please specify days or months' });
        }
        
        await supabase
          .from('users')
          .update({ 
            expires_at: newExpiry.toISOString(),
            status: 'active' // Reactivate if was expired
          })
          .eq('account_number', account_number);
        
        const extensionText = days ? `${days} days
