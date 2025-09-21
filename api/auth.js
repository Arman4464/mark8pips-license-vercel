import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });
  
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  const route = pathname.replace('/api/auth', '');
  
  try {
    switch (route) {
      case '/login':
        return await handleLogin(req, res);
      default:
        return res.status(404).json({ success: false, message: 'Route not found' });
    }
  } catch (error) {
    console.error('Auth API error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function handleLogin(req, res) {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password required' });
  }
  
  // Simple hardcoded check for now (replace with database check)
  if (email === 'admin@mark8pips.com' && password === 'Mark8Pips2024!') {
    const token = jwt.sign(
      { email, role: 'owner' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    res.json({
      success: true,
      token,
      user: { email, role: 'owner' }
    });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
}
