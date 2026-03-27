#!/usr/bin/env python3
"""
Bridge script — calls nano-banana-manager skill functions from Node.js subprocess.

Usage:
  python3 nano-banana-bridge.py --action stadium \
    --style epic --colors "pink and orange" \
    --width 1080 --height 1920 \
    --output-dir /path/to/dir --filename stadium_bg

  python3 nano-banana-bridge.py --action image \
    --prompt "..." \
    --width 1080 --height 1080 \
    --output-dir /path/to/dir --filename my_image

Outputs JSON to stdout: {"ok": true, "path": "...", "size": 1234, "model": "..."}
All logs go to stderr.
"""

import sys
import os
import json
import argparse

# Add the skill directory to path so we can import its functions
SKILL_DIR = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'skills', 'nano-banana-manager')
SKILL_DIR = os.path.abspath(SKILL_DIR)
sys.path.insert(0, SKILL_DIR)

# Load .env from skill directory (for GEMINI_API_KEY)
from dotenv import load_dotenv
skill_env = os.path.join(SKILL_DIR, '.env')
if os.path.exists(skill_env):
    load_dotenv(skill_env)
# Also try project-level .env
project_env = os.path.join(os.path.dirname(__file__), '..', '..', '.env')
if os.path.exists(project_env):
    load_dotenv(project_env, override=False)

from server import generate_stadium_background, generate_image, edit_image, MODEL_NAME


def parse_result(result_str):
    """Parse the skill's return string into structured data."""
    data = {'ok': True, 'model': MODEL_NAME, 'raw': result_str}
    for line in result_str.split('\n'):
        if 'נתיב:' in line:
            data['path'] = line.split('נתיב:')[1].strip()
        elif 'גודל:' in line:
            size_str = line.split('גודל:')[1].strip().replace(' KB', '')
            try:
                data['size_kb'] = float(size_str)
            except ValueError:
                pass
        elif 'שגיאה' in line:
            data['ok'] = False
            data['error'] = result_str
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--action', required=True, choices=['stadium', 'image', 'edit'])
    parser.add_argument('--style', default='epic')
    parser.add_argument('--colors', default='pink and orange')
    parser.add_argument('--width', type=int, default=1080)
    parser.add_argument('--height', type=int, default=1350)
    parser.add_argument('--prompt', default='')
    parser.add_argument('--image-path', default='')
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--filename', default='')
    args = parser.parse_args()

    try:
        if args.action == 'stadium':
            result_str = generate_stadium_background(
                style=args.style,
                width=args.width,
                height=args.height,
                colors=args.colors,
                filename=args.filename or None,
                output_dir=args.output_dir,
            )
        elif args.action == 'edit':
            result_str = edit_image(
                image_path=args.image_path,
                prompt=args.prompt,
                filename=args.filename or None,
                output_dir=args.output_dir,
            )
        else:
            result_str = generate_image(
                prompt=args.prompt,
                width=args.width,
                height=args.height,
                filename=args.filename or None,
                output_dir=args.output_dir,
            )

        data = parse_result(result_str)
        print(json.dumps(data))

    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
