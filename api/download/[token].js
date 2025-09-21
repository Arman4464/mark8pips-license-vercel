import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  
  const { token, file } = req.query;
  
  try {
    // Verify download token
    const { data: downloadToken, error } = await supabase
      .from('download_tokens')
      .select(`
        *,
        orders (
          customer_email,
          account_number,
          products (name, type)
        )
      `)
      .eq('token', token)
      .gte('expires_at', new Date().toISOString())
      .single();
    
    if (error || !downloadToken) {
      return res.status(404).json({ error: 'Invalid or expired download link' });
    }
    
    // Get file path based on product and file type
    const fileName = getSecureFileName(downloadToken.orders.products.name, file);
    const filePath = path.join(process.env.SECURE_FILES_PATH, fileName);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Log download attempt
    await supabase
      .from('download_logs')
      .insert({
        token,
        account_number: downloadToken.account_number,
        file_type: file,
        ip_address: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
        downloaded_at: new Date().toISOString()
      });
    
    // Serve file with appropriate headers
    const fileStats = fs.statSync(filePath);
    const fileExtension = path.extname(fileName);
    
    res.setHeader('Content-Type', getMimeType(fileExtension));
    res.setHeader('Content-Length', fileStats.size);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    // Stream file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
}

function getSecureFileName(productName, fileType) {
  const sanitizedName = productName.replace(/[^a-zA-Z0-9]/g, '_');
  switch (fileType) {
    case 'ea':
      return `${sanitizedName}_EA.ex4`;
    case 'manual':
      return `${sanitizedName}_Manual.pdf`;
    case 'set':
      return `${sanitizedName}_Settings.set`;
    default:
      throw new Error('Invalid file type');
  }
}

function getMimeType(extension) {
  const mimeTypes = {
    '.ex4': 'application/octet-stream',
    '.ex5': 'application/octet-stream',
    '.pdf': 'application/pdf',
    '.set': 'text/plain'
  };
  return mimeTypes[extension] || 'application/octet-stream';
}
