export default function handler(req, res) {
  res.status(200).json({ 
    message: 'API works',
    supabase: 'configured',
    timestamp: new Date().toISOString()
  });
}