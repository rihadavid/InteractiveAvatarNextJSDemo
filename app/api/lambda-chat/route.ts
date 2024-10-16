import { NextResponse } from 'next/server';
const wsUrl = process.env.WSS_URL;

export async function POST(req: Request) {
  const { message } = await req.json();

  // WebSocket connection URL (replace with your actual WebSocket URL)

  return new NextResponse(streamResponse(wsUrl, message));
}

async function* streamResponse(wsUrl: string, message: string) {
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({ message }));
  };

  while (true) {
    const chunk = await new Promise<string>((resolve) => {
      ws.onmessage = (event) => {
        resolve(event.data);
      };
    });

    if (chunk === '[END]') {
      ws.close();
      return;
    }

    yield chunk;
  }
}
