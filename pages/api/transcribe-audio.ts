import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import FormData from "form-data";

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
        const openaiApiKey = process.env.WHISPER_API_KEY;
        if (!openaiApiKey) {
            return res.status(500).json({ error: 'OpenAI API key not configured' });
        }

        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.includes('multipart/form-data')) {
            return res.status(400).json({ error: 'Invalid content type' });
        }

        const data: Buffer[] = [];
        for await (const chunk of req) {
            data.push(chunk);
        }
        const buffer = Buffer.concat(data);

        const boundary = contentType.split('boundary=')[1];
        const parts = buffer.toString().split(`--${boundary}`);
        let audioData: Buffer | null = null;

        for (const part of parts) {
            if (part.includes('name="file"')) {
                const contentStart = part.indexOf('\r\n\r\n') + 4;
                audioData = Buffer.from(part.slice(contentStart, -2), 'binary');
                break;
            }
        }

        if (!audioData) {
            return res.status(400).json({ error: 'No audio file found in request' });
        }

        const formData = new FormData();
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'verbose_json');
        formData.append('file', audioData, { filename: 'audio.webm', contentType: 'audio/webm' });

        const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${openaiApiKey}`,
            }
        });

        const transcribedText = response.data.text;
        const duration = response.data.duration;

        res.status(200).json({ text: transcribedText, duration });
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