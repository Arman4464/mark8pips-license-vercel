import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  try {
    // Verify webhook signature (implementation depends on crypto payment provider)
    const signature = req.headers['x-webhook-signature'];
    const payload = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', process.env.CRYPTO_WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');
    
    if (signature !== expectedSignature) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    
    const { status, txn_id, amount, currency, custom } = req.body;
    const orderId = custom; // Order ID passed as custom field
    
    if (status === 100) { // Payment completed (varies by provider)
      await handleCryptoPayment(orderId, txn_id, amount, currency);
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Crypto webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

async function handleCryptoPayment(orderId, txnId, amount, currency) {
  // Similar to Stripe success handler but for crypto
  await supabase
    .from('orders')
    .update({ 
      payment_status: 'completed',
      payment_method: 'crypto',
      payment_id: txnId,
      completed_at: new Date().toISOString()
    })
    .eq('id', orderId);
  
  // Process license creation and send emails...
}
