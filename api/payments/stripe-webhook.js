import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../utils/email.js';
import crypto from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleSuccessfulPayment(event.data.object);
        break;
      case 'checkout.session.expired':
        await handleExpiredPayment(event.data.object);
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }
    
    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}

async function handleSuccessfulPayment(session) {
  const orderId = session.metadata.order_id;
  
  // Update order status
  const { data: order } = await supabase
    .from('orders')
    .update({ 
      payment_status: 'completed',
      payment_method: 'stripe',
      payment_id: session.payment_intent,
      completed_at: new Date().toISOString()
    })
    .eq('id', orderId)
    .select(`
      *,
      products (*)
    `)
    .single();
  
  if (!order) return;
  
  // Create or update user license
  await createUserLicense(order);
  
  // Send confirmation emails
  await sendEmail({
    to: order.customer_email,
    template: 'payment_success',
    data: {
      customer_name: order.customer_name,
      product_name: order.products.name,
      order_id: orderId,
      account_number: order.account_number,
      download_links: await generateSecureDownloadLinks(order)
    }
  });
}

async function createUserLicense(order) {
  const expiryDate = calculateExpiryDate(order.subscription_type);
  
  // Check if user exists
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('account_number', order.account_number)
    .single();
  
  if (existingUser) {
    // Update existing user
    await supabase
      .from('users')
      .update({
        subscription_type: order.subscription_type,
        status: 'active',
        expires_at: expiryDate.toISOString()
      })
      .eq('account_number', order.account_number);
  } else {
    // Create new user
    const { data: newUser } = await supabase
      .from('users')
      .insert({
        account_number: order.account_number,
        broker_name: 'Unknown',
        subscription_type: order.subscription_type,
        status: 'active',
        expires_at: expiryDate.toISOString(),
        account_name: order.customer_name
      })
      .select()
      .single();
    
    // Create license record
    const licenseKey = `EA-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    
    await supabase
      .from('licenses')
      .insert({
        user_id: newUser.id,
        license_key: licenseKey,
        ea_name: order.products.name
      });
  }
}

function calculateExpiryDate(subscriptionType) {
  const now = new Date();
  switch (subscriptionType) {
    case 'monthly':
      return new Date(now.setMonth(now.getMonth() + 1));
    case 'yearly':
      return new Date(now.setFullYear(now.getFullYear() + 1));
    case 'lifetime':
      return new Date('2099-12-31');
    default:
      return new Date(now.setMonth(now.getMonth() + 1));
  }
}

async function generateSecureDownloadLinks(order) {
  // Generate time-limited secure download URLs
  const downloadToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  
  await supabase
    .from('download_tokens')
    .insert({
      token: downloadToken,
      order_id: order.id,
      account_number: order.account_number,
      expires_at: expiresAt.toISOString()
    });
  
  return {
    ea_download: `${process.env.FRONTEND_URL}/download/${downloadToken}/ea`,
    manual_download: `${process.env.FRONTEND_URL}/download/${downloadToken}/manual`,
    expires_at: expiresAt.toISOString()
  };
}
