import base64
from typing import Any, Dict, List

import edge_tts


async def synthesize_neural_with_timestamps(
    text: str,
    voice: str = "en-US-AvaMultilingualNeural",
    speed: float = 1.0,
) -> Dict[str, Any]:
    """
    Synthesizes studio-grade neural speech and extracts exact WordBoundary timestamps
    so the mobile app can highlight words in real time like Spotify Lyrics.
    """
    pct = int(round((speed - 1.0) * 100))
    rate_str = f"+{pct}%" if pct >= 0 else f"{pct}%"

    communicate = edge_tts.Communicate(text, voice=voice, rate=rate_str)
    audio_bytes = bytearray()
    word_timings: List[Dict[str, Any]] = []
    search_cursor = 0

    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_bytes.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            word_str = chunk.get("text", "")
            offset_100ns = chunk.get("offset", 0)
            duration_100ns = chunk.get("duration", 0)
            start_ms = int(offset_100ns / 10000)
            end_ms = int((offset_100ns + duration_100ns) / 10000)

            idx = text.find(word_str, search_cursor)
            if idx == -1:
                idx = search_cursor
            end_idx = idx + len(word_str)
            search_cursor = end_idx

            word_timings.append(
                {
                    "word": word_str,
                    "startCharIndex": idx,
                    "endCharIndex": end_idx,
                    "startTimeMs": start_ms,
                    "endTimeMs": end_ms,
                }
            )

    return {
        "audioBase64": base64.b64encode(bytes(audio_bytes)).decode("utf-8"),
        "wordTimings": word_timings,
        "voice": voice,
    }
