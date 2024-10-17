import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingMessage } from 'http';
import { Readable } from 'stream';

export const config = {
  api: {
    bodyParser: false,
  },
};

interface WhisperResponse {
  text: string;
  duration?: number;
}

async function buffer(readable: Readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const buf = await buffer(req);
    console.log('Received audio file, size:', buf.length);
    const formData = new FormData();
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');
    formData.append('file', new Blob([buf]), 'audio.mp4');

    console.log('Sending request to OpenAI API...');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHISPER_API_KEY}`
      },
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('OpenAI API request failed:', response.status, errorBody);
      throw new Error(`OpenAI API request failed: ${response.status} ${errorBody}`);
    }

    const data: WhisperResponse = await response.json();
    const result = data.text ?? data;
    const duration = data.duration;

    res.status(200).json({ text: result, duration });
  } catch (error) {
    console.error('Error transcribing audio:', error);
    res.status(500).json({ error: 'Error transcribing audio' });
  }
}
