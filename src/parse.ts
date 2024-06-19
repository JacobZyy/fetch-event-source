/**
 * Represents a message sent in an event stream
 * https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format
 */
export interface EventSourceMessage {
    /** The event ID to set the EventSource object's last event ID value. */
    id: string;
    /** A string identifying the type of event described. */
    event: string;
    /** The event data */
    data: string;
    /** The reconnection interval (in milliseconds) to wait before retrying the connection */
    retry?: number;
}

/**
 * Converts a ReadableStream into a callback pattern.
 * @param stream The input ReadableStream.
 * @param onChunk A function that will be called on each new byte chunk in the stream.
 * @returns {Promise<void>} A promise that will be resolved when the stream closes.
 */
export async function getBytes(stream: ReadableStream<Uint8Array>, onChunk: (arr: Uint8Array) => void) {
    const reader = stream.getReader();
    let result: ReadableStreamReadResult<Uint8Array>;
    while (!(result = await reader.read()).done) {
        onChunk(result.value);
    }
}

const enum ControlChars {
    NewLine = 10,
    CarriageReturn = 13,
}

/**
 * Parses arbitary byte chunks into EventSource line buffers.
 * Each line should be of the format "field: value" and ends with \r, \n, or \r\n.
 * @param onLine A function that will be called on each new EventSource line.
 * @returns A function that should be called for each incoming byte chunk.
 */
export function getLines(onLine: (line: Uint8Array) => void) {
    let buffer: Uint8Array | undefined;
    let position: number; // current read position
    let discardTrailingNewline = false;

    // return a function that can process each incoming byte chunk:
    return function onChunk(arr: Uint8Array) {
        if (buffer === undefined) {
            buffer = arr;
            position = 0;
        } else {
            // we're still parsing the old line. Append the new bytes into buffer:
            buffer = concat(buffer, arr);
        }

        const bufLength = buffer.length;
        let lineStart = 0; // index where the current line starts
        while (position < bufLength) {
            if (discardTrailingNewline) {
                if (buffer[position] === ControlChars.NewLine) {
                    lineStart = ++position; // skip to next char
                }

                discardTrailingNewline = false;
            }

            // start looking forward till the end of line:
            let lineEnd = -1; // index of the \r or \n char
            for (; position < bufLength && lineEnd === -1; ++position) {
                switch (buffer[position]) {
                    // @ts-ignore:7029 \r case below should fallthrough to \n:
                    case ControlChars.CarriageReturn:
                        discardTrailingNewline = true;
                    case ControlChars.NewLine:
                        lineEnd = position;
                        break;
                }
            }

            if (lineEnd === -1) {
                // We reached the end of the buffer but the line hasn't ended.
                // Wait for the next arr and then continue parsing:
                break;
            }

            // we've reached the line end, send it out:
            onLine(buffer.subarray(lineStart, lineEnd));
            lineStart = position; // we're now on the next line
        }

        if (lineStart === bufLength) {
            buffer = undefined; // we've finished reading it
        } else if (lineStart !== 0) {
            // Create a new view into buffer beginning at lineStart, so we don't
            // need to copy over the previous lines when we get the new arr:
            buffer = buffer.subarray(lineStart);
            position -= lineStart;
        }
    }
}

/**
 * @param onMessage A function that will be called on each message.
 * @returns A function that should be called for each incoming line buffer.
 */
export function getMessages<T>(onMessage?: (msg: T) => void) {
    const decoder = new TextDecoder();

    // return a function that can process each incoming line buffer:
    return function onLine(line: Uint8Array) {
        if (line.length === 0) {
            return
        }
        let isValidJSON = true
        const decodedText = decoder.decode(line);
        try {
            JSON.parse(decodedText)
        }catch(e) {
            isValidJSON = false;
        }
        onMessage?.(isValidJSON ? JSON.parse(decodedText) : decodedText)
    }
}

function concat(a: Uint8Array, b: Uint8Array) {
    const res = new Uint8Array(a.length + b.length);
    res.set(a);
    res.set(b, a.length);
    return res;
}
