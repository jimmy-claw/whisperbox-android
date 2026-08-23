// React Native globals that exist at runtime but lack type definitions
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  decode(input?: BufferSource): string;
}
