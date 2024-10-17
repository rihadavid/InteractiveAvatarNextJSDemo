'use client';

import type { StartAvatarResponse } from "@heygen/streaming-avatar";

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
import { useEffect, useRef, useState, useCallback } from "react";
import { useMemoizedFn, usePrevious } from "ahooks";
import { useSearchParams } from 'next/navigation';

import InteractiveAvatarTextInput from "./InteractiveAvatarTextInput";

import {AVATARS, STT_LANGUAGE_LIST} from "@/app/lib/constants";

import { useMicVAD  } from "@ricky0123/vad-react";

import * as ort from 'onnxruntime-web';

import axios from 'axios';

const wsUrl = process.env.NEXT_PUBLIC_WSS_URL;
const interruptionUrl = process.env.NEXT_PUBLIC_INTERRUPTION_URL;

export default function InteractiveAvatar() {
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isLoadingRepeat, setIsLoadingRepeat] = useState(false);
  const [stream, setStream] = useState<MediaStream>();
  const [debug, setDebug] = useState<string>();
  const [knowledgeId, setKnowledgeId] = useState<string>("");
  const [avatarId, setAvatarId] = useState<string>("");
  const [language, setLanguage] = useState<string>('en');

  const [data, setData] = useState<StartAvatarResponse>();
  const [text, setText] = useState<string>("");
  const mediaStream = useRef<HTMLVideoElement>(null);
  const avatar = useRef<StreamingAvatar | null>(null);
  const [chatMode, setChatMode] = useState("text_mode");
  const [isUserTalking, setIsUserTalking] = useState(false);
    const [isAvatarTalking, setIsAvatarTalking] = useState(false);

  const [customSessionId, setCustomSessionId] = useState<string | null>(null);
    const [signature, setSignature] = useState<string | null>(null);
  const [wsConnection, setWsConnection] = useState<WebSocket | null>(null);

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

    setCustomSessionId(custom_session_id);
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

      if (isAvatarTalking) {
          let interruptAvatarTask = avatar.current ? avatar.current.interrupt() : undefined;
          let interruptTask = fetch(`${interruptionUrl}/?signature=${signature}`, {
              method: 'GET',
          }).catch(error => {
              console.error('Error reporting interruption:', error);
          });
          setIsAvatarTalking(false);
          await interruptTask;
          if (interruptAvatarTask)
            await interruptAvatarTask;
      }
    },
    onSpeechEnd: async (audio) => {
        setIsUserTalking(false);
      console.log("VAD speech end");
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
      setWsConnection(ws);
    };
    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
    ws.onclose = () => {
      console.log("WebSocket connection closed");
      setWsConnection(null);
    };

    avatar.current = new StreamingAvatar({
      token: newToken,
    });
    avatar.current.on(StreamingEvents.AVATAR_START_TALKING, (e) => {
      console.log("Avatar started talking", e);
      setIsAvatarTalking(true);
    });
    avatar.current.on(StreamingEvents.AVATAR_STOP_TALKING, (e) => {
      console.log("Avatar stopped talking", e);
        setIsAvatarTalking(false);
    });
    avatar.current.on(StreamingEvents.STREAM_DISCONNECTED, () => {
      console.log("Stream disconnected");
      endSession();
    });
    avatar.current?.on(StreamingEvents.STREAM_READY, (event) => {
      console.log(">>>>> Stream ready:", event.detail);
      setStream(event.detail);
    });
    avatar.current?.on(StreamingEvents.USER_START, async (event) => {
      console.log(">>>>> User started talking:", event);
      //setIsUserTalking(true);

      if (isAvatarTalking) {
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
        avatarName: avatarId,
        knowledgeId: knowledgeId, // Or use a custom `knowledgeBase`.
        voice: {
          rate: 1.5, // 0.5 ~ 1.5
          emotion: VoiceEmotion.EXCITED,
        },
        language: language,
      });

      setData(res);
      vad.start(); // Start VAD when the session starts
    } catch (error) {
      console.error("Error starting avatar session:", error);
    } finally {
      setIsLoadingSession(false);
    }
  }
  async function handleSpeak() {
      console.log("Handle speak invoked");
    setIsLoadingRepeat(true);
    if (!avatar.current) {
        console.log("Avatar API not initialized");
      setDebug("Avatar API not initialized");
      return;
    }

    if (!customSessionId) {
        console.log("Custom session ID not available");
      setDebug("Custom session ID not available");
      return;
    }

    if (!wsConnection) {
        console.log("WebSocket connection not established");
      setDebug("WebSocket connection not established");
      return;
    }

    try {
      wsConnection.send(JSON.stringify({
        action: 'MESSAGE',
        message: text,
        custom_session_id: customSessionId
      }));

      wsConnection.onmessage = async (event) => {
          console.log("wsConnection.onmessage");
        const chunk = event.data;

        if (chunk === '[END]') {
          return;
        }

        if (avatar.current) {
            console.log("handleSpeak sending text");
          await avatar.current.speak({ text: chunk, task_type: TaskType.REPEAT });
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
        setDebug(e.message);
      });
  }
  async function endSession() {
    await avatar.current?.stopAvatar();
    setStream(undefined);
    if (wsConnection) {
      wsConnection.close();
      setWsConnection(null);
    }
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
      if (wsConnection) {
        wsConnection.close();
      }
    };
  }, [wsConnection]);

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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
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
      setText(data.text);
      // Automatically trigger the handleSpeak function
      await handleSpeak();
    } catch (error) {
      console.error("Error transcribing audio:", error);
      setDebug("Error transcribing audio");
    }
  };

  // Add this useEffect hook to initialize onnxruntime-web
  useEffect(() => {
    async function initOnnx() {
      try {
        await ort.env.wasm.wasmPaths;
        console.log("ONNX Runtime initialized successfully");
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

    const sendAudioForTranscription = async (audio: Float32Array) => {
        try {
            // Convert Float32Array to WebM format
            const webmBlob = await float32ArrayToWebM(audio, 16000);

            if (isUserTalking) return;

            // For debugging: download the audio before sending
            //downloadBlob(webmBlob, 'pre_send_audio.webm');

            // Create FormData and append the WebM file
            const formData = new FormData();
            formData.append('file', webmBlob, 'audio.webm');

            if (isUserTalking) return;

            // Send the audio to the server for transcription
            const response = await axios.post<AudioResponse>('/api/transcribe-audio', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });

            handleAudioResponse(response.data);

            if (!isUserTalking && response.data.text) {
                setText(response.data.text);
                await handleSpeak();
            }
            else
                console.log('not calling handle speak')
        } catch (error) {
            console.error('Error sending audio for transcription:', error);
            setDebug('Error transcribing audio');
        }
    };

    interface AudioResponse {
        text?: string;
        audioDataSize: number;
        audioData: string;
        error?: string;
        details?: string;
    }

    const handleAudioResponse = (response: AudioResponse) => {
        if (response.audioData) {
            // Convert base64 to Blob
            const byteCharacters = atob(response.audioData);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'audio/webm' });

            // For debugging: download the audio after receiving
            //downloadBlob(blob, 'post_send_audio.webm');

            console.log('Audio file size:', response.audioDataSize, 'bytes');
            if (response.text) {
                console.log('Transcribed text:', response.text);
            }
            if (response.error) {
                console.error('Error:', response.error, 'Details:', response.details);
            }
        } else {
            console.log('No audio data received');
        }
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

            const mediaRecorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' });
            const chunks: Blob[] = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunks.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                const webmBlob = new Blob(chunks, { type: 'audio/webm' });
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

  return (
    <div className="w-full flex flex-col gap-4">
      <Card>
        <CardBody className="h-[500px] flex flex-col justify-center items-center">
          {stream ? (
            <div className="h-[500px] w-[900px] justify-center items-center flex rounded-lg overflow-hidden">
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
                <track kind="captions" />
              </video>
              <div className="flex flex-col gap-2 absolute bottom-3 right-3">
                <Button
                  className="bg-gradient-to-tr from-indigo-500 to-indigo-300 text-white rounded-lg"
                  size="md"
                  variant="shadow"
                  onClick={handleInterrupt}
                >
                  Interrupt task
                </Button>
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
                <p className="text-sm font-medium leading-none">
                  Custom Knowledge ID (optional)
                </p>
                <Input
                  placeholder="Enter a custom knowledge ID"
                  value={knowledgeId}
                  onChange={(e) => setKnowledgeId(e.target.value)}
                />
                <p className="text-sm font-medium leading-none">
                  Custom Avatar ID (optional)
                </p>
                <Input
                  placeholder="Enter a custom avatar ID"
                  value={avatarId}
                  onChange={(e) => setAvatarId(e.target.value)}
                />
                <Select
                  placeholder="Or select one from these example avatars"
                  size="md"
                  onChange={(e) => {
                    setAvatarId(e.target.value);
                  }}
                >
                  {AVATARS.map((avatar) => (
                    <SelectItem
                      key={avatar.avatar_id}
                      textValue={avatar.avatar_id}
                    >
                      {avatar.name}
                    </SelectItem>
                  ))}
                </Select>
                <Select
                  label="Select language"
                  placeholder="Select language"
                  className="max-w-xs"
                  selectedKeys={[language]}
                  onChange={(e) => {
                    setLanguage(e.target.value);
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
            <Spinner color="default" size="lg" />
          )}
        </CardBody>
        <Divider />
        <CardFooter className="flex flex-col gap-3 relative">
          <Tabs
            aria-label="Options"
            selectedKey={chatMode}
            onSelectionChange={(v) => {
              handleChangeChatMode(v);
            }}
          >
            <Tab key="text_mode" title="Text mode" />
            <Tab key="voice_mode" title="Voice mode" />
          </Tabs>
          {chatMode === "text_mode" ? (
            <div className="w-full flex relative">
              <InteractiveAvatarTextInput
                disabled={!stream}
                input={text}
                label="Chat"
                loading={isLoadingRepeat}
                placeholder="Type something for the avatar to respond"
                setInput={setText}
                onSubmit={handleSpeak}
              />
              {text && (
                <Chip className="absolute right-16 top-3">Listening</Chip>
              )}
            </div>
          ) : (
            <div className="w-full text-center">
              <Button
                isDisabled={!isUserTalking}
                className="bg-gradient-to-tr from-indigo-500 to-indigo-300 text-white"
                size="md"
                variant="shadow"
              >
                {isUserTalking ? "Listening" : "Voice chat"}
              </Button>
            </div>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
