#!/usr/bin/env python3
import argparse
from pathlib import Path

from pydub import AudioSegment


def join_opus_to_mp3(
    input_dir: Path,
    output_file: Path = Path("output.mp3"),
    bitrate: str = "192k",
):
    if not input_dir.is_dir():
        raise NotADirectoryError(f"{input_dir} is not a directory")

    # Find all .opus files (case-insensitive), sorted by name
    opus_files = sorted(
        [p for p in input_dir.iterdir() if p.is_file() and p.suffix.lower() == ".opus"]
    )

    if not opus_files:
        raise FileNotFoundError(f"No .opus files found in {input_dir}")

    print(f"Found {len(opus_files)} .opus files:")
    for f in opus_files:
        print("  -", f.name)

    combined = AudioSegment.empty()

    # Load and append each opus file
    for f in opus_files:
        print(f"Loading {f.name}...")
        segment = AudioSegment.from_file(f, format="opus")
        combined += segment

    # Export to mp3
    print(f"Exporting to {output_file}...")
    combined.export(output_file, format="mp3", bitrate=bitrate)
    print("Done!")


def main():
    parser = argparse.ArgumentParser(
        description="Join all .opus files in a directory into a single MP3."
    )
    parser.add_argument(
        "input_dir",
        help="Directory containing .opus files",
    )
    parser.add_argument(
        "-o",
        "--output",
        help="Output MP3 file path (default: output.mp3)",
        default="output.mp3",
    )
    parser.add_argument(
        "-b",
        "--bitrate",
        help="Output MP3 bitrate (default: 192k)",
        default="192k",
    )

    args = parser.parse_args()
    input_dir = Path(args.input_dir).expanduser().resolve()
    output_file = Path(args.output).expanduser().resolve()

    join_opus_to_mp3(input_dir, output_file, args.bitrate)


if __name__ == "__main__":
    main()
