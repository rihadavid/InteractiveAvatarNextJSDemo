import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
import { Readable } from 'stream';
import formidable from 'formidable';
import fs from 'fs';

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

        const form = formidable({
            keepExtensions: true,
            multiples: false, // This ensures we only get one file
        });

        const [fields, files] = await new Promise<[formidable.Fields<string>, formidable.Files<string>]>((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve([fields, files]);
            });
        });

        const file = files.file?.[0];  // Access the first file in the 'file' array
        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const language = fields.language?.[0] || 'en';
        const sampleRate = parseInt(fields.sampleRate?.[0] || '16000', 10);

        // Read the file
        const fileBuffer = fs.readFileSync(file.filepath);

        // Parse the audio data as Float32Array
        const float32Array = new Float32Array(fileBuffer.buffer);

        // Convert Float32Array to WAV
        const wavBuffer = await float32ArrayToWav(float32Array, sampleRate);

        // Create a readable stream from the WAV buffer
        const stream = new Readable();
        stream.push(wavBuffer);
        stream.push(null);

        try {
            const conf: OpenAI.Audio.Transcription.TranscriptionCreateParams = {
                file: stream as any,
                model: "whisper-1",
                response_format: 'json',
                language: language,
            };

            const transcription = await openai.audio.transcriptions.create(conf);

            console.log('Transcription successful');

            res.status(200).json({
                text: transcription.text,
            });

        } catch (transcriptionError) {
            console.error('Transcription error:', transcriptionError);
            res.status(500).json({
                error: 'Error transcribing audio',
                details: transcriptionError instanceof Error ? transcriptionError.message : 'Unknown error',
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

// Helper function to convert Float32Array to WAV buffer
async function float32ArrayToWav(samples: Float32Array, sampleRate: number): Promise<Buffer> {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    const floatTo16BitPCM = (output: DataView, offset: number, input: Float32Array) => {
        for (let i = 0; i < input.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, input[i]));
            output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
    };

    // Write WAV header
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    // Write audio data
    floatTo16BitPCM(view, 44, samples);

    return Buffer.from(buffer);
}
