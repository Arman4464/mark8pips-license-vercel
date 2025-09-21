import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=600'); // 10 minute cache
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false });
  
  try {
    const { data: settings } = await supabase
      .from('website_settings')
      .select('setting_key, setting_value');
    
    const config = {};
    settings?.forEach(setting => {
      config[setting.setting_key] = setting.setting_value;
    });
    
    res.json({ success: true, config });
    
  } catch (error) {
    // Fallback configuration
    res.json({ 
      success: true, 
      config: {
        site_config: {
          site_name: "Mark8Pips",
          tagline: "Professional Trading Solutions",
          primary_color: "#000000",
          secondary_color: "#9ACD32",
          youtube_channel: "@mark8pips",
          social_links: {
            youtube: "https://youtube.com/@mark8pips",
            telegram: "https://t.me/mark8pips",
            instagram: "https://instagram.com/mark8pips",
            twitter: "https://twitter.com/mark8pips"
          }
        }
      } 
    });
  }
}
