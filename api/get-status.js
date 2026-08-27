import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method Not Allowed' });

  try {
    const { data, error } = await supabase
      .from('scheduled_uploads')
      .select('id, project_id, project_name, game_version, release_type, file_name, status, scheduled_at, created_at, uploaded_at, error')
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) throw error;

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}