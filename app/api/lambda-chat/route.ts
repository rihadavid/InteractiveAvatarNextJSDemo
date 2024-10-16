import { NextResponse } from 'next/server';
const wsUrl = process.env.WSS_URL;

export async function POST(req: Request) {
  if (!wsUrl) {
    return new NextResponse('WebSocket URL is not configured', { status: 500 });
  }

  const { message } = await req.json();

  // Create a ReadableStream from the generator function
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of streamResponse(wsUrl, message)) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  // Return a streaming response
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked',
    },
  });
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
