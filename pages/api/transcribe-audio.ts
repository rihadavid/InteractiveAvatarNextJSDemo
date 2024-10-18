import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';
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

        const [fields, files] = await new Promise<[formidable.Fields, formidable.Files]>((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve([fields, files]);
            });
        });

        // Extract language from fields
        const language = fields.language as string;

        const fileArray = files.file;
        if (!fileArray || fileArray.length === 0) {
            return res.status(400).json({ error: 'No audio file found in request' });
        }

        const file = Array.isArray(fileArray) ? fileArray[0] : fileArray;

        console.log('Received file size:', fs.statSync(file.filepath).size, 'bytes');

        try {

            let conf: {
                file: any;
                model: string;
                response_format: string;
                language?: string;
            } = {
                file: fs.createReadStream(file.filepath),
                model: "whisper-1",
                response_format: 'verbose_json'
            };

            if(language && language.length > 0)
                conf.language = language;

            const transcription = await openai.audio.transcriptions.create(conf);

            console.log('Transcription successful');

            // Read the file content to send back to the client
            const audioData = fs.readFileSync(file.filepath);

            res.status(200).json({
                text: transcription.text,
                audioDataSize: audioData.length,
                audioData: audioData.toString('base64')
            });

            // Clean up the temporary file
            fs.unlinkSync(file.filepath);

        } catch (transcriptionError) {
            console.error('Transcription error:', transcriptionError);

            // Read the file content to send back to the client even if transcription failed
            const audioData = fs.readFileSync(file.filepath);

            res.status(200).json({
                error: 'Error transcribing audio',
                details: transcriptionError instanceof Error ? transcriptionError.message : 'Unknown error',
                audioDataSize: audioData.length,
                audioData: audioData.toString('base64')
            });

            // Clean up the temporary file
            fs.unlinkSync(file.filepath);
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
