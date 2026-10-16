/**
 * Minimal text/event-stream parser for fetch() bodies. EventSource can't be used because
 * /api/convert is a POST (the form travels in the request body).
 */
export function createSseParser(onData: (data: string) => void) {
  let buffer = ''

  function emit(block: string) {
    const data = block
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''))
    if (data.length) onData(data.join('\n'))
  }

  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n/g, '\n')
      let end = buffer.indexOf('\n\n')
      while (end !== -1) {
        emit(buffer.slice(0, end))
        buffer = buffer.slice(end + 2)
        end = buffer.indexOf('\n\n')
      }
    },
    /** The stream closed: a last event may lack its terminating blank line. */
    end() {
      if (buffer.trim()) emit(buffer)
      buffer = ''
    }
  }
}
