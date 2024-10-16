import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingMessage } from 'http';
import { Readable } from 'stream';

export const config = {
  api: {
    bodyParser: false,
  },
};

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
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Invalid content type' });
    }

    const buf = await buffer(req);
    const boundary = contentType.split('boundary=')[1];
    const parts = buf.toString().split(`--${boundary}`);
    let audioData: Buffer | null = null;

    for (const part of parts) {
      if (part.includes('name="file"')) {
        const fileContent = part.split('\r\n\r\n')[1];
        audioData = Buffer.from(fileContent, 'binary');
        break;
      }
    }

    if (!audioData) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const formData = new FormData();
    formData.append('file', new Blob([audioData]), 'audio.webm');
    formData.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHISPER_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error('OpenAI API request failed');
    }

    const data: { text: string } = await response.json();
    res.status(200).json({ text: data.text });
  } catch (error) {
    console.error('Error transcribing audio:', error);
    res.status(500).json({ error: 'Error transcribing audio' });
  }
}
