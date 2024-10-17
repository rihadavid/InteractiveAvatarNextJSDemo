import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import FormData from "form-data";
import { Readable } from 'stream';

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
        const chunks: Uint8Array[] = [];

        for await (const chunk of req) {
            chunks.push(chunk);
        }

        const buffer = Buffer.concat(chunks);

        const openaiApiKey = process.env.WHISPER_API_KEY;
        if (!openaiApiKey) {
            return res.status(500).json({ error: 'OpenAI API key not configured' });
        }

        const form = new FormData();
        form.append('model', 'whisper-1');
        form.append('response_format', 'verbose_json');

        // Append the file as a buffer instead of a stream
        form.append('file', buffer, {
            filename: 'audio.webm',
            contentType: 'audio/webm', // Adjust this if your audio format is different
        });

        const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Bearer ${openaiApiKey}`,
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });

        const transcribedText = response.data.text ?? response.data;
        res.status(200).json({ text: transcribedText });
    } catch (error) {
        console.error('Error transcribing audio:', error);
        if (axios.isAxiosError(error)) {
            console.error('Response data:', error.response?.data);
            console.error('Response status:', error.response?.status);
            console.error('Response headers:', error.response?.headers);
        }
        res.status(500).json({ error: 'Error transcribing audio', details: error.message });
    }
}