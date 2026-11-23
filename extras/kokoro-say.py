"""Speak the text on standard input with Kokoro, into a WAV file: xenagos's `command` voice provider.

    kokoro-say.py --voice af_heart --speed 1 --output narration.wav < text

The model files are in `kokoro/model/` beside this script (kokoro-onnx model-files-v1.0). Voices whose name starts
with `b` are British English, the others American English.
"""

import argparse
import sys
from pathlib import Path

import soundfile
from kokoro_onnx import Kokoro

MODEL = Path(__file__).resolve().with_name("kokoro") / "model"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--voice", default="af_heart")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    text = sys.stdin.read().strip()
    if not text:
        sys.exit("no text on standard input")
    kokoro = Kokoro(str(MODEL / "kokoro-v1.0.onnx"), str(MODEL / "voices-v1.0.bin"))
    lang = "en-gb" if args.voice.startswith("b") else "en-us"
    samples, rate = kokoro.create(text, voice=args.voice, speed=min(2.0, max(0.5, args.speed)), lang=lang)
    soundfile.write(args.output, samples, rate, subtype="PCM_16")


if __name__ == "__main__":
    main()
