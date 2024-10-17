import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';

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
        const whisperApiKey = process.env.WHISPER_API_KEY;
        if (!whisperApiKey) {
            return res.status(500).json({ error: 'Whisper API key not configured' });
        }

        const openai = new OpenAI({ apiKey: whisperApiKey });

        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.includes('multipart/form-data')) {
            return res.status(400).json({ error: 'Invalid content type' });
        }

        const data: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
            data.push(chunk);
        });

        await new Promise((resolve) => req.on('end', resolve));

        const buffer = Buffer.concat(data);

        console.log('Received data size:', buffer.length, 'bytes');

        const boundary = contentType.split('boundary=')[1];
        if (!boundary) {
            return res.status(400).json({ error: 'Invalid boundary in content type' });
        }
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

        console.log('Extracted audio data size:', audioData.length, 'bytes');

        try {
            const transcription = await openai.audio.transcriptions.create({
                file: new File([audioData], 'audio.webm', { type: 'audio/webm' }),
                model: "whisper-1",
                response_format: 'verbose_json'
            });

            console.log('Transcription successful');
            res.status(200).json({
                text: transcription.text,
                audioDataSize: audioData.length,
                audioData: audioData.toString('base64')
            });
        } catch (transcriptionError) {
            console.error('Transcription error:', transcriptionError);
            res.status(200).json({
                error: 'Error transcribing audio',
                details: transcriptionError instanceof Error ? transcriptionError.message : 'Unknown error',
                audioDataSize: audioData.length,
                audioData: audioData.toString('base64')
            });
        }

    } catch (error) {
        console.error('Error processing request:', error);
        if (error instanceof Error) {
            res.status(500).json({ error: 'Error processing request', details: error.message });
        } else {
            res.status(500).json({ error: 'An unknown error occurred' });
        }
    }
}