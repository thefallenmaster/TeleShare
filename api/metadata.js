require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method === 'POST') {
        // Insert metadata
        const { telegram_file_id, telegram_message_id, file_name, file_size, mime_type } = req.body;

        const { data, error } = await supabase.from('skyshare_files').insert([{
            telegram_file_id,
            telegram_message_id,
            file_name,
            file_size,
            mime_type,
            downloads_count: 0
        }]).select();

        if (error) {
            console.error('Supabase save error:', error);
            return res.status(500).json({ error: error.message });
        }
        return res.status(200).json(data);
    } 
    
    if (req.method === 'GET') {
        // Fetch metadata
        const { id } = req.query;
        if (!id) {
            return res.status(400).json({ error: 'Missing id parameter' });
        }

        const { data, error } = await supabase
            .from('skyshare_files')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'File not found' });
        }

        return res.status(200).json(data);
    }

    if (req.method === 'PATCH') {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'Missing id parameter' });

        const { data: file, error: fetchError } = await supabase
            .from('skyshare_files')
            .select('downloads_count')
            .eq('id', id)
            .single();

        if (fetchError || !file) {
            return res.status(404).json({ error: 'File not found' });
        }

        const newCount = (file.downloads_count || 0) + 1;
        const { error: updateError } = await supabase
            .from('skyshare_files')
            .update({ downloads_count: newCount })
            .eq('id', id);

        if (updateError) {
            return res.status(500).json({ error: updateError.message });
        }

        return res.status(200).json({ downloads_count: newCount });
    }

    res.status(405).json({ error: 'Method not allowed' });
}
