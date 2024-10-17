import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import axios from 'axios';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const form = new formidable.IncomingForm();
    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error('Error parsing form:', err);
        return res.status(500).json({ error: 'Error processing audio file' });
      }

      const file = files.file as formidable.File;
      const audioData = fs.readFileSync(file.filepath);

      const openaiApiKey = process.env.WHISPER_API_KEY;
      if (!openaiApiKey) {
        return res.status(500).json({ error: 'OpenAI API key not configured' });
      }

      const formData = new FormData();
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'verbose_json');
      formData.append('file', new Blob([audioData]), 'audio.webm');

      const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'multipart/form-data',
        },
      });

      const transcribedText = response.data.text ?? response.data;
      res.status(200).json({ text: transcribedText });
    });
  } catch (error) {
    console.error('Error transcribing audio:', error);
    res.status(500).json({ error: 'Error transcribing audio' });
  }
}
