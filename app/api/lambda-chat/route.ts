import { NextResponse } from 'next/server';
const wsUrl = process.env.WSS_URL;

export async function POST(req: Request) {
  if (!wsUrl) {
    return new NextResponse('WebSocket URL is not configured', { status: 500 });
  }

  const { message, custom_session_id } = await req.json();

  // Create a ReadableStream from the generator function
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of streamResponse(wsUrl, message, custom_session_id)) {
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

async function* streamResponse(wsUrl: string, message: string, custom_session_id: string) {
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({ 
      action: 'MESSAGE',
      message,
      custom_session_id 
    }));
  };

  while (true) {
    const chunk = await new Promise<string>((resolve) => {
      ws.onmessage = (event) => {
          console.log('webscocket received message: ' + event);
          console.log('webscocket received message event.data: ' + event.data);
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
