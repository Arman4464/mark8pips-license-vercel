import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../utils/email.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || 
         req.headers['x-real-ip'] || 
         req.connection.remoteAddress || 
         'unknown';
}

async function generateOrderId() {
  return `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });
  
  try {
    const { 
      product_id, 
      customer_name, 
      customer_email, 
      account_number, 
      subscription_type,
      referral_code 
    } = req.body;
    
    // Input validation
    if (!product_id || !customer_name || !customer_email || !account_number || !subscription_type) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: product_id, customer_name, customer_email, account_number, subscription_type' 
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customer_email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }
    
    // Validate account number (MT4/MT5 accounts are typically 6-10 digits)
    if (!/^\d{6,10}$/.test(account_number.toString())) {
      return res.status(400).json({ success: false, message: 'Invalid MT4/MT5 account number format' });
    }
    
    // Get product details
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', product_id)
      .eq('is_active', true)
      .single();
    
    if (productError || !product) {
      return res.status(404).json({ success: false, message: 'Product not found or inactive' });
    }
    
    // Check if account already has active license for this product
    const { data: existingUser } = await supabase
      .from('users')
      .select('subscription_type, expires_at, status')
      .eq('account_number', account_number)
      .single();
    
    if (existingUser && existingUser.status === 'active' && new Date(existingUser.expires_at) > new Date()) {
      return res.status(409).json({ 
        success: false, 
        message: 'Account already has an active license. Contact support for upgrades.' 
      });
    }
    
    // Calculate pricing
    const pricing = {
      monthly: product.price_monthly,
      yearly: product.price_yearly,
      lifetime: product.price_lifetime
    };
    
    const amount = pricing[subscription_type];
    if (!amount) {
      return res.status(400).json({ success: false, message: 'Invalid subscription type' });
    }
    
    // Apply referral discount if applicable
    let discount = 0;
    let affiliate_id = null;
    if (referral_code) {
      const { data: affiliate } = await supabase
        .from('affiliates')
        .select('id, commission_rate')
        .eq('code', referral_code)
        .eq('is_active', true)
        .single();
      
      if (affiliate) {
        discount = Math.round(amount * 0.1 * 100) / 100; // 10% discount for referrals
        affiliate_id = affiliate.id;
      }
    }
    
    const finalAmount = amount - discount;
    const orderId = await generateOrderId();
    const clientIP = getClientIP(req);
    
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
        amount: finalAmount,
        original_amount: amount,
        discount_amount: discount,
        payment_status: 'pending',
        client_ip: clientIP,
        affiliate_id,
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (orderError) throw orderError;
    
    // Send confirmation email
    await sendEmail({
      to: customer_email,
      template: 'order_confirmation',
      data: {
        customer_name,
        product_name: product.name,
        order_id: orderId,
        amount: finalAmount,
        subscription_type,
        account_number,
        payment_instructions: getPaymentInstructions(finalAmount)
      }
    });
    
    // Send admin notification
    await sendEmail({
      to: process.env.ADMIN_EMAIL || 'admin@mark8pips.com',
      template: 'new_order_admin',
      data: {
        customer_name,
        customer_email,
        product_name: product.name,
        order_id: orderId,
        amount: finalAmount,
        account_number
      }
    });
    
    res.json({ 
      success: true, 
      order_id: orderId,
      amount: finalAmount,
      payment_methods: getPaymentMethods(),
      message: 'Order created successfully! Check your email for payment instructions.' 
    });
    
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
}

function getPaymentMethods() {
  return {
    crypto: {
      enabled: true,
      currencies: ['USDT', 'BTC', 'ETH'],
      processor: 'coinpayments'
    },
    stripe: {
      enabled: true,
      methods: ['card']
    },
    bank_transfer: {
      enabled: true,
      details: 'Contact support for bank details'
    }
  };
}

function getPaymentInstructions(amount) {
  return {
    stripe: `Complete payment of $${amount} using the secure Stripe checkout link sent to your email.`,
    crypto: `Send $${amount} equivalent in USDT (TRC20) to the wallet address provided in your email.`,
    bank_transfer: `Transfer $${amount} to our bank account (details in email) with order ID as reference.`
  };
}
