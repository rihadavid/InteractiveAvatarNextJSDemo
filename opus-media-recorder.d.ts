declare module 'opus-media-recorder' {
  export default class OpusMediaRecorder extends MediaRecorder {
    constructor(stream: MediaStream, options?: MediaRecorderOptions);
    
    static isTypeSupported(mimeType: string): boolean;
    
    static WorkerFactory: {
      new(): Worker;
    };
  }
}
