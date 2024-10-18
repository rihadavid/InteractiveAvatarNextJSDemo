'use client';

import type {StartAvatarResponse} from "@heygen/streaming-avatar";

import StreamingAvatar, {
    AvatarQuality,
    StreamingEvents, TaskType, VoiceEmotion,
} from "@heygen/streaming-avatar";
import {
    Button,
    Card,
    CardBody,
    CardFooter,
    Divider,
    Input,
    Select,
    SelectItem,
    Spinner,
    Chip,
    Tabs,
    Tab,
} from "@nextui-org/react";
import {useEffect, useRef, useState, useCallback} from "react";
import {useMemoizedFn, usePrevious} from "ahooks";
import {useSearchParams} from 'next/navigation';

import InteractiveAvatarTextInput from "./InteractiveAvatarTextInput";

import {AVATARS, STT_LANGUAGE_LIST} from "@/app/lib/constants";

import {useMicVAD} from "@ricky0123/vad-react";

import * as ort from 'onnxruntime-web';

import axios from 'axios';

import OpusMediaRecorder from 'opus-media-recorder';
import '../node_modules/opus-media-recorder/encoderWorker.js'; // Include the encoder worker

const wsUrl = process.env.NEXT_PUBLIC_WSS_URL;
const interruptionUrl = process.env.NEXT_PUBLIC_INTERRUPTION_URL;

export default function InteractiveAvatar() {
    const customSessionIdRef = useRef<string | null>(null);
    const languageRef = useRef<string | null>('en');
    const wsConnectionRef = useRef<WebSocket | null>(null);

    const [isLoadingSession, setIsLoadingSession] = useState(false);
    const [isLoadingRepeat, setIsLoadingRepeat] = useState(false);
    const [stream, setStream] = useState<MediaStream>();
    const [debug, setDebug] = useState<string>();
    const [knowledgeId, setKnowledgeId] = useState<string>("");
    const [avatarId, setAvatarId] = useState<string>("");
    const [language, setLanguage] = useState<string>();

    const [data, setData] = useState<StartAvatarResponse>();
    const [text, setText] = useState<string>("");
    const [pendingText, setPendingText] = useState<string>("");
    const mediaStream = useRef<HTMLVideoElement>(null);
    const avatar = useRef<StreamingAvatar | null>(null);
    const [chatMode, setChatMode] = useState("text_mode");
    const [isUserTalking, setIsUserTalking] = useState(false);
    const [isAvatarTalking, setIsAvatarTalking] = useState(false);

    const [signature, setSignature] = useState<string | null>(null);

    const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);

    /*const MyComponent = () => {
        const vad = useMicVAD ({
            startOnLoad: true,
            onSpeechEnd: (audio) => {
                console.log("User stopped talking")
            },
        })
        return <div>{vad.userSpeaking && "User is speaking"}</div>
    }*/

    //const [vadInstance, setVadInstance] = useState<MicVAD | null>(null);

    // Use useEffect to access search params after component mount
    useEffect(() => {
        console.log("will try to set custom_session_id")
        try {
            const searchParams = new URLSearchParams(window.location.search);
            const userId = searchParams.get('userId');
            const chatId = searchParams.get('chatId');
            const s = searchParams.get('callId');
            setSignature(s);
            const botUsername = searchParams.get('botUsername');

            let custom_session_id = `${userId}:${chatId}:${s}`;
            if (botUsername) {
                custom_session_id += `:${botUsername}`;
            }

            console.log("Setting custom_session_id to: " + custom_session_id)

            customSessionIdRef.current = custom_session_id;
        } catch (e) {
            console.error('Error set custom_session_id:', e);
        }
    }, []);

    async function fetchAccessToken() {
        try {
            const response = await fetch("/api/get-access-token", {
                method: "POST",
            });
            const token = await response.text();

            console.log("Access Token:", token); // Log the token to verify

            return token;
        } catch (error) {
            console.error("Error fetching access token:", error);
        }

        return "";
    }

    const vad = useMicVAD({
        onSpeechStart: async () => {
            console.log("VAD speech start");
            setIsUserTalking(true);

            let interruptAvatarTask = handleInterrupt();

            console.log("Calling INTERRUPT from onSpeechStart");
            let interruptTask = fetch(`${interruptionUrl}/?signature=${signature}`, {
                method: 'GET',
            }).catch(error => {
                console.error('Error reporting interruption:', error);
            });
            setIsAvatarTalking(false);
            await interruptTask;
            if (interruptAvatarTask)
                await interruptAvatarTask;
        },
        onSpeechEnd: async (audio) => {
            console.log("VAD speech end");
            setIsUserTalking(false);
            await sendAudioForTranscription(audio);
        },
    });

    async function startSession() {
        setIsLoadingSession(true);
        const newToken = await fetchAccessToken();

        if (!wsUrl) {
            console.error("WebSocket URL is not configured");
            return;
        }

        const ws = new WebSocket(wsUrl);
        ws.onopen = () => {
            console.log("WebSocket connection established");
            wsConnectionRef.current = ws;
        };
        ws.onerror = (error) => {
            console.error("WebSocket error:", error);
        };
        ws.onclose = () => {
            console.log("WebSocket connection closed");
            wsConnectionRef.current = null;
        };

        avatar.current = new StreamingAvatar({
            token: newToken,
        });
        avatar.current.on(StreamingEvents.AVATAR_START_TALKING, (e) => {
            //console.log("Avatar started talking", e);
            setIsAvatarTalking(true);
        });
        avatar.current.on(StreamingEvents.AVATAR_STOP_TALKING, (e) => {
            //console.log("Avatar stopped talking", e);
            setIsAvatarTalking(false);
        });
        avatar.current.on(StreamingEvents.STREAM_DISCONNECTED, () => {
            console.log("Stream disconnected");
            endSession();
        });
        avatar.current?.on(StreamingEvents.STREAM_READY, (event) => {
            console.log(">>>>> Stream ready:", event.detail);
            setStream(event.detail);
            setIsLoadingSession(false);
        });
        avatar.current?.on(StreamingEvents.USER_START, async (event) => {
            console.log(">>>>> User started talking:", event);
            //setIsUserTalking(true);

            if (isAvatarTalking) {
                console.log("Calling INTERRUPT from StreamingEvents.USER_START");
                let interruptTask = fetch(`${interruptionUrl}/?signature=${signature}`, {
                    method: 'GET',
                }).catch(error => {
                    console.error('Error reporting interruption:', error);
                });
                setIsAvatarTalking(false);
                await interruptTask;
            }

            // Start recording when user starts talking
            await startRecording();
        });
        avatar.current?.on(StreamingEvents.USER_STOP, async (event) => {
            console.log(">>>>> User stopped talking:", event);
            //setIsUserTalking(false);

            // Stop recording and transcribe when user stops talking
            await stopRecording();
        });
        try {
            const res = await avatar.current.createStartAvatar({
                quality: AvatarQuality.Low,
                avatarName: 'josh_lite3_20230714',//avatarId,
                knowledgeId: knowledgeId, // Or use a custom `knowledgeBase`.
                voice: {
                    rate: 1.5, // 0.5 ~ 1.5
                    emotion: VoiceEmotion.EXCITED,
                },
                language: languageRef.current,
            });

            setData(res);
            console.log("VAD start");
            vad.start(); // Start VAD when the session starts
        } catch (error) {
            console.error("Error starting avatar session:", error);
        } finally {
            if (stream)
                setIsLoadingSession(false);
        }
    }

    function handleSpeakk() {
        return;
    }

    async function handleSpeak(speakText: string) {
        console.log("Handle speak invoked");
        setIsLoadingRepeat(true);
        if (!avatar.current) {
            console.log("Avatar API not initialized");
            setDebug("Avatar API not initialized");
            return;
        }

        if (!customSessionIdRef.current) {
            console.log("Custom session ID not available");
            setDebug("Custom session ID not available");
            return;
        }

        if (!wsConnectionRef.current) {
            console.log("WebSocket connection not established");
            setDebug("WebSocket connection not established");
            return;
        }

        try {
            wsConnectionRef.current.send(JSON.stringify({
                action: 'MESSAGE',
                message: speakText,
                custom_session_id: customSessionIdRef.current
            }));

            wsConnectionRef.current.onmessage = async (event) => {
                const chunk = event.data;
                console.log("RECEIVED CHUNK:\n" + chunk);

                if (chunk === '[END]') {
                    return;
                }

                if (avatar.current) {
                    //console.log("handleSpeak sending text");
                    await avatar.current.speak({text: chunk, task_type: TaskType.REPEAT});
                } else {
                    console.log("Avatar API not initialized during speech");
                    setDebug("Avatar API not initialized during speech");
                }
            };
        } catch (e) {
            console.error(e instanceof Error ? e.message : 'An unknown error occurred');
            setDebug(e instanceof Error ? e.message : 'An unknown error occurred');
        } finally {
            setIsLoadingRepeat(false);
        }
    }

    async function handleInterrupt() {
        if (!avatar.current) {
            setDebug("Avatar API not initialized");

            return;
        }

        await avatar.current
            .interrupt()
            .catch((e) => {
                console.log(e.message);
            });
    }

    async function endSession() {
        await avatar.current?.stopAvatar();
        setStream(undefined);
        if (wsConnectionRef.current) {
            wsConnectionRef.current.close();
            wsConnectionRef.current = null;
        }
        console.log("VAD pause");
        vad.pause(); // Stop VAD when ending the session
    }

    const handleChangeChatMode = useMemoizedFn(async (v) => {
        if (v === chatMode) {
            return;
        }
        if (v === "text_mode") {
            avatar.current?.closeVoiceChat();
        } else {
            await avatar.current?.startVoiceChat();
        }
        setChatMode(v);
    });

    const previousText = usePrevious(text);
    useEffect(() => {
        if (!previousText && text) {
            avatar.current?.startListening();
        } else if (previousText && !text) {
            avatar?.current?.stopListening();
        }
    }, [text, previousText]);

    useEffect(() => {
        return () => {
            endSession();
            if (wsConnectionRef.current) {
                wsConnectionRef.current.close();
            }
        };
    }, []);

    useEffect(() => {
        if (stream && mediaStream.current) {
            mediaStream.current.srcObject = stream;
            mediaStream.current.onloadedmetadata = () => {
                mediaStream.current!.play();
                setDebug("Playing");
            };
        }
    }, [mediaStream, stream]);

    const startRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({audio: true});
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm',
            });
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    setAudioChunks((chunks) => [...chunks, event.data]);
                }
            };

            mediaRecorder.start();
        } catch (error) {
            console.error("Error starting recording:", error);
        }
    }, []);

    const stopRecording = useCallback(async () => {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current.onstop = async () => {
                const audioBlob = new Blob(audioChunks, {type: 'audio/webm'});
                await transcribeAudio(audioBlob);
                setAudioChunks([]);
            };
        }
    }, [audioChunks]);

    const transcribeAudio = async (audioBlob: Blob) => {
        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.webm');

        try {
            const response = await fetch('/api/transcribe', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error('Transcription failed');
            }

            const data = await response.json();
            // Automatically trigger the handleSpeak function
            //await handleSpeak();
        } catch (error) {
            console.error("Error transcribing audio:", error);
            setDebug("Error transcribing audio");
        }
    };

    // Add this useEffect hook to initialize onnxruntime-web
    useEffect(() => {
        async function initOnnx() {
            try {
                // Set the path where the .wasm files are located
                ort.env.wasm.wasmPaths = '/_next/static/chunks/';
                //await ort.init(); // Initialize the ONNX Runtime

                console.log("ONNX Runtime initialized successfully");
                setIsOnnxReady(true);
            } catch (error) {
                console.error("Error initializing ONNX Runtime:", error);
            }
        }

        initOnnx();
    }, []);

    const downloadBlob = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log(`Downloaded ${filename}`);
    };

    // Helper function to convert Float32Array to WebM
    const float32ArrayToWebM = (samples: Float32Array, sampleRate: number): Promise<Blob> => {
        return new Promise((resolve) => {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const audioBuffer = audioContext.createBuffer(1, samples.length, sampleRate);
            audioBuffer.getChannelData(0).set(samples);

            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;

            const destination = audioContext.createMediaStreamDestination();
            source.connect(destination);

            const mediaRecorder = new MediaRecorder(destination.stream, {mimeType: 'audio/webm;codecs=opus'});
            const chunks: Blob[] = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunks.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                const webmBlob = new Blob(chunks, {type: 'audio/webm'});
                resolve(webmBlob);
            };

            source.start(0);
            mediaRecorder.start();

            setTimeout(() => {
                mediaRecorder.stop();
                source.stop();
            }, (samples.length / sampleRate) * 1000);
        });
    };


    // Usage in sendAudioForTranscription
    const sendAudioForTranscription = async (audio: Float32Array) => {
        try {
            console.log("Sending audio for transcription using language " + languageRef.current);
            
            // Convert Float32Array to Base64 string
            const base64Audio = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(audio.buffer))));
            
            const response = await axios.post<AudioResponse>('/api/transcribe-audio', {
                file: base64Audio,
                language: languageRef.current,
                sampleRate: 16000, // Assuming 16kHz sample rate, adjust if different
            }, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });

            handleAudioResponse(response.data);

            if (response.data.text) {
                if (isUserTalking)
                    setPendingText((pendingText ? pendingText : "") + response.data.text)
                else {
                    let textToSpeak = (pendingText ? pendingText : "") + response.data.text;
                    setPendingText("");
                    await handleSpeak(textToSpeak);
                }
            } else {
                console.log('Not calling handleSpeak because no text was transcribed.');
            }
        } catch (error) {
            console.error('Error sending audio for transcription:', error);
            setDebug('Error transcribing audio');
        }
    };


    const handleAudioResponse = (response: AudioResponse) => {
        if (response.text) {
            console.log('Transcribed text:', response.text);
        }
        if (response.error) {
            console.error('Error:', response.error, 'Details:', response.details);
        }
    };

    interface AudioResponse {
        text?: string;
        audioDataSize: number;
        audioData: string;
        error?: string;
        details?: string;
    }

    const [isOnnxReady, setIsOnnxReady] = useState(false);

    return (
        <div className="w-full flex flex-col gap-4">
            <Card>
                <CardBody className="h-[500px] flex flex-col justify-center items-center">
                    {!isOnnxReady ? (
                        <Spinner color="default" size="lg"/>
                    ) : stream ? (
                        <div
                            className="h-[500px] w-[900px] justify-center items-center flex rounded-lg overflow-hidden">
                            <video
                                ref={mediaStream}
                                autoPlay
                                playsInline
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "contain",
                                }}
                            >
                                <track kind="captions"/>
                            </video>
                            <div className="flex flex-col gap-2 absolute bottom-3 right-3">
                                <Button
                                    className="bg-gradient-to-tr from-indigo-500 to-indigo-300  text-white rounded-lg"
                                    size="md"
                                    variant="shadow"
                                    onClick={endSession}
                                >
                                    End session
                                </Button>
                            </div>
                        </div>
                    ) : !isLoadingSession ? (
                        <div className="h-full justify-center items-center flex flex-col gap-8 w-[500px] self-center">
                            <div className="flex flex-col gap-2 w-full">
                                <Select
                                    label="Select language"
                                    placeholder="Select language"
                                    className="max-w-xs"
                                    selectedKeys={[language]}
                                    onChange={(e) => {
                                        console.log("Language changed to:", e.target.value);
                                        languageRef.current = e.target.valu;
                                    }}
                                >
                                    {STT_LANGUAGE_LIST.map((lang) => (
                                        <SelectItem key={lang.key}>
                                            {lang.label}
                                        </SelectItem>
                                    ))}
                                </Select>
                            </div>
                            <Button
                                className="bg-gradient-to-tr from-indigo-500 to-indigo-300 w-full text-white"
                                size="md"
                                variant="shadow"
                                onClick={startSession}
                            >
                                Start session
                            </Button>
                        </div>
                    ) : (
                        <Spinner color="default" size="lg"/>
                    )}
                </CardBody>
                <Divider/>
            </Card>
        </div>
    );
}
