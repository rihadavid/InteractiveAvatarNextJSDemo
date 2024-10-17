import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import fs from 'fs';
import os from 'os';
import path from 'path';

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
        for await (const chunk of req) {
            data.push(chunk);
        }
        const buffer = Buffer.concat(data);

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

        // Write the buffer to a temporary file
        const tempDir = os.tmpdir();
        const tempFilePath = path.join(tempDir, 'audio.webm');
        await fs.promises.writeFile(tempFilePath, audioData);

        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(tempFilePath),
            model: "whisper-1",
            response_format: 'verbose_json'
        });

        // Clean up the temporary file
        await fs.promises.unlink(tempFilePath);

        res.status(200).json({ text: transcription.text });
    } catch (error) {
        console.error('Error transcribing audio:', error);
        if (error instanceof Error) {
            res.status(500).json({ error: 'Error transcribing audio', details: error.message });
        } else {
            res.status(500).json({ error: 'An unknown error occurred' });
        }
    }
}