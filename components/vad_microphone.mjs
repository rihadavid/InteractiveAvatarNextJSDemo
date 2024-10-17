// Copyright (c)  2023-2024  Xiaomi Corporation (authors: Fangjun Kuang)

import portAudio from 'naudiodon2';
// console.log(portAudio.getDevices());

import sherpa_onnx from 'sherpa-onnx-node';

export function runVad() {

    function createVad() {
        // please download silero_vad.onnx from
        // https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx
        const config = {
            sileroVad: {
                model: './silero_vad.onnx',
                threshold: 0.5,
                minSpeechDuration: 0.25,
                minSilenceDuration: 0.5,
                windowSize: 512,
            },
            sampleRate: 16000,
            debug: true,
            numThreads: 1,
        };

        const bufferSizeInSeconds = 60;

        return new sherpa_onnx.Vad(config, bufferSizeInSeconds);
    }

    const vad = createVad();

    const bufferSizeInSeconds = 30;
    const buffer = new sherpa_onnx.CircularBuffer(bufferSizeInSeconds * vad.config.sampleRate);

    const ai = new portAudio.AudioIO({
        inOptions: {
            channelCount: 1,
            closeOnError: true,  // Close the stream if an audio error is detected, if
                                 // set false then just log the error
            deviceId: -1,  // Use -1 or omit the deviceId to select the default device
            sampleFormat: portAudio.SampleFormatFloat32,
            sampleRate: vad.config.sampleRate,
        }
    });

    let printed = false;
    let index = 0;
    ai.on('data', data => {
        const windowSize = vad.config.sileroVad.windowSize;
        buffer.push(new Float32Array(data.buffer));
        while (buffer.size() > windowSize) {
            const samples = buffer.get(buffer.head(), windowSize);
            buffer.pop(windowSize);
            vad.acceptWaveform(samples)
            if (vad.isDetected() && !printed) {
                console.log(`VAD ${index}: Detected speech`)
                printed = true;
            }

            if (!vad.isDetected()) {
                printed = false;
            }

            while (!vad.isEmpty()) {
                const segment = vad.front();
                vad.pop();
                const filename = `${index}-${
                    new Date()
                        .toLocaleTimeString('en-US', {hour12: false})
                        .split(' ')[0]}.wav`;
                sherpa_onnx.writeWave(
                    filename,
                    {samples: segment.samples, sampleRate: vad.config.sampleRate});
                const duration = segment.samples.length / vad.config.sampleRate;
                console.log(`VAD ${index} End of speech. Duration: ${duration} seconds`);
                console.log(`VAD Saved to ${filename}`);
                index += 1;
            }
        }
    });

    ai.on('close', () => {
        console.log('VAD Free resources');
    });

    ai.start();
    console.log('VAD Started! Please speak')
}