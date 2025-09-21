import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../utils/email.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });
  
  try {
    const { order_id } = req.body;
    
    // Get order details
    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        *,
        products (name, description, type)
      `)
      .eq('id', order_id)
      .eq('payment_status', 'pending')
      .single();
    
    if (error || !order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${order.products.name} - ${order.subscription_type}`,
            description: order.products.description,
            metadata: {
              type: order.products.type,
              account_number: order.account_number.toString()
            }
          },
          unit_amount: Math.round(order.amount * 100), // Convert to cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/payment/success?order_id=${order_id}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment/cancel?order_id=${order_id}`,
      customer_email: order.customer_email,
      metadata: {
        order_id: order_id,
        account_number: order.account_number.toString(),
        subscription_type: order.subscription_type
      },
      expires_at: Math.floor(Date.now() / 1000) + (3600 * 24) // 24 hours
    });
    
    // Update order with Stripe session ID
    await supabase
      .from('orders')
      .update({ stripe_session_id: session.id })
      .eq('id', order_id);
    
    res.json({ success: true, checkout_url: session.url, session_id: session.id });
    
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(500).json({ success: false, message: 'Payment setup failed' });
  }
}
